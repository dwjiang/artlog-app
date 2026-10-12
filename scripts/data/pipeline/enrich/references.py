import copy
import ipaddress
import json
import logging
import re
from urllib.parse import parse_qsl, urlencode, urlsplit

import httpx
from bs4 import BeautifulSoup

from pipeline.model_version import REPO_ROOT

from .validator import source_passage

log = logging.getLogger(__name__)
POLICY = json.loads((REPO_ROOT / "shared/sources/research-policy.json").read_text())
REVIEW = json.loads((REPO_ROOT / "shared/sources/reference-review.json").read_text())


def bounded_references(references):
    selected, seen = [], set()
    for reference in references:
        try:
            url = urlsplit(reference["url"])
            host = (url.hostname or "").lower().rstrip(".")
            if (
                url.scheme != "https"
                or url.username
                or url.password
                or url.port not in (None, 443)
                or "." not in host
                or re.search(r"(^|\.)(localhost|local|internal|test|invalid)$", host)
                or len(reference["url"]) > 2048
            ):
                continue
            try:
                ipaddress.ip_address(host)
                continue
            except ValueError:
                if re.fullmatch(r"[\d.]+", host):
                    continue
            query = urlencode(
                sorted(
                    (k, v)
                    for k, v in parse_qsl(url.query)
                    if not k.startswith("utm_") and k not in {"fbclid", "gclid"}
                )
            )
            clean = url._replace(query=query, fragment="").geturl()
            identity = clean.replace("https://www.", "https://").rstrip("/")
            if identity not in seen:
                seen.add(identity)
                selected.append({**reference, "url": clean})
        except (ValueError, TypeError):
            continue
    return selected[: POLICY["maxReferencePages"]]


def wikidata_references(entity):
    return [
        {
            "url": snak["datavalue"]["value"],
            "referenceUrl": f"https://www.wikidata.org/wiki/{entity['id']}",
        }
        for claims in entity.get("claims", {}).values()
        for claim in claims
        if claim.get("rank") != "deprecated"
        for reference in claim.get("references", [])
        for snak in reference.get("snaks", {}).get("P854", [])
        if isinstance(snak.get("datavalue", {}).get("value"), str)
    ]


# Commons source rows link each identifier to its Wikidata property page ("Property:P4610", the Art
# Institute ID), which documents the identifier for every artwork rather than describing this one.
WIKI_NAMESPACE = re.compile(
    r"^https://[^/]*\b(?:wikidata|wikipedia|wikimedia|wikisource|wikiquote)\.org/wiki/"
    r"(?:Property|Special|Help|Template|Category|Commons|File|User|Wikidata|Wikipedia|Portal|Talk"
    r"|Lexeme|EntitySchema|Module|MediaWiki|Project)(?:_talk)?:",
    re.ASCII | re.IGNORECASE,
)


def commons_references(html, reference_url):
    soup = BeautifulSoup(html, "html.parser")
    return [
        {"url": link["href"], "referenceUrl": reference_url}
        for cell in soup.select("#fileinfotpl_src, #fileinfotpl_art_references")
        if cell.parent and cell.parent.name == "tr"
        for link in cell.parent.select('a[href^="https://"]')
        if not WIKI_NAMESPACE.match(link["href"])
    ]


def quote_words(text):
    # Models copying a caption drop its punctuation, so a quote must repeat the words in order.
    # Han and kana need character boundaries; Latin words and numbers stay whole, as in referenceReview.ts.
    text = re.sub(
        r"([\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff"
        r"\U0001aff0-\U0001b16f\U00020000-\U0003347f])",
        r" \1 ",
        source_passage(text),
    )
    return f" {' '.join(re.findall(r'[^\W_]+', text))} "


# The review compares identifiers, which sit near the top of a page; the rest only makes the prompt
# longer (convex/lib/referenceReview.ts).
REVIEW_CATALOGUE_CHARS = 2500
REVIEW_REFERENCE_CHARS = 6000
UNNAMED = re.compile(
    r"(?:(?:unknown|anonymous|anon|unidentified|not identified)(?: (?:artist|maker|painter|author))?"
    r"|(?:artist|maker) unknown)"
)
# JavaScript's \b and \d are ASCII-only, so "1889年" holds a year; its \s is Unicode, as here.
YEARS = re.compile(
    r"(?<![A-Za-z0-9_])(1[0-9]{3}|20[0-9]{2})(?:\s*[–—-]\s*([0-9]{2,4})(?![A-Za-z0-9_]))?"
)
CENTURY = re.compile(
    r"(?<![A-Za-z0-9_])([0-9]{1,2})(?:st|nd|rd|th) century(?![A-Za-z0-9_])", re.IGNORECASE
)
APPROXIMATE = re.compile(
    r"(?<![A-Za-z0-9_])(?:c|ca|circa|about|around)(?![A-Za-z0-9_])", re.IGNORECASE
)


def review_input(sources, artwork):
    return {
        "target": {k: artwork.get(k) for k in ("title", "artist", "date")},
        "catalogue": [
            {"url": s["url"], "text": s["text"][:REVIEW_CATALOGUE_CHARS]}
            for s in sources
            if not s.get("referenceUrl")
        ],
        "references": [
            {
                "source": f"s{i + 1}",
                "url": s["url"],
                "label": s["label"],
                "referenceUrl": s["referenceUrl"],
                "text": s["text"][:REVIEW_REFERENCE_CHARS],
            }
            for i, s in enumerate(sources)
            if s.get("referenceUrl")
        ],
    }


def _life_dates(name):
    return re.sub(r"\([^)]*\d{4}[^)]*\)", " ", name)


# The years a quoted date covers: "Dated 1840", "ca. 1700–1710", "1665–67", "18th century".
def _year_range(text):
    years = []
    for first, last in YEARS.findall(text):
        years.append(int(first))
        if last:
            end = int(first[: len(first) - len(last)] + last)
            if len(last) < len(first) and end < int(first):
                end += 10 ** len(last)
            years.append(end)
    for century in CENTURY.findall(text):
        years.extend(((int(century) - 1) * 100, (int(century) - 1) * 100 + 99))
    return (min(years), max(years)) if years else None


# Models flag a quote that agrees with the work ("Dated 1840" against 1840, "ca. 1700–1710" against
# 1705) or merely lacks a name ("Unknown"); neither is a conflict the work should be held back for.
def _agrees(conflict, target):
    if conflict["field"] == "artist":
        quoted = re.sub(r"[.,;:]+$", "", source_passage(_life_dates(conflict["text"])))
        own = source_passage(_life_dates(target.get("artist") or ""))
        return bool(UNNAMED.fullmatch(quoted)) or quoted == own
    quoted = _year_range(conflict["text"])
    if target.get("yearStart") is not None:
        start = target["yearStart"]
        own = (start, start if target.get("yearEnd") is None else target["yearEnd"])
    else:
        own = _year_range(target.get("date") or "")
    if not quoted or not own:
        return False
    slack = 5 if APPROXIMATE.search(conflict["text"]) else 0
    return quoted[0] - slack <= own[1] and quoted[1] + slack >= own[0]


# Each reference stands or falls on its own row: a row that is missing, repeated, not quoted from its
# page or citing an invented conflict leaves only that reference out. The museum's own catalogue text
# stays either way.
def apply_review(value, sources, target=None):
    references = {
        f"s{i + 1}": source for i, source in enumerate(sources) if source.get("referenceUrl")
    }
    rows = value.get("reviews") if isinstance(value, dict) else None
    accepted, conflicts = set(), []

    def quoted(text, source):
        return (
            isinstance(text, str)
            and bool(quote_words(text).strip())
            and quote_words(text) in quote_words(source["text"])
        )

    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        key = row.get("source")
        source = references.pop(key, None) if isinstance(key, str) else None
        listed = row.get("conflicts")
        if (
            not source
            or row.get("relation") != "same_artwork"
            or not isinstance(listed, list)
            or not quoted(row.get("evidence"), source)
        ):
            continue
        cited = [c for c in listed if isinstance(c, dict) and c.get("field") in ("artist", "date")]
        if len(cited) != len(listed) or any(not quoted(c.get("text"), source) for c in cited):
            continue
        accepted.add(id(source))
        for conflict in cited:
            if target is not None and _agrees(conflict, target):
                continue
            conflicts.append(
                {
                    "field": conflict["field"],
                    "text": conflict["text"],
                    "sourceUrl": source["url"],
                    "sourceLabel": source["label"],
                    "referenceUrl": source["referenceUrl"],
                }
            )
    kept = [
        s for s in sources if not s.get("referenceUrl") or s.get("firstParty") or id(s) in accepted
    ]
    return kept, conflicts


def review_references(provider, sources, artwork):
    if not any(source.get("referenceUrl") for source in sources):
        return sources, []
    references = [f"s{i + 1}" for i, source in enumerate(sources) if source.get("referenceUrl")]
    schema = copy.deepcopy(REVIEW["schema"])
    schema["properties"]["reviews"].update(minItems=len(references), maxItems=len(references))
    schema["properties"]["reviews"]["items"]["properties"]["source"]["enum"] = references
    try:
        value = provider.chat(
            stage="referenceReview",
            system=REVIEW["prompt"],
            schema=schema,
            max_tokens=2048,
            inputs=review_input(sources, artwork),
        )
    except (httpx.HTTPError, ValueError) as error:
        # An unreadable review leaves its references out; the catalogue research stands on its own.
        log.warning("Reference review unavailable: %s", error)
        value = None
    return apply_review(value, sources, artwork)

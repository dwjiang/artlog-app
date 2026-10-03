import copy
import ipaddress
import json
import re
from urllib.parse import parse_qsl, urlencode, urlsplit

from bs4 import BeautifulSoup

from pipeline.model_version import REPO_ROOT

from .validator import source_passage

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


def commons_references(html, reference_url):
    soup = BeautifulSoup(html, "html.parser")
    return [
        {"url": link["href"], "referenceUrl": reference_url}
        for cell in soup.select("#fileinfotpl_src, #fileinfotpl_art_references")
        if cell.parent and cell.parent.name == "tr"
        for link in cell.parent.select('a[href^="https://"]')
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


def review_references(provider, sources, artwork):
    references = {
        f"s{i + 1}": source for i, source in enumerate(sources) if source.get("referenceUrl")
    }
    if not references:
        return sources, []
    schema = copy.deepcopy(REVIEW["schema"])
    schema["properties"]["reviews"].update(minItems=len(references), maxItems=len(references))
    schema["properties"]["reviews"]["items"]["properties"]["source"]["enum"] = list(references)
    value = provider.chat(
        stage="referenceReview",
        system=REVIEW["prompt"],
        schema=schema,
        max_tokens=2048,
        inputs={
            "target": {k: artwork.get(k) for k in ("title", "artist", "date")},
            "catalogue": [
                {"url": s["url"], "text": s["text"]} for s in sources if not s.get("referenceUrl")
            ],
            "references": [{"source": key, **source} for key, source in references.items()],
        },
    )
    accepted, conflicts = [], []
    if not isinstance(value, dict) or not isinstance(value.get("reviews"), list):
        raise TypeError("Invalid reference review")

    def quoted(text, source):
        return (
            isinstance(text, str)
            and bool(quote_words(text).strip())
            and quote_words(text) in quote_words(source["text"])
        )

    for row in value["reviews"]:
        if not isinstance(row, dict):
            raise TypeError("Invalid reference review")
        source = references.pop(row.get("source"), None)
        if (
            not source
            or row.get("relation") not in {"same_artwork", "other", "uncertain"}
            or not isinstance(row.get("conflicts"), list)
            or not isinstance(row.get("comparison"), str)
            or not row["comparison"].strip()
        ):
            raise ValueError("Invalid reference review")
        if row["relation"] != "same_artwork":
            if row["conflicts"]:
                raise ValueError("Invalid reference review")
            continue
        if not quoted(row.get("evidence"), source):
            raise ValueError("Invalid reference review")
        accepted.append(source)
        for conflict in row["conflicts"]:
            if (
                not isinstance(conflict, dict)
                or conflict.get("field") not in {"artist", "date"}
                or not quoted(conflict.get("text"), source)
            ):
                raise ValueError("Invalid reference review")
            conflicts.append(
                {
                    **conflict,
                    "sourceUrl": source["url"],
                    "sourceLabel": source["label"],
                    "referenceUrl": source["referenceUrl"],
                }
            )
    if references:
        raise ValueError("Incomplete reference review")
    return [s for s in sources if not s.get("referenceUrl") or s in accepted], conflicts

import json
import logging
import re
import unicodedata
from collections.abc import Callable, Sequence
from html import unescape
from typing import NotRequired, TypedDict
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup, Tag

from pipeline.model_version import REPO_ROOT
from pipeline.polite_http import PoliteClient, RetryLater, RobotsDisallowed
from pipeline.wikidata import sparql

from .references import bounded_references, commons_references, wikidata_references
from .validator import source_passage

log = logging.getLogger(__name__)
SCORES = json.loads((REPO_ROOT / "shared/sources/source-scores.json").read_text())
RESEARCH_POLICY = json.loads((REPO_ROOT / "shared/sources/research-policy.json").read_text())
MAX_CHARS = 24_000
# Mirrors convex/lib/docentSources.ts: the best-scored sources fill a fixed budget, a passage stays
# only in the first source that carries it, and lines shorter than a passage stay everywhere.
TOTAL_CHARS = 40_000
MIN_PASSAGE_CHARS = 80
PROPERTIES = {
    "P1476": "Title",
    "P170": "Creator",
    "P571": "Inception",
    "P186": "Material",
    "P2048": "Height",
    "P2049": "Width",
    "P276": "Location",
    "P195": "Collection",
    "P217": "Inventory number",
    "P6216": "Copyright status",
}
UNITS = {"Q174728": "cm", "Q11573": "m", "Q174789": "mm", "Q218593": "in"}
ARTIC_ID = "P4610"
EDITORIAL_PATH = (
    r"/(?:essays?|perspectives|exhibitions|press|press-releases|stories|articles?|blogs?|read)/"
)
# Object ids Wikidata records for museums whose collection pages search returns: the Met and Chicago.
COLLECTION_PAGES = {
    "P3634": "https://www.metmuseum.org/art/collection/search/{}",
    ARTIC_ID: "https://www.artic.edu/artworks/{}",
}


class SourceDoc(TypedDict):
    url: str
    label: str
    score: float
    text: str
    referenceUrl: NotRequired[str]


def host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".").removeprefix("www.")


def source_identity(url: str) -> str:
    parts = urlsplit(url)
    if host(url) == "artic.edu":
        # Chicago's numeric collection URLs and title-suffixed URLs identify the same object.
        match = re.fullmatch(r"/artworks/(\d+)(?:/[^/]+)?/?", parts.path)
        if match:
            return f"artic.edu/artworks/{match[1]}"
    if host(url) == "metmuseum.org":
        match = re.fullmatch(r"/(?:[a-z]{2}/)?art/collection/search/(\d+)/?", parts.path)
        object_id = (
            match[1]
            if match
            else dict(parse_qsl(parts.query)).get("oid")
            if parts.path == "/exhibitions/view"
            else None
        )
        if object_id and object_id.isdigit():
            return f"metmuseum.org/art/collection/search/{object_id}"
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query)
        if not k.startswith("utm_") and k not in {"lang", "fbclid", "gclid"}
    ]
    path = unquote(parts.path).replace(" ", "_").rstrip("/")
    return host(url) + path + ("?" + urlencode(sorted(query)) if query else "")


COLLECTION_IDENTITIES = {
    "P3634": r"metmuseum\.org/art/collection/search/(\d+)",
    ARTIC_ID: r"artic\.edu/artworks/(\d+)",
}


def collection_object(url: str) -> tuple[str, str] | None:
    identity = source_identity(url)
    for prop, pattern in COLLECTION_IDENTITIES.items():
        if match := re.fullmatch(pattern, identity):
            return prop, match[1]
    return None


# Inline tags go without a space so a quoted sentence reads as it does on the page.
def html_paragraphs(html: str) -> str:
    text = unescape(
        re.sub(r"<[^>]+>", "", re.sub(r"</p>|<br\s*/?>", "\n", html, flags=re.IGNORECASE))
    )
    return "\n".join(line for line in (" ".join(part.split()) for part in text.split("\n")) if line)


def links_to_artwork(text: str, page_url: str, anchors: set[str]) -> bool:
    if not re.search(EDITORIAL_PATH, urlsplit(page_url).path):
        return False
    for link in re.findall(r"\]\(([^\s)]+)\)", text):
        try:
            if source_identity(urljoin(page_url, link)) in anchors:
                return True
        except ValueError:
            continue
    return False


# Search pages as plain prose, so facts copied verbatim match (convex/lib/docentSources.ts).
def plain_markdown(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)", r"\1", text)
    text = re.sub(r"^#{1,6}[ \t]+", "", text, flags=re.MULTILINE)
    text = re.sub(r"(\*{1,3})(?=\S)([^*\n]+?)(?<=\S)\1", r"\2", text)
    text = re.sub(r"(?<![\w_])(_{1,3})(?=\S)([^_\n]+?)(?<=\S)\1(?![\w_])", r"\2", text)
    return re.sub(r"\n{3,}", "\n\n", text)


def source_score(url: str, owner_hosts: Sequence[str] = ()) -> float | None:
    try:
        parts = urlsplit(url)
        domain = host(url)
        if parts.scheme not in ("https", "http") or not domain or parts.username or parts.password:
            return None
    except ValueError:
        return None
    if any(domain == d or domain.endswith("." + d) for d in SCORES["excluded"]):
        return None
    if re.search(
        r"^(?:shop|store|customprints|prints)\.|/(?:shop|store|products?)(?:/|$)",
        domain + parts.path,
        re.IGNORECASE,
    ):
        return None
    if any(domain == d or domain.endswith("." + d) for d in owner_hosts):
        return 1.0
    score = next(
        (s for d, s in SCORES["domains"].items() if domain == d or domain.endswith("." + d)),
        SCORES["default"],
    )
    return score if score >= SCORES["threshold"] else None


def admissible_domains(owner_hosts: list[str]) -> list[str]:
    return list(
        dict.fromkeys(
            [
                *[d for d, score in SCORES["domains"].items() if score >= SCORES["threshold"]],
                *[d for d in owner_hosts if source_score("https://" + d, owner_hosts) is not None],
            ]
        )
    )


def identity_text(value: str) -> str:
    plain = "".join(
        c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c)
    ).lower()
    return " ".join("".join(c if c.isalnum() else " " for c in plain).split())


def identifies_owner_work(
    text: str,
    url: str,
    artwork: dict,
    accession: str | None,
    titles: list[str],
    owner_hosts: list[str],
) -> bool:
    if not re.search(EDITORIAL_PATH, urlsplit(url).path):
        return False
    if not accession or not any(host(url) == d or host(url).endswith("." + d) for d in owner_hosts):
        return False
    accession_pattern = re.compile(
        r"(^|[^\w./-])" + re.escape(accession) + r"(?!\w|[./-]\w)", re.IGNORECASE
    )
    artist = identity_text(artwork["artist"])
    if not accession or not artist:
        return False
    for paragraph in re.split(r"\n\s*\n", text):
        if len(paragraph) > 1000:
            continue
        normalized = " " + identity_text(paragraph) + " "
        if (
            accession_pattern.search(paragraph)
            and f" {artist} " in normalized
            and any(identity_text(t) and f" {identity_text(t)} " in normalized for t in titles)
        ):
            return True
    return False


def thin_research(sources: list[SourceDoc]) -> bool:
    return (
        sum(
            len(s["text"])
            for s in trim_sources(sorted(sources, key=lambda s: -s["score"]))
            if host(s["url"]) != "wikidata.org"
        )
        < RESEARCH_POLICY["minimumTextChars"]
    )


def trim_sources(sources: list[SourceDoc]) -> list[SourceDoc]:
    seen: set[str] = set()
    trimmed: list[SourceDoc] = []
    remaining = TOTAL_CHARS
    for source in sources:
        lines = []
        for line in source["text"].split("\n"):
            key = source_passage(line)
            if len(key) >= MIN_PASSAGE_CHARS:
                if key in seen:
                    continue
                seen.add(key)
            lines.append(line)
        text = "\n".join(lines).strip()[: max(0, remaining)]
        if not text:
            continue
        remaining -= len(text)
        trimmed.append({**source, "text": text})
    return trimmed


def page_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup.select("script,style,nav,header,footer,aside,form,noscript,svg"):
        element.decompose()
    body = soup.find("main") or soup.find("article") or soup
    return re.sub(r"\s+", " ", body.get_text(" ", strip=True)).strip()[:MAX_CHARS]


# The REST summary endpoint is under Wikipedia's robots-disallowed /api/ prefix; the article's
# lead paragraphs (everything before the first section heading) are the equivalent extract.
def wikipedia_lead(html: str) -> str:
    body = BeautifulSoup(html, "html.parser").select_one(".mw-parser-output")
    if body is None:
        return ""
    # Parsoid output wraps each section, the lead first; legacy output puts children inline.
    first = body.find("section")
    paragraphs = []
    for child in (first or body).children:
        if not isinstance(child, Tag):
            continue
        if child.name in ("h2", "h3") or "mw-heading" in child.get("class", []):
            break
        if child.name != "p":
            continue
        for reference in child.select("sup.reference"):
            reference.decompose()
        text = re.sub(r"\s+", " ", child.get_text(" ", strip=True))
        # Links end before their trailing punctuation, which get_text separates with a space.
        text = re.sub(r" (?=[,.;:)\]])|(?<=[(\[]) ", "", text).strip()
        if text:
            paragraphs.append(text)
    return " ".join(paragraphs)[:MAX_CHARS]


def wikipedia_url(title: str, language: str = "en") -> str:
    # MediaWiki leaves these characters unencoded in canonical URLs, so the fetched URL matches
    # the form search results use and dedupes against them.
    return f"https://{language}.wikipedia.org/wiki/" + quote(
        title.replace(" ", "_"), safe=";:@$!*(),/~"
    )


def claims_for(entity: dict, prop: str) -> list[dict]:
    claims = [c for c in entity.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated"]
    preferred = [c for c in claims if c.get("rank") == "preferred"]
    return preferred or claims


def claim_values(entity: dict, prop: str) -> list:
    return [
        c["mainsnak"]["datavalue"]["value"]
        for c in claims_for(entity, prop)
        if c.get("mainsnak", {}).get("snaktype") == "value" and "datavalue" in c["mainsnak"]
    ]


class SourceGatherer:
    def __init__(
        self,
        http: PoliteClient,
        search: Callable[[str, list[str]], list[dict]],
        query: Callable[[str], list[dict]] | None = None,
        *,
        extract: Callable[[list[str]], list[dict]],
    ):
        self.http = http
        self.search = search
        self.extract = extract
        self.query = query or (lambda text: sparql(text, user_agent=http.user_agent))
        self.labels: dict[str, str] = {}

    def _json(self, url: str, allowed_host: str) -> dict:
        response = self.http.get(url, allowed_hosts=frozenset({allowed_host}))
        response.raise_for_status()
        return response.json()

    def _wikidata(self, qid: str) -> tuple[str, dict]:
        if not re.fullmatch(r"Q[1-9][0-9]*", qid):
            raise ValueError("Invalid Wikidata ID")
        entity = self._json(
            f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", "wikidata.org"
        )["entities"][qid]
        values = {prop: claim_values(entity, prop) for prop in PROPERTIES}
        item_ids = list(
            dict.fromkeys(
                v["id"] for vs in values.values() for v in vs if isinstance(v, dict) and "id" in v
            )
        )
        copyright_claims = claims_for(entity, "P6216")
        for claim in copyright_claims:
            for snaks in claim.get("qualifiers", {}).values():
                for snak in snaks:
                    value = snak.get("datavalue", {}).get("value")
                    if isinstance(value, dict) and "id" in value:
                        item_ids.append(value["id"])
        for item_id in item_ids:
            if item_id in self.labels:
                continue
            try:
                data = self._json(
                    f"https://www.wikidata.org/wiki/Special:EntityData/{item_id}.json",
                    "wikidata.org",
                )
                self.labels[item_id] = (
                    data["entities"][item_id].get("labels", {}).get("en", {}).get("value", "")
                )
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Wikidata label unavailable for %s: %s", item_id, error)
        labels = self.labels
        lines = []
        label = entity.get("labels", {}).get("en", {}).get("value")
        if label:
            lines.append(f"Label: {label}")
        for prop, vs in values.items():
            if prop == "P6216":
                statements = []
                for claim in copyright_claims:
                    status_id = (
                        claim.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")
                    )
                    if not labels.get(status_id):
                        continue
                    qualifiers = {}
                    complete = True
                    for prop_id, snaks in claim.get("qualifiers", {}).items():
                        qualified_values = []
                        for snak in snaks:
                            value = snak.get("datavalue", {}).get("value")
                            if isinstance(value, dict) and labels.get(value.get("id")):
                                qualified_values.append(labels[value["id"]])
                            else:
                                complete = False
                        qualifiers[
                            {"P1001": "jurisdiction", "P459": "determination method"}.get(
                                prop_id, prop_id
                            )
                        ] = qualified_values
                    if complete:
                        statements.append({"status": labels[status_id], "qualifiers": qualifiers})
                if statements:
                    lines.append(
                        "Copyright statements (retain qualifiers): "
                        + json.dumps(statements, ensure_ascii=False)
                    )
                continue
            rendered = []
            for value in vs:
                if isinstance(value, str):
                    rendered.append(value)
                elif isinstance(value, dict):
                    if value.get("id") in labels and labels[value["id"]]:
                        rendered.append(labels[value["id"]])
                    elif "text" in value:
                        rendered.append(value["text"])
                    elif "time" in value:
                        # Coarse dates must not become an exact year in a generated fact.
                        match = re.match(r"([+-])(\d+)-", value["time"])
                        if match and value.get("precision", 0) >= 9:
                            year = int(match[2])
                            rendered.append(f"{year} BCE" if match[1] == "-" else str(year))
                    elif "amount" in value:
                        unit = UNITS.get(value.get("unit", "").rsplit("/", 1)[-1])
                        if unit:
                            rendered.append(f"{value['amount'].removeprefix('+')} {unit}")
            if rendered:
                lines.append(f"{PROPERTIES[prop]}: {', '.join(dict.fromkeys(rendered))}")
        return "\n".join(lines), entity

    def gather(self, artwork: dict, context: dict) -> list[SourceDoc]:
        sources: dict[str, SourceDoc] = {}
        page_url, owner = context.get("pageUrl"), context.get("owner")
        owner_hosts = [
            host(owner[k]) for k in ("website", "collectionSiteUrl") if owner and owner.get(k)
        ]
        owner_hosts = [h for h in owner_hosts if h]
        titles = [artwork["title"]]
        articles = []
        references = []
        commons_file = None

        def add(url, label, text, score=None):
            score = source_score(url, owner_hosts) if score is None else score
            # One source per page, whatever language or tracking parameter search found it under.
            key = source_identity(url)
            previous = sources.get(key)
            if (
                score is not None
                and text.strip()
                and (not previous or len(text.strip()) > len(previous["text"]))
            ):
                # The longer text wins; the owner's page keeps its URL, label and score.
                sources[key] = SourceDoc(
                    url=previous["url"] if previous else url,
                    label=previous["label"] if previous else label,
                    score=previous["score"] if previous else score,
                    text=text.strip()[:MAX_CHARS],
                )

        owner_object = collection_object(page_url) if page_url else None
        qid = artwork.get("wikidataId")
        # Works imported from the Met or Chicago carry no Wikidata id; their object id finds the item.
        if not qid and owner_object:
            prop, object_id = owner_object
            try:
                rows = self.query(
                    f'SELECT ?item WHERE {{ ?item wdt:{prop} "{object_id}" }} LIMIT 2'
                )
                if len(rows) == 1:
                    qid = rows[0]["item"]["value"].rsplit("/", 1)[-1]
            except (httpx.HTTPError, KeyError, ValueError) as error:
                log.warning("Wikidata item lookup unavailable: %s", error)
        wikidata_page = source_identity(f"https://www.wikidata.org/wiki/{qid}") if qid else None
        artic_id = owner_object[1] if owner_object and owner_object[0] == ARTIC_ID else None
        anchors = {source_identity(page_url)} if page_url else set()
        if wikidata_page:
            anchors.add(wikidata_page)
        if page_url and urlsplit(page_url).scheme == "http":
            page_url = urlsplit(page_url)._replace(scheme="https").geturl()
        # The venue's own page is canonical once the host check passes (convex/lib/docentSources.ts).
        if page_url and owner:
            try:
                hosts = frozenset(owner_hosts)
                response = self.http.get(page_url, allowed_hosts=hosts)
                response.raise_for_status()
                add(str(response.url), owner["name"], page_text(response.text), score=1.0)
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Owner page unavailable: %s", error)
        if qid:
            try:
                summary, entity = self._wikidata(qid)
                references.extend(wikidata_references(entity))
                commons_file = next(iter(claim_values(entity, "P18")), None)
                artic_id = artic_id or next(
                    (
                        v
                        for v in claim_values(entity, ARTIC_ID)
                        if isinstance(v, str) and v.isdigit()
                    ),
                    None,
                )
                anchors.update(
                    source_identity(page.format(value))
                    for prop, page in COLLECTION_PAGES.items()
                    for value in claim_values(entity, prop)
                    if isinstance(value, str)
                )
                add(f"https://www.wikidata.org/wiki/{qid}", "Wikidata", summary)
                for language in RESEARCH_POLICY["languages"]:
                    label = entity.get("labels", {}).get(language, {}).get("value")
                    if label:
                        titles.append(label)
                    titles.extend(
                        alias["value"] for alias in entity.get("aliases", {}).get(language, [])
                    )
                    title = entity.get("sitelinks", {}).get(f"{language}wiki", {}).get("title")
                    if title:
                        articles.append((title, language))
                        anchors.add(source_identity(wikipedia_url(title, language)))
                titles.extend(
                    v["text"]
                    for v in claim_values(entity, "P1476")
                    if isinstance(v, dict) and v.get("text")
                )
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Wikidata unavailable: %s", error)

        def read_article(article):
            title, language = article
            url = wikipedia_url(title, language)
            try:
                response = self.http.get(
                    url, allowed_hosts=frozenset({f"{language}.wikipedia.org"})
                )
                response.raise_for_status()
                text = wikipedia_lead(response.text)
                if text:
                    add(url, "Wikipedia", text)
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Wikipedia unavailable: %s", error)

        english_article = next((a for a in articles if a[1] == "en"), None)
        if english_article:
            read_article(english_article)
        # Chicago's website refuses our fetcher; its public API carries the curatorial text (CC BY 4.0).
        if artic_id:
            try:
                response = self.http.get(
                    f"https://api.artic.edu/api/v1/artworks/{artic_id}?fields=description,short_description",
                    headers={"AIC-User-Agent": self.http.user_agent},
                    allowed_hosts=frozenset({"api.artic.edu"}),
                )
                if response.status_code != 404:
                    response.raise_for_status()
                    data = response.json()["data"]
                    text = "\n".join(
                        html_paragraphs(data[k])
                        for k in ("description", "short_description")
                        if isinstance(data.get(k), str)
                    )
                    add(
                        f"https://www.artic.edu/artworks/{artic_id}",
                        "Art Institute of Chicago",
                        text,
                    )
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Art Institute API unavailable: %s", error)

        def search_sources(query, fallback=False):
            for result in self.search(query, admissible_domains(owner_hosts)):
                url, content = result.get("url"), result.get("raw_content") or result.get("content")
                if not isinstance(url, str) or not isinstance(content, str) or not content.strip():
                    continue
                if source_score(url, owner_hosts) is None:
                    continue
                identity = source_identity(url)
                if identity == wikidata_page:
                    continue
                plain = plain_markdown(content)
                if (
                    (anchors or fallback)
                    and identity not in anchors
                    and not links_to_artwork(content, url, anchors)
                    and not identifies_owner_work(
                        plain, url, artwork, context.get("accession"), titles, owner_hosts
                    )
                ):
                    continue
                add(url, host(url), f"{result.get('title', '')}\n{plain}")

        def quoted(value):
            return '"' + value.replace('"', "") + '"'

        owner_name = (owner or {}).get("name", "painting")
        searched = False
        try:
            search_sources(f"{quoted(artwork['title'])} {artwork['artist']} {owner_name}")
            searched = True
        except (httpx.HTTPError, RuntimeError) as error:
            log.warning("Search unavailable: %s", error)
        if thin_research(list(sources.values())):
            other_article = next((a for a in articles if a[1] != "en"), None)
            if other_article:
                read_article(other_article)
            if searched and thin_research(list(sources.values())):
                alternate = next(
                    (t for t in titles if identity_text(t) != identity_text(artwork["title"])), None
                )
                term = context.get("accession") or alternate
                query = (
                    f"{quoted(term)} {artwork['artist']} {owner_name}"
                    if term
                    else f"{artwork['title'].replace(chr(34), '')} {artwork['artist']} history technique"
                )
                # Optional expansion must not discard evidence if its credit cap or provider fails.
                try:
                    search_sources(query, fallback=True)
                except (httpx.HTTPError, RuntimeError) as error:
                    log.warning("Fallback search unavailable: %s", error)
        if isinstance(commons_file, str):
            reference_url = "https://commons.wikimedia.org/wiki/File:" + quote(
                commons_file.replace(" ", "_"), safe=""
            )
            try:
                response = self.http.get(
                    reference_url, allowed_hosts=frozenset({"commons.wikimedia.org"})
                )
                response.raise_for_status()
                references.extend(commons_references(response.text, reference_url))
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError) as error:
                log.warning("Commons references unavailable: %s", error)
        selected = {}
        for reference in bounded_references(references):
            existing = sources.get(source_identity(reference["url"]))
            if existing:
                existing["referenceUrl"] = reference["referenceUrl"]
            else:
                selected[reference["url"]] = reference
        if selected:
            try:
                for result in self.extract(list(selected)):
                    reference = selected.get(result.get("url"))
                    text = result.get("raw_content")
                    if reference and isinstance(text, str) and len(text.strip()) >= 80:
                        sources[source_identity(reference["url"])] = {
                            **reference,
                            "label": host(reference["url"]),
                            "score": SCORES["domains"]["wikidata.org"],
                            "text": text.strip()[:MAX_CHARS],
                        }
            except (httpx.HTTPError, RuntimeError, ValueError) as error:
                log.warning("Reference extraction unavailable: %s", error)
        ordered = sorted(sources.values(), key=lambda s: -s["score"])
        # References retain their per-page limit until review without consuming catalogue space.
        catalogue = trim_sources([s for s in ordered if not s.get("referenceUrl")])
        return sorted(
            catalogue + [s for s in ordered if s.get("referenceUrl")], key=lambda s: -s["score"]
        )

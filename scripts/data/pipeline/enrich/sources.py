import json
import logging
import re
from collections.abc import Callable
from typing import TypedDict
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup, Tag

from pipeline.model_version import REPO_ROOT
from pipeline.polite_http import PoliteClient, RetryLater, RobotsDisallowed

log = logging.getLogger(__name__)
SCORES = json.loads((REPO_ROOT / "shared/sources/source-scores.json").read_text())
MAX_CHARS = 24_000
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


class SourceDoc(TypedDict):
    url: str
    label: str
    score: float
    text: str


def host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".").removeprefix("www.")


def source_identity(url: str) -> str:
    parts = urlsplit(url)
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


def links_to_artwork(text: str, page_url: str, anchors: set[str]) -> bool:
    if not re.search(
        r"/(?:essays|perspectives|exhibitions|press|press-releases|stories|articles|blog)/",
        urlsplit(page_url).path,
    ):
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


def source_score(url: str) -> float | None:
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
    score = next(
        (s for d, s in SCORES["domains"].items() if domain == d or domain.endswith("." + d)),
        SCORES["default"],
    )
    return score if score >= SCORES["threshold"] else None


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


def wikipedia_url(title: str) -> str:
    # MediaWiki leaves these characters unencoded in canonical URLs, so the fetched URL matches
    # the form search results use and dedupes against them.
    return "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe=";:@$!*(),/~")


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
    def __init__(self, http: PoliteClient, search: Callable[[str], list[dict]]):
        self.http = http
        self.search = search
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

        def add(url, label, text, score=None):
            score = source_score(url) if score is None else score
            previous = sources.get(url)
            if (
                score is not None
                and text.strip()
                and (not previous or len(text.strip()) > len(previous["text"]))
            ):
                # The longer text wins; the owner's page keeps its label and score.
                sources[url] = SourceDoc(
                    url=url,
                    label=previous["label"] if previous else label,
                    score=previous["score"] if previous else score,
                    text=text.strip()[:MAX_CHARS],
                )

        page_url, owner = context.get("pageUrl"), context.get("owner")
        anchors = {source_identity(page_url)} if page_url else set()
        if artwork.get("wikidataId"):
            anchors.add(source_identity(f"https://www.wikidata.org/wiki/{artwork['wikidataId']}"))
        if page_url and urlsplit(page_url).scheme == "http":
            page_url = urlsplit(page_url)._replace(scheme="https").geturl()
        # The venue's own page is canonical once the host check passes (convex/lib/docentSources.ts).
        if page_url and owner:
            try:
                hosts = frozenset(
                    host(owner[k]) for k in ("website", "collectionSiteUrl") if owner.get(k)
                )
                response = self.http.get(page_url, allowed_hosts=hosts)
                response.raise_for_status()
                add(str(response.url), owner["name"], page_text(response.text), score=1.0)
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Owner page unavailable: %s", error)
        if qid := artwork.get("wikidataId"):
            try:
                summary, entity = self._wikidata(qid)
                add(f"https://www.wikidata.org/wiki/{qid}", "Wikidata", summary)
                title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
                if title:
                    url = wikipedia_url(title)
                    anchors.add(source_identity(url))
                    response = self.http.get(url, allowed_hosts=frozenset({"en.wikipedia.org"}))
                    response.raise_for_status()
                    add(str(response.url), "Wikipedia", wikipedia_lead(response.text))
            except (httpx.HTTPError, RetryLater, RobotsDisallowed, ValueError, KeyError) as error:
                log.warning("Wikidata/Wikipedia unavailable: %s", error)
        title = artwork["title"].replace('"', "")
        owner_name = (owner or {}).get("name", "painting")
        for result in self.search(f'"{title}" {artwork["artist"]} {owner_name}'):
            url, content = result.get("url"), result.get("raw_content") or result.get("content")
            if isinstance(url, str) and isinstance(content, str) and content.strip():
                # Domain trust cannot distinguish multiple paintings called Sunflowers or Bathers.
                if (
                    anchors
                    and source_identity(url) not in anchors
                    and not links_to_artwork(content, url, anchors)
                ):
                    continue
                add(url, host(url), f"{result.get('title', '')}\n{plain_markdown(content)}")
        return sorted(sources.values(), key=lambda s: -s["score"])

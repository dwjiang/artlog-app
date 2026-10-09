"""Isabella Stewart Gardner Museum, Boston: the room guides, which list every work by wall.

The founder's installation is permanent, so a work a guide lists is on view. Guides name no inventory
numbers; a guide entry is tied to the Wikidata item of the collection whose title matches it and whose
artist's surname it names, or whose title matches exactly when the artist is unknown. Entries or items
that match more than once are left out.
"""

import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from bs4 import BeautifulSoup

from ..polite_http import PoliteClient
from ..wikidata import sparql
from .onview import FeedRow, write_snapshot

OWNER_KEY = "wikidata:Q49135"
ROBOTS = True
SITE = "https://www.gardnermuseum.org"
TITLE_SIMILARITY = 0.85
UNKNOWN_ARTISTS = frozenset({"", "unknown", "anonymous", "unknown artist"})
ITEMS_QUERY = """SELECT ?item ?itemLabel ?inv ?creatorLabel WHERE {
  ?item wdt:P195 wd:Q49135 .
  OPTIONAL { ?item wdt:P217 ?inv }
  OPTIONAL { ?item wdt:P170 ?creator }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}"""


def fetch(client: PoliteClient, out: Path) -> dict:
    index = BeautifulSoup(get(client, f"{SITE}/experience/rooms"), "html.parser")
    entries = []
    for path in sorted({a["href"] for a in index.select('a[href^="/experience/rooms/"]')}):
        room = BeautifulSoup(get(client, SITE + path), "html.parser")
        guide = room.find("a", href=re.compile(r"/isgm_rooms/modals/room/\d+/guide/nojs$"))
        if guide is None:
            continue
        name = room.find("h1").get_text(" ", strip=True)
        entries += parse_guide(name, SITE + path, get(client, guide["href"]))
    items = defaultdict(lambda: {"titles": set(), "accessions": set(), "artists": set()})
    for binding in sparql(ITEMS_QUERY, user_agent=client.user_agent):
        item = items[binding["item"]["value"].rsplit("/", 1)[1]]
        item["titles"].add(binding["itemLabel"]["value"])
        if "inv" in binding:
            item["accessions"].add(binding["inv"]["value"])
        if "creatorLabel" in binding:
            item["artists"].add(binding["creatorLabel"]["value"])
    return write_snapshot(out, match(entries, items), minimum_on_view=100)


def get(client: PoliteClient, url: str) -> str:
    response = client.get(url)
    response.raise_for_status()
    return response.text


def parse_guide(room: str, url: str, html: str) -> list[dict]:
    page = BeautifulSoup(html, "html.parser")
    walls = {
        item["data-modal-main-target"]: item.get_text(" ", strip=True)
        for item in page.select(".nav__item[data-modal-main-target]")
    }
    entries = []
    for wall in page.select("div.wall-guide-content[data-modal-wall-index]"):
        index = wall["data-modal-wall-index"]
        name = walls.get(index, room)
        for heading in wall.find_all("h4"):
            number, _, title = heading.get_text(" ", strip=True).partition(". ")
            detail = heading.find_next_sibling("p")
            detail = detail.get_text(" ", strip=True) if detail else ""
            # Frames stolen in 1990 still hang empty, and photographs stand in for fragile works.
            if not number.isdigit() or re.search(
                r"\bstolen\b|\breproduction", detail, re.IGNORECASE
            ):
                continue
            entries.append(
                {
                    "id": f"{url.rsplit('/', 1)[1]}.{index}.{number}",
                    "title": title.rstrip(",.;: "),
                    "detail": detail,
                    "url": url,
                    "gallery": room if name == room else f"{room}, {name}",
                }
            )
    return entries


def normal(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^\w\s]", " ", text.casefold()).split())


def match(entries: list[dict], items: dict[str, dict]) -> list[FeedRow]:
    prepared = [
        (entry["id"], normal(entry["title"]), set(normal(entry["detail"]).split()))
        for entry in entries
    ]
    found = defaultdict(set)
    claims = defaultdict(set)
    for item, fields in items.items():
        surnames = {
            normal(artist).rsplit(" ", 1)[-1]
            for artist in fields["artists"]
            if normal(artist) not in UNKNOWN_ARTISTS
        }
        titles = {normal(title) for title in fields["titles"]}
        for entry_id, title, words in prepared:
            if surnames:
                ok = bool(surnames & words) and any(
                    SequenceMatcher(None, title, candidate).ratio() >= TITLE_SIMILARITY
                    for candidate in titles
                )
            else:
                ok = title in titles
            if ok:
                found[item].add(entry_id)
                claims[entry_id].add(item)
    by_id = {entry["id"]: entry for entry in entries}
    rows = []
    for entry_id, claimants in sorted(claims.items()):
        if len(claimants) != 1:
            continue
        item = next(iter(claimants))
        if len(found[item]) != 1:
            continue
        entry = by_id[entry_id]
        accessions = items[item]["accessions"]
        rows.append(
            {
                "id": entry_id,
                "wikidataId": item,
                "accession": next(iter(accessions)) if len(accessions) == 1 else None,
                "title": entry["title"],
                "artist": "; ".join(sorted(items[item]["artists"])) or None,
                "url": entry["url"],
                "onView": True,
                "gallery": entry["gallery"],
            }
        )
    return rows

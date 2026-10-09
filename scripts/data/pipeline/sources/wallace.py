"""The Wallace Collection, London: pictures and miniatures by room from its eMuseumPlus collection site.

The site has no API. Its search form filters by location, one session-bound result list at a time.
"""

import logging
import re
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

log = logging.getLogger(__name__)

OWNER_KEY = "wikidata:Q1327919"
ROBOTS = True
SITE = "https://wallacelive.wallacecollection.org"
APP = f"{SITE}/eMP/eMuseumPlus"
SEARCH_PAGE = f"{APP}?service=ExternalInterface&module=collection&moduleFunction=search"
PICTURES_AND_MINIATURES = "13"
LOCATION_FIELD = "field_10365"
OFF_VIEW = frozenset({"not on display", "this object is currently on short term loan"})
FORM_FIELDS = (
    "fullTextField",
    "$PropertySelection",
    "$PropertySelection$0",
    "textfield",
    "textfield$0",
    "$PropertySelection$1",
    "$ValidField",
    "$ValidField$0",
    "$PropertySelection$2",
    "$PropertySelection$3",
    "textfield$1",
    "$PropertySelection$4",
    "$PropertySelection$5",
)


def fetch(client: PoliteClient, out: Path) -> dict:
    page = BeautifulSoup(get(client, SEARCH_PAGE), "html.parser")
    locations = {
        option["value"]: option.get_text(strip=True)
        for option in page.select(f"select#{LOCATION_FIELD} option")
        if option["value"] != "0"
    }
    works: dict[str, dict] = {}
    found: defaultdict[str, set[str]] = defaultdict(set)
    for value, name in locations.items():
        for item in search(client, value):
            works[item["objectId"]] = item
            found[item["objectId"]].add(name)
        log.info("Wallace: %s, %d works so far", name, len(works))
    rows: list[FeedRow] = []
    for object_id, item in works.items():
        # The location filter matches prefixes regardless of case ("Boudoir" also finds the Boudoir
        # Cabinet), so a work's room is the longest name that found it.
        location = max(sorted(found[object_id]), key=len)
        rows.append(
            {
                "id": object_id,
                "accession": item["accession"],
                "title": item["title"],
                "artist": item["artist"],
                "url": f"{APP}?service=ExternalInterface&module=collection&objectId={object_id}"
                "&viewType=detailView",
                "onView": location.casefold() not in OFF_VIEW,
                "gallery": location,
            }
        )
    return write_snapshot(out, rows, minimum_on_view=600)


def get(client: PoliteClient, url: str) -> str:
    response = client.get(url)
    response.raise_for_status()
    return response.text


def search(client: PoliteClient, location: str) -> list[dict]:
    form = {field: "0" if "$PropertySelection" in field else "" for field in FORM_FIELDS} | {
        "service": "direct/1/SearchPage/search.searchForm",
        "sp": "S1",
        "Form1": ",".join(FORM_FIELDS),
        "$PropertySelection": PICTURES_AND_MINIATURES,
        "$PropertySelection$4": location,
    }
    response = client.post(APP, data=form)
    if response.status_code != 302:
        response.raise_for_status()
        raise RuntimeError(f"Wallace search answered {response.status_code} without results")
    html = get(client, response.headers["Location"])
    total = result_count(html)
    if not total:
        return []
    if "simpleListItem-0" not in html:
        html = get(client, SITE + link(html, r"Summary List"))
    items = parse_items(html)
    while len(items) < total:
        # The navigator labels pages by their range, such as "22 - 42".
        html = get(client, SITE + link(html, rf"{len(items) + 1}(\s*-\s*\d+)?"))
        page = parse_items(html)
        if not page:
            raise RuntimeError("Wallace result paging stalled")
        items += page
    return items


def result_count(html: str) -> int:
    text = BeautifulSoup(html, "html.parser").get_text(" ")
    match = re.search(r"Results:\s*(\d+)", text.replace("\xa0", " "))
    return int(match[1]) if match else 0


def link(html: str, label: str) -> str:
    for anchor in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        if re.fullmatch(label, anchor.get_text(" ", strip=True)):
            return anchor["href"]
    raise RuntimeError(f"Wallace result page has no {label!r} link")


def parse_items(html: str) -> list[dict]:
    items = []
    for entry in BeautifulSoup(html, "html.parser").select("dl.simpleListItem"):
        bookmark = entry.select_one("a.Bookmark")
        values = {
            name: (node.get_text(" ", strip=True) if node else None)
            for name, node in (
                ("accession", entry.select_one("li.ListMuseumno .tspValue")),
                ("title", entry.select_one("li.ListTitlepic")),
                ("artist", entry.select_one(".tspReferenceLink")),
            )
        }
        items.append({"objectId": re.search(r"objectId=(\d+)", bookmark["href"])[1], **values})
    return items

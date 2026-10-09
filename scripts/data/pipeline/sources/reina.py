"""Museo Reina Sofía, Madrid: works its collection search marks as exposed, with rooms from room pages."""

import json
import re
from pathlib import Path
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

OWNER_KEY = "wikidata:Q460889"
ROBOTS = True
SEARCH = "https://buscador.museoreinasofia.es/api/search"
SITE = "https://www.museoreinasofia.es"
PAGE_SIZE = 500
# Collection itineraries whose floor plans link every room.
ROOM_INDEXES = (
    "/colecciones/territorios-vanguardia",
    "/colecciones/coleccion-arte-contemporaneo-1975-presente",
)
ROOM_PATH = re.compile(r"/colecciones/sala-[\w-]+")


def fetch(client: PoliteClient, out: Path) -> dict:
    works, page = [], 1
    while True:
        query = {"bundle": "artwork", "exposed": "exposed", "langcode": "es"}
        body = get_json(
            client, f"{SEARCH}?{urlencode(query | {'pageSize': PAGE_SIZE, 'page': page})}"
        )
        works += body["results"]
        if page >= body["metadata"]["totalPages"]:
            break
        page += 1
    if len(works) != body["metadata"]["totalResults"]:
        raise RuntimeError("Reina Sofía search count changed during paging")
    rooms = {}
    for index in ROOM_INDEXES:
        rooms |= dict.fromkeys(ROOM_PATH.findall(json.dumps(page_data(client, index))))
    galleries = {}
    for path in rooms:
        content = page_data(client, path)["result"]["pageContext"]["node"]["data"]["content"]
        name = next(
            (item["title"] for item in content["translations"] if item["language"]["id"] == "en"),
            content["title"],
        )
        for artwork in (content.get("artworks") or {}).get("data", []):
            galleries[artwork["url"]["path"]] = name
    return write_snapshot(out, [row(work, galleries) for work in works], minimum_on_view=800)


def get_json(client: PoliteClient, url: str) -> dict:
    response = client.get(url)
    response.raise_for_status()
    return response.json()


def page_data(client: PoliteClient, path: str) -> dict:
    return get_json(client, f"{SITE}/page-data{path}/page-data.json")


def text(value: dict | None) -> str | None:
    """Titles and names arrive as HTML fragments such as "<p>Hammer, Barbara</p>"."""
    html = (value or {}).get("value")
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True) if html else None


def row(work: dict, galleries: dict[str, str]) -> FeedRow:
    path = work["url"]["path"]
    author = next(iter(work.get("author") or []), {}).get("entity", {})
    return {
        "id": work["id"],
        "accession": work.get("registryID"),
        "title": text(work.get("title")),
        "artist": text(author.get("name")),
        "url": SITE + path,
        "onView": work.get("artworkStatus") == "exposed",
        "gallery": galleries.get(path),
    }

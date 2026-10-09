"""Museo Nacional Thyssen-Bornemisza, Madrid: each collection page's room, found through the sitemap.

The site's own search is closed to crawlers, so every artwork page is read once (about 1,100).
"""

import json
import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from bs4 import BeautifulSoup

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

log = logging.getLogger(__name__)

OWNER_KEY = "wikidata:Q176251"
ROBOTS = True
SITEMAP = "https://www.museothyssen.org/sitemap.xml"
ARTWORK_PAGE = re.compile(r"https://www\.museothyssen\.org/coleccion/artistas/[^/]+/[^/]+")
NOT_ON_VIEW = "No expuesta"
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def fetch(client: PoliteClient, out: Path) -> dict:
    """Pages are cached under `out`, so a rerun resumes where it stopped."""
    pages = out / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    urls = []
    index = ET.fromstring(get(client, SITEMAP))
    for sitemap in index.iterfind("sm:sitemap/sm:loc", SITEMAP_NS):
        listing = ET.fromstring(get(client, sitemap.text))
        urls += [
            loc.text
            for loc in listing.iterfind("sm:url/sm:loc", SITEMAP_NS)
            if ARTWORK_PAGE.fullmatch(loc.text)
        ]
    rows: list[FeedRow] = []
    for number, url in enumerate(sorted(set(urls)), 1):
        path = pages / (url.rsplit("/", 2)[-2] + "--" + url.rsplit("/", 1)[-1] + ".html")
        if not path.exists():
            path.write_bytes(get(client, url))
        if row := parse_page(url, path.read_text()):
            rows.append(row)
        if number % 100 == 0:
            log.info("Thyssen: %d/%d pages", number, len(set(urls)))
    return write_snapshot(out, rows, minimum_on_view=400)


def get(client: PoliteClient, url: str) -> bytes:
    response = client.get(url)
    response.raise_for_status()
    return response.content


def parse_page(url: str, html: str) -> FeedRow | None:
    """None for a page without a room field, such as a decorative object outside the galleries."""
    match = re.search(r"dataLayer\.push\((\{\"content_id\".*?\})\);", html)
    if not match:
        raise RuntimeError(f"Thyssen page lacks its dataLayer: {url}")
    data = json.loads(match[1])
    location = next(iter(data["content_taxonomy"].get("localizacion", [])), {}).get("name")
    if not location:
        return None
    page = BeautifulSoup(html, "html.parser")
    label = page.find(string=re.compile(r"Nº INV\."))
    # "Nº INV. 292 (1985.18)" splits the numbers into nested elements.
    inventory = (
        " ".join(label.parent.get_text(" ", strip=True).split()).removeprefix("Nº INV.").strip()
        if label
        else None
    )
    title = page.select_one("h1 .field--string")
    artist = page.select_one("a#rs_artwork_artist")
    return {
        "id": data["content_id"],
        "accession": re.sub(r"\(\s+|\s+\)", lambda m: m[0].strip(), inventory)
        if inventory
        else None,
        "title": title.get_text(" ", strip=True) if title else data.get("content_title"),
        "artist": artist.get_text(" ", strip=True) if artist else None,
        "url": url,
        "onView": location != NOT_ON_VIEW,
        "gallery": location,
    }

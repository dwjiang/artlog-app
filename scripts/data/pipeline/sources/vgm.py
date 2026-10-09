"""Van Gogh Museum, Amsterdam: the works its collection search lists as on view. It names no rooms."""

import re
from pathlib import Path
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

OWNER_KEY = "wikidata:Q224124"
ROBOTS = True
ORIGIN = "https://www.vangoghmuseum.nl"
PAGE_SIZE = 24


def fetch(client: PoliteClient, out: Path) -> dict:
    rows: list[FeedRow] = []
    while True:
        query = urlencode({"q": "", "OnView": "true", "from": len(rows)})
        response = client.get(
            f"{ORIGIN}/en/collection/search?{query}", headers={"Accept": "application/json"}
        )
        response.raise_for_status()
        body = response.json()
        page = parse_results(body["resultsHtml"])
        if not page:
            raise RuntimeError("Van Gogh Museum search page has no results")
        rows += page
        if not body["hasMoreResults"]:
            break
    if len(rows) != body["totalResults"]:
        raise RuntimeError("Van Gogh Museum search count changed during paging")
    return write_snapshot(out, rows, minimum_on_view=100)


def parse_results(html: str) -> list[FeedRow]:
    rows = []
    for item in BeautifulSoup(html, "html.parser").select(".collection-art-object-list-item"):
        link = item.select_one("a.collection-art-object-wrapper")
        # Japanese prints and letters live in their own sections: /en/letters/collection/b0652aV1962.
        number = re.fullmatch(r"/en/(?:[\w-]+/)?collection/([^/?#]+)", link["href"])[1]
        title = item.select_one(".collection-art-object-item-title")
        creator = item.select_one(".collection-art-object-item-creator")
        # The creator line reads "Vincent van Gogh, 1885".
        artist = (creator.get_text(" ", strip=True) if creator else "").rpartition(", ")[0]
        rows.append(
            {
                "id": number,
                "accession": number,
                "title": title.get_text(" ", strip=True) if title else None,
                "artist": artist or None,
                "url": ORIGIN + link["href"],
                "onView": True,
            }
        )
    return rows

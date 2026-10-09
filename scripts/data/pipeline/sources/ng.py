"""The National Gallery, London: each picture's current room from its CC0 collection API."""

import json
from pathlib import Path
from urllib.parse import urlencode

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

OWNER_KEY = "wikidata:Q180788"
ROBOTS = False
API = "https://data.ng.ac.uk/es/public/_search"
CUSTODIAN = "0P5X-0001-0000-0000"
NOT_ON_DISPLAY = "Not on display"
QUERY = {
    "size": 10_000,
    "track_total_hits": True,
    "_source": {
        "includes": [
            "@admin.uid",
            "identifier.type",
            "identifier.value",
            "summary.title",
            "creation.maker.summary.title",
            "location.current.summary.title",
            "location.current.@link.custodian.@admin.uid",
        ]
    },
    "query": {
        "bool": {
            "filter": [
                {"term": {"@datatype.base": "object"}},
                {"match": {"classification.value": "Picture"}},
            ]
        }
    },
}


def fetch(client: PoliteClient, out: Path) -> dict:
    # The API accepts its Elasticsearch body as a query parameter, so one GET returns every picture.
    url = f"{API}?{urlencode({'source': json.dumps(QUERY), 'source_content_type': 'application/json'})}"
    response = client.get(url)
    response.raise_for_status()
    hits = response.json()["hits"]
    if len(hits["hits"]) != hits["total"]["value"]:
        raise RuntimeError("National Gallery search returned a partial list")
    return write_snapshot(out, [row(hit["_source"]) for hit in hits["hits"]], minimum_on_view=500)


def row(source: dict) -> FeedRow:
    number = next(
        (
            item["value"]
            for item in source.get("identifier", [])
            if item.get("type") == "object number"
        ),
        None,
    )
    current = (source.get("location") or {}).get("current") or {}
    room = (current.get("summary") or {}).get("title")
    custodian = ((current.get("@link") or {}).get("custodian") or {}).get("@admin", {}).get("uid")
    makers = [
        maker for creation in source.get("creation", []) for maker in creation.get("maker", [])
    ]
    return {
        "id": source["@admin"]["uid"],
        "accession": number,
        "title": (source.get("summary") or {}).get("title"),
        "artist": next(iter(makers), {}).get("summary", {}).get("title"),
        "url": f"https://www.nationalgallery.org.uk/paintings/{number}",
        # A picture lent elsewhere names its borrower as custodian and reads "Not on display".
        "onView": custodian == CUSTODIAN and bool(room) and room != NOT_ON_DISPLAY,
        "gallery": room,
    }

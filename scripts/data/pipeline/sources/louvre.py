"""Louvre, Paris: the works its floor plan places in each room, tied to Wikidata items by Louvre ARK.

The plan names no inventory numbers, so rows name the Wikidata item whose Louvre ARK ID (P9394)
matches. Works with an ARK that no room lists are off view.
"""

import logging
from pathlib import Path

from ..owner_map import LOUVRE_KEY, MUSEUM_DEPARTMENTS
from ..polite_http import PoliteClient
from ..wikidata import _values, sparql
from .onview import FeedRow, write_snapshot

log = logging.getLogger(__name__)

OWNER_KEY = LOUVRE_KEY
ROBOTS = True
SITE = "https://collections.louvre.fr"
# The plan's four levels: -1 is the lower ground floor.
LEVELS = (-1, 0, 1, 2)
ARK_PREFIX = "/ark:/53355/"
COLLECTIONS = (
    LOUVRE_KEY.removeprefix("wikidata:"),
    *(qid for qid, museum in MUSEUM_DEPARTMENTS.items() if museum == LOUVRE_KEY),
)


def fetch(client: PoliteClient, out: Path) -> dict:
    rooms = {}
    for level in LEVELS:
        response = client.get(f"{SITE}/media/map/en/salles_{level}.json")
        response.raise_for_status()
        for room in response.json().values():
            for work in room.get("oeuvres", []):
                # "/en/ark:/53355/cl010095174"
                rooms[work["alias"].rsplit("/", 1)[1]] = (room, work)
    bindings = sparql(
        f"""SELECT DISTINCT ?item ?ark WHERE {{
          VALUES ?collection {{ {_values(COLLECTIONS)} }}
          ?item wdt:P195 ?collection; wdt:P9394 ?ark .
        }}""",
        user_agent=client.user_agent,
    )
    arks = {}
    for binding in bindings:
        ark = "cl" + binding["ark"]["value"]
        item = binding["item"]["value"].rsplit("/", 1)[1]
        arks.setdefault(ark, set()).add(item)
    log.info("Louvre: %d works in rooms, %d Wikidata items with an ARK", len(rooms), len(arks))
    return write_snapshot(
        out,
        [
            row(ark, next(iter(items)), rooms.get(ark))
            for ark, items in arks.items()
            if len(items) == 1
        ],
        minimum_on_view=1000,
    )


def row(ark: str, item: str, placed: tuple[dict, dict] | None) -> FeedRow:
    room, work = placed or ({}, {})
    return {
        "id": ark,
        "wikidataId": item,
        "title": work.get("titre"),
        "artist": work.get("auteur"),
        "url": f"{SITE}/en{ARK_PREFIX}{ark}",
        "onView": placed is not None,
        "gallery": f"{room['nom']} ({room['aile']}, {room['etage']})" if placed else None,
    }

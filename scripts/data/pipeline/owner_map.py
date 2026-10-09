import hashlib
import json
from collections import Counter
from pathlib import Path

from .convex_writer import ConvexWriter
from .normalize import qid
from .sources.fetch import write_json

MET_KEY = "wikidata:Q160236"
AIC_KEY = "wikidata:Q239303"
CMA_KEY = "wikidata:Q657415"
# The Finnish National Gallery owns the collection its three museums show.
FNG_KEY = "wikidata:Q2983474"
ATENEUM_KEY = "wikidata:Q754507"
SINEBRYCHOFF_KEY = "wikidata:Q1393952"
KIASMA_KEY = "wikidata:Q1633361"
LOUVRE_KEY = "wikidata:Q19675"
# Wikidata often names only the curatorial department that holds a work; it belongs to the museum.
MUSEUM_DEPARTMENTS = dict.fromkeys(
    (
        "Q3044747",  # Greek, Etruscan and Roman Antiquities
        "Q3044748",  # Islamic Arts
        "Q3044749",  # Egyptian Antiquities
        "Q3044751",  # Near Eastern Antiquities
        "Q3044753",  # Prints and Drawings
        "Q3044767",  # Decorative Arts
        "Q3044768",  # Paintings
        "Q3044772",  # Sculptures
        "Q121354106",  # Byzantine and Eastern Christian Art
    ),
    LOUVRE_KEY,
)


class OwnerMap:
    def __init__(self, keys: set[str]):
        self.keys = frozenset(keys)
        self.unmapped: Counter[str] = Counter()

    def venue(self, value: str | None, *, owner: bool = False) -> str | None:
        entity = qid(value)
        key = MUSEUM_DEPARTMENTS.get(entity) or (f"wikidata:{entity}" if entity else None)
        if key in self.keys:
            return key
        if owner and entity:
            self.unmapped[entity] += 1
        return None

    @classmethod
    def load(cls, writer: ConvexWriter, scratch: Path, *, deployment_url: str) -> "OwnerMap":
        scope = hashlib.sha256(deployment_url.encode()).hexdigest()[:16]
        path = scratch / "metadata-venues" / f"{scope}.json"
        if path.exists():
            return cls(set(json.loads(path.read_text())))
        keys, cursor = set(), None
        cursors = set()
        while True:
            result = writer.query("ingest:exportVenues", {"cursor": cursor} if cursor else {})
            keys.update(row["key"] for row in result["page"])
            if result["isDone"]:
                break
            cursor = result["continueCursor"]
            if not cursor or cursor in cursors:
                raise RuntimeError("Venue export pagination did not advance")
            cursors.add(cursor)
        if not {MET_KEY, AIC_KEY} <= keys:
            raise RuntimeError(
                "Met and AIC must exist in the seeded museums before metadata normalization"
            )
        write_json(path, sorted(keys))
        return cls(keys)

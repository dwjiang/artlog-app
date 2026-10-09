"""Museum feeds that say which works hang in the galleries now, and where.

A feed carries no images: each row names an imported object, by Wikidata item or by owner and
accession number, becomes its alias, joins its artwork, and attaches its placement to it.
"""

import json
from collections import defaultdict
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

from ..dedupe import accession
from ..normalize import ArtworkRecord, ObjectRecord, PlacementRecord, RecordTriple, clean
from .fetch import write_json


class FeedRow(TypedDict, total=False):
    """`title` and `artist` let a reviewer check a match; the imported artwork keeps its own."""

    id: str
    wikidataId: str
    accession: str
    title: str
    artist: str
    url: str
    onView: bool
    gallery: str


def write_snapshot(out: Path, rows: list[FeedRow], *, minimum_on_view: int) -> dict:
    """Refuses a snapshot whose on-view count suggests the source changed shape under us."""
    on_view = sum(row["onView"] for row in rows)
    if on_view < minimum_on_view:
        raise RuntimeError(f"{out.name}: only {on_view} works on view; expected {minimum_on_view}+")
    ids = [row["id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise RuntimeError(f"{out.name}: repeated source IDs")
    write_json(out / "rows.json", rows)
    stats = {
        "complete": True,
        "rows": len(rows),
        "onView": on_view,
        "files": ["rows.json"],
        "fetchedAt": datetime.now(UTC).isoformat(),
    }
    write_json(out / "stats.json", stats)
    return stats


def read_snapshot(directory: Path) -> tuple[dict, list[FeedRow]]:
    manifest = json.loads((directory / "stats.json").read_text())
    if not manifest.get("complete"):
        raise RuntimeError(f"{directory.name} snapshot is incomplete")
    rows = [row for name in manifest["files"] for row in json.loads((directory / name).read_text())]
    return manifest, rows


class Imported:
    """The surviving imported objects a feed row can name."""

    def __init__(self, objects: Iterable[dict]):
        by_key = {row["key"]: row for row in objects}
        self.survivors = {key: by_key[row.get("mergedIntoKey", key)] for key, row in by_key.items()}
        numbered = defaultdict(dict)
        for key, row in by_key.items():
            if row.get("ownerKey") and (number := accession(row.get("accession"))):
                survivor = self.survivors[key]
                numbered[row["ownerKey"], number][survivor["key"]] = survivor
        # A number shared by several imported objects names none of them.
        self.numbered = {
            owner_number: next(iter(survivors.values()))
            for owner_number, survivors in numbered.items()
            if len(survivors) == 1
        }

    def target(self, owner: str, row: FeedRow) -> dict | None:
        if wikidata_id := row.get("wikidataId"):
            survivor = self.survivors.get(f"wikidata:{wikidata_id}")
            return survivor if survivor and survivor.get("ownerKey") == owner else None
        return self.numbered.get((owner, accession(row.get("accession"))))


def iter_records(
    source: str, owner: str, rows: Iterable[FeedRow], imported: Imported
) -> Iterator[RecordTriple]:
    """Rows that name no imported object of `owner` are left out."""
    for row in rows:
        target = imported.target(owner, row)
        if target is None:
            continue
        key = f"{source}:{row['id']}"
        # Dedupe keeps the imported artwork's row, so this stand-in is never written.
        artwork = ArtworkRecord(
            key=target["artworkKey"],
            title=target["artworkKey"],
            artist="Unknown artist",
            rightsStatus="unknown",
        )
        obj = ObjectRecord(
            key=key,
            artworkKey=target["artworkKey"],
            ownerKey=owner,
            accession=clean(row.get("accession")),
            sourceId=row["id"],
            pageUrl=row["url"],
            aliasOf=target["key"],
        )
        placement = PlacementRecord(
            objectKey=key,
            venueKey=owner,
            gallery=clean(row.get("gallery")) if row["onView"] else None,
            onView=row["onView"],
            source="feed",
            confidence=0.9,
        )
        yield artwork, obj, placement

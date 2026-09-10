import re
from collections.abc import Iterable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .rights import RightsStatus, merge_rights


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    def row(self) -> dict:
        return self.model_dump(exclude_none=True)


class ArtworkRecord(Record):
    key: str = Field(min_length=1)
    wikidataId: str | None = None
    title: str = Field(min_length=1)
    artist: str = Field(min_length=1)
    artistId: str | None = None
    date: str | None = None
    yearStart: int | None = None
    yearEnd: int | None = None
    rightsStatus: RightsStatus
    multiplicity: Literal["unique", "multiple", "unknown"] = "unknown"
    seriesId: str | None = None


class ObjectRecord(Record):
    key: str = Field(min_length=1)
    artworkKey: str = Field(min_length=1)
    ownerKey: str | None = None
    accession: str | None = None
    medium: str | None = None
    dimensions: str | None = None
    source: Literal["corpus"] = "corpus"
    sourceId: str = Field(min_length=1)
    imageRef: str | None = None
    pageUrl: str
    thumbnailUrl: str | None = None


class PlacementRecord(Record):
    objectKey: str
    venueKey: str
    gallery: str | None = None
    onView: bool
    source: Literal["wikidata", "feed"]
    confidence: float = Field(ge=0, le=1)


type RecordTriple = tuple[ArtworkRecord, ObjectRecord, PlacementRecord | None]


def clean(value: str | None) -> str | None:
    return value.strip() or None if value is not None else None


def qid(value: str | None) -> str | None:
    if not value:
        return None
    match = re.fullmatch(
        r"(?:https?://(?:www\.)?wikidata.org/(?:entity|wiki)/)?(Q[1-9][0-9]*)/?", value.strip()
    )
    return match[1] if match else None


def year(value: str | int | None) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    match = re.fullmatch(r"([+-]?\d+)(?:-\d{2}-\d{2}T.*)?", str(value).strip())
    return int(match[1]) if match else None


def merge_records(
    records: Iterable[RecordTriple],
) -> tuple[list[ArtworkRecord], list[ObjectRecord], list[PlacementRecord]]:
    grouped: dict[str, list[ArtworkRecord]] = {}
    objects, placements = {}, {}
    for artwork, obj, placement in records:
        canonical = f"wikidata:{artwork.wikidataId}" if artwork.wikidataId else artwork.key
        if obj.artworkKey != artwork.key or (placement and placement.objectKey != obj.key):
            raise ValueError("Mismatched artwork/object/placement reference")
        candidates = grouped.setdefault(canonical, [])
        if any(row.key == artwork.key and row != artwork for row in candidates):
            raise ValueError(f"Conflicting artwork records for {artwork.key}")
        candidates.append(artwork)
        obj = obj.model_copy(update={"artworkKey": canonical})
        if obj.key in objects and objects[obj.key] != obj:
            raise ValueError(f"Conflicting object records for {obj.key}")
        objects[obj.key] = obj
        if placement is not None:
            key = (placement.objectKey, placement.venueKey, placement.source)
            if key in placements and placements[key] != placement:
                raise ValueError(f"Conflicting placement records for {key}")
            placements[key] = placement
    artworks = {}
    for key, candidates in sorted(grouped.items()):
        candidates.sort(key=lambda row: (not row.key.startswith("wikidata:"), row.key))
        fields = {}
        for candidate in reversed(candidates):
            incoming = candidate.row()
            if fields.get("title") and candidate.title == candidate.wikidataId:
                incoming.pop("title")
            if fields.get("artist") and candidate.artist == "Unknown artist":
                incoming.pop("artist")
            fields.update(incoming)
        fields["key"] = key
        fields["rightsStatus"] = merge_rights(row.rightsStatus for row in candidates)
        artworks[key] = ArtworkRecord(**fields)
    for key, obj in objects.items():
        if artworks[obj.artworkKey].rightsStatus != "public_domain":
            objects[key] = obj.model_copy(update={"thumbnailUrl": None})
    return (
        list(artworks.values()),
        [objects[key] for key in sorted(objects)],
        [placements[key] for key in sorted(placements)],
    )

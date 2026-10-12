from collections.abc import Iterable, Iterator
from typing import Literal

from ..normalize import (
    UNTITLED,
    ArtworkRecord,
    ObjectRecord,
    PlacementRecord,
    RecordTriple,
    clean,
    year,
)
from ..owner_map import AIC_KEY
from ..rights import from_copyright_notice, from_source_flag


def iiif_url(image_id: str, width: Literal[843, 1686]) -> str:
    return f"https://www.artic.edu/iiif/2/{image_id}/full/{width},/0/default.jpg"


def iter_records(
    rows: Iterable[dict], *, image_width: Literal[843, 1686] | None = None, current: bool = True
) -> Iterator[RecordTriple]:
    for row in rows:
        if "artwork_type_title" not in row:
            raise RuntimeError("STOP: AIC dump lacks artwork_type_title")
        if row["artwork_type_title"] != "Painting" or not row.get("image_id"):
            continue
        source_id = str(row["id"])
        key = f"aic:{source_id}"
        rights = from_source_flag(row.get("is_public_domain"))
        if rights != "public_domain":
            rights = from_copyright_notice(row.get("copyright_notice"))
        artwork = ArtworkRecord(
            key=key,
            title=clean(row.get("title")) or UNTITLED,
            artist=clean(row.get("artist_title")) or "Unknown artist",
            artistId=f"aic:{row['artist_id']}" if row.get("artist_id") is not None else None,
            date=clean(row.get("date_display")),
            yearStart=year(row.get("date_start")),
            yearEnd=year(row.get("date_end")),
            rightsStatus=rights,
        )
        # AIC image ingestion stays disabled while identified requests are blocked.
        image_ref = iiif_url(row["image_id"], image_width) if image_width else None
        thumbnail = (
            iiif_url(row["image_id"], 843) if image_width and rights == "public_domain" else None
        )
        obj = ObjectRecord(
            key=key,
            artworkKey=key,
            ownerKey=AIC_KEY,
            accession=clean(row.get("main_reference_number")),
            medium=clean(row.get("medium_display")),
            dimensions=clean(row.get("dimensions")),
            sourceId=source_id,
            pageUrl=f"https://www.artic.edu/artworks/{source_id}",
            imageRef=image_ref,
            thumbnailUrl=thumbnail,
        )
        placement = (
            PlacementRecord(
                objectKey=key,
                venueKey=AIC_KEY,
                gallery=clean(row.get("gallery_title")),
                onView=row.get("is_on_view") is True,
                source="feed",
                confidence=0.9,
            )
            if current
            else None
        )
        yield artwork, obj, placement

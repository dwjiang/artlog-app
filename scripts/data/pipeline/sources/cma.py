import json
import logging
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from ..normalize import (
    UNTITLED,
    ArtworkRecord,
    ObjectRecord,
    PlacementRecord,
    RecordTriple,
    clean,
    year,
)
from ..owner_map import CMA_KEY
from ..polite_http import PoliteClient
from .fetch import write_json

log = logging.getLogger(__name__)

API = "https://openaccess-api.clevelandart.org/api/artworks/"
FIELDS = (
    "id,accession_number,title,type,current_location,creators,creation_date,"
    "creation_date_earliest,creation_date_latest,department,collection,technique,measurements,"
    "url,images,share_license_status,culture"
)
PAGE_SIZE = 1000
# Flat works a phone can frame like a painting; textiles, lace and bound volumes stay out.
FLAT_TYPES = frozenset(
    {
        "Painting",
        "Portrait Miniature",
        "Print",
        "Drawing",
        "Photograph",
        "Manuscript",
        "Portfolio",
        "Tapestry",
        "Calligraphy",
    }
)
# Every impression of a print or photograph is the same artwork in another collection.
MULTIPLE_TYPES = frozenset({"Print", "Photograph"})
# Location codes outside the building: the Art Allée, East Terrace, South Entrance and West Lawn.
OUTDOOR_LOCATIONS = frozenset({"AAE", "AAW", "ET", "SE", "WL"})


def fetch_cma(client: PoliteClient, out: Path) -> dict:
    files: list[str] = []
    seen: set[int] = set()
    totals: dict[str, int] = {}
    manifest = out / "stats.json"
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    stats = {"complete": False, "rows": 0, "files": files}
    write_json(manifest, stats)
    # Deep offsets into the whole CC0 set reorder tied rows and repeat or skip artworks, so each
    # flat type is paged on its own.
    for artwork_type in sorted(FLAT_TYPES):
        skip = 0
        while artwork_type not in totals or skip < totals[artwork_type]:
            path = out / f"{artwork_type.lower().replace(' ', '-')}-skip-{skip}.json"
            try:
                if path.exists():
                    response = json.loads(path.read_text())
                else:
                    result = client.get(
                        f"{API}?cc0&has_image=1&type={quote(artwork_type)}"
                        f"&limit={PAGE_SIZE}&skip={skip}&fields={FIELDS}"
                    )
                    if result.is_error:
                        stats.update(httpStatus=result.status_code, error=result.text[:2000])
                    result.raise_for_status()
                    response = result.json()
                rows = response["data"]
                total = totals.setdefault(artwork_type, response["info"]["total"])
                if response["info"]["total"] != total:
                    raise RuntimeError(
                        "Cleveland census changed during pagination; refresh the snapshot"
                    )
                if not rows:
                    raise RuntimeError(f"Cleveland {artwork_type} pagination stalled")
                if skip + len(rows) > total:
                    raise RuntimeError("Cleveland page exceeds its reported total")
                ids = {row["id"] for row in rows}
                if len(ids) != len(rows) or ids & seen:
                    raise RuntimeError(
                        "Cleveland pagination repeated an artwork; refresh the snapshot"
                    )
                if not path.exists():
                    write_json(path, response)
            except Exception as error:
                stats.setdefault("error", str(error))
                write_json(manifest, stats)
                raise
            seen |= ids
            skip += len(rows)
            files.append(path.name)
            stats.update(rows=len(seen), total=sum(totals.values()))
            write_json(manifest, stats)
            log.info("Cleveland %s: %d/%d CC0 artworks with images", artwork_type, skip, total)
    stats.update(complete=True, fetchedAt=previous.get("fetchedAt", datetime.now(UTC).isoformat()))
    write_json(manifest, stats)
    return stats


def is_on_view(location: str | None) -> bool:
    return location is not None and location.split(" ", 1)[0] not in OUTDOOR_LOCATIONS


def iter_records(rows: Iterable[dict]) -> Iterator[RecordTriple]:
    for row in rows:
        image = clean(((row.get("images") or {}).get("web") or {}).get("url"))
        if (
            row.get("type") not in FLAT_TYPES
            or row.get("share_license_status") != "CC0"
            or not image
        ):
            continue
        source_id = str(row["id"])
        key = f"cma:{source_id}"
        creator = clean((row.get("creators") or [{}])[0].get("description"))
        accession = clean(row.get("accession_number"))
        artwork = ArtworkRecord(
            key=key,
            title=clean(row.get("title")) or UNTITLED,
            artist=clean(creator.split(" (", 1)[0]) if creator else "Unknown artist",
            date=clean(row.get("creation_date")),
            yearStart=year(row.get("creation_date_earliest")),
            yearEnd=year(row.get("creation_date_latest")),
            rightsStatus="public_domain",
            multiplicity="multiple" if row["type"] in MULTIPLE_TYPES else "unknown",
        )
        obj = ObjectRecord(
            key=key,
            artworkKey=key,
            ownerKey=CMA_KEY,
            accession=accession,
            medium=clean(row.get("technique")),
            dimensions=clean(row.get("measurements")),
            sourceId=source_id,
            imageRef=image,
            # The web rendition is the smallest the API publishes.
            thumbnailUrl=image,
            pageUrl=clean(row.get("url")) or f"https://www.clevelandart.org/art/{accession}",
        )
        location = clean(row.get("current_location"))
        on_view = is_on_view(location)
        placement = PlacementRecord(
            objectKey=key,
            venueKey=CMA_KEY,
            gallery=location if on_view else None,
            onView=on_view,
            source="feed",
            confidence=0.9,
        )
        yield artwork, obj, placement

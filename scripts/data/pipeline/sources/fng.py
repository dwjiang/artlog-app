import gzip
import json
import logging
from collections.abc import Iterable, Iterator
from datetime import UTC, date, datetime
from pathlib import Path

from ..normalize import (
    UNTITLED,
    ArtworkRecord,
    ObjectRecord,
    PlacementRecord,
    RecordTriple,
    clean,
    year,
)
from ..owner_map import ATENEUM_KEY, FNG_KEY, KIASMA_KEY, SINEBRYCHOFF_KEY
from ..polite_http import PoliteClient
from .fetch import write_json

log = logging.getLogger(__name__)

DUMP_URL = "https://www.kansallisgalleria.fi/api/v1/objects"
MEDIA_ORIGIN = "https://kokoelma.kansallisgalleria.fi"
MIN_ROWS = 50_000
# Organisation names double as exhibition locations. Works of the state art commission, which
# deposits art in public offices, and of the archive collections have no venue.
VENUES = {
    "Kansallisgalleria / Ateneumin taidemuseo": ATENEUM_KEY,
    "Kansallisgalleria / Sinebrychoffin taidemuseo": SINEBRYCHOFF_KEY,
    "Kansallisgalleria / Nykytaiteen museo Kiasma": KIASMA_KEY,
    "Kansallisgalleria / Nykytaiteen museo Kiasma, Helsinki": KIASMA_KEY,
}
FLAT_CLASSIFICATIONS = frozenset(
    {
        "graphic arts",
        "painting",
        "drawing",
        "fine-art photograph",
        "Japanese woodblock print",
        "sketch book",
        "miniature",
        "late impression",
        "black-and-white photo",
        "colour photograph",
        "watercolour",
        "pastel",
        "poster",
        "icon",
    }
)
NOT_FLAT_CLASSIFICATIONS = frozenset(
    {
        "sculpture",
        "media art",
        "Moving Image",
        "installation",
        "assemblage",
        "relief",
        "ceramics",
        "video art",
        "medal",
        "jewellery art",
        "textile work",
        "crafts and design",
        "Audio",
        "interview",
    }
)
# Every impression of a print or photograph is the same artwork in another collection.
MULTIPLE_CLASSIFICATIONS = frozenset(
    {
        "graphic arts",
        "Japanese woodblock print",
        "late impression",
        "poster",
        "fine-art photograph",
        "black-and-white photo",
        "colour photograph",
    }
)
UNKNOWN_ARTIST_NAMES = frozenset({"tekijä ei tiedossa", "tuntematon"})


def fetch_fng(client: PoliteClient, out: Path) -> dict:
    manifest = out / "stats.json"
    path = out / "objects.json"
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    if previous.get("complete") and path.exists():
        return previous
    stats = {"complete": False, "rows": 0, "files": []}
    write_json(manifest, stats)
    try:
        # One gzip dump of every object; the API ignores paging parameters.
        response = client.get(DUMP_URL)
        if response.is_error:
            stats.update(httpStatus=response.status_code)
        response.raise_for_status()
        body = response.content
        # httpx has already decoded a Content-Encoding: gzip response, but not a plain .gz body.
        if body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)
        rows = json.loads(body)
        if not isinstance(rows, list) or len(rows) <= MIN_ROWS:
            raise RuntimeError(f"FNG dump is not a list of more than {MIN_ROWS:,} objects")
    except Exception as error:
        stats.setdefault("error", str(error))
        write_json(manifest, stats)
        raise
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(body)
    temporary.replace(path)
    stats.update(
        complete=True,
        rows=len(rows),
        files=[path.name],
        lastModified=response.headers.get("Last-Modified"),
        fetchedAt=datetime.now(UTC).isoformat(),
    )
    write_json(manifest, stats)
    log.info("FNG: %d objects", len(rows))
    return stats


def cc0_image(multimedia: list[dict]) -> dict | None:
    images = [image for image in multimedia if image.get("license") == "CC0" and image.get("jpg")]
    return next(
        (image for image in images if image.get("isRiaDisplayImage")), images[0] if images else None
    )


def artist_name(people: list[dict]) -> str:
    person = next(
        (person for person in people if (person.get("role") or {}).get("en") == "Artist"),
        people[0] if people else {},
    )
    name = clean(" ".join(filter(None, (person.get("firstName"), person.get("familyName")))))
    return name if name and name.lower() not in UNKNOWN_ARTIST_NAMES else "Unknown artist"


def display_date(row: dict) -> tuple[str | None, int | None, int | None]:
    start = year(row.get("yearFrom"))
    if start is None:
        start = year(row.get("dateFrom"))
    end = year(row.get("yearTo"))
    span = "–".join(str(value) for value in dict.fromkeys((start, end)) if value is not None)
    prefix = clean((row.get("datePrefix") or {}).get("en"))
    return (" ".join(filter(None, (prefix, span))) if span else None), start, end


def current_exhibition(exhibitions: list[dict], today: date) -> dict | None:
    current = [
        exhibition
        for exhibition in exhibitions
        if exhibition.get("location") in VENUES
        and exhibition.get("startDate")
        and date.fromisoformat(exhibition["startDate"]) <= today
        # Ongoing collection displays have no end date.
        and (not exhibition.get("endDate") or today <= date.fromisoformat(exhibition["endDate"]))
    ]
    # A work in a newer exhibition has left the collection display that still lists it.
    return max(current, key=lambda exhibition: exhibition["startDate"], default=None)


def iter_records(rows: Iterable[dict], *, today: date) -> Iterator[RecordTriple]:
    for row in rows:
        home = VENUES.get(row.get("responsibleOrganisation"))
        classifications = {item.get("en") for item in row.get("classifications") or []}
        image = cc0_image(row.get("multimedia") or [])
        if (
            home is None
            or (row.get("category") or {}).get("en") != "artwork"
            or not classifications & FLAT_CLASSIFICATIONS
            or classifications & NOT_FLAT_CLASSIFICATIONS
            or image is None
        ):
            continue
        source_id = str(row["objectId"])
        key = f"fng:{source_id}"
        title = row.get("title") or {}
        display, start, end = display_date(row)
        artwork = ArtworkRecord(
            key=key,
            title=clean(title.get("en"))
            or clean(title.get("fi"))
            or clean(title.get("sv"))
            or UNTITLED,
            artist=artist_name(row.get("people") or []),
            date=display,
            yearStart=start,
            yearEnd=end,
            rightsStatus="public_domain",
            multiplicity="multiple" if classifications & MULTIPLE_CLASSIFICATIONS else "unknown",
        )
        materials = [
            clean(item.get("en")) or clean(item.get("fi")) for item in row.get("materials") or []
        ]
        obj = ObjectRecord(
            key=key,
            artworkKey=key,
            ownerKey=FNG_KEY,
            accession=clean(row.get("inventoryNumber")),
            medium=", ".join(filter(None, materials)) or None,
            sourceId=source_id,
            imageRef=MEDIA_ORIGIN + image["jpg"]["1000"],
            thumbnailUrl=MEDIA_ORIGIN + image["jpg"]["500"],
            pageUrl=f"https://www.kansallisgalleria.fi/en/object/{source_id}",
        )
        exhibition = current_exhibition(row.get("exhibitions") or [], today)
        placement = PlacementRecord(
            objectKey=key,
            venueKey=VENUES[exhibition["location"]] if exhibition else home,
            gallery=clean(exhibition["title"]) if exhibition else None,
            onView=exhibition is not None,
            source="feed",
            confidence=0.9,
        )
        yield artwork, obj, placement

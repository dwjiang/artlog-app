import csv
import json
import logging
import re
import time
from collections.abc import Callable, Iterator
from pathlib import Path

from ..normalize import ArtworkRecord, ObjectRecord, PlacementRecord, RecordTriple, clean, qid, year
from ..owner_map import MET_KEY
from ..polite_http import PoliteClient, parse_retry_after
from ..rights import from_source_flag
from .fetch import validate_met_header, write_json

log = logging.getLogger(__name__)

# Flat works a phone can frame like a painting. Classification is the Met's department taxonomy; the object name
# catches flat works filed elsewhere, such as a hanging scroll under Asian Art.
FLAT_CLASSIFICATION = re.compile(
    r"^(Drawings|Prints|Photographs|Codices|Manuscripts and Illuminations|Calligraphy|Miniatures|"
    r"Textiles-Tapestries|Ephemera|Albums|Books|Papyri|Ostraca)",
    re.IGNORECASE,
)
FLAT_NAME = re.compile(
    r"\b(painting|drawing|print|photograph|watercolou?r|hanging scroll|handscroll|album leaf|folding screen|"
    r"screen|fan|miniature|icon|tapestry|poster|woodblock|etching|engraving|lithograph|pastel|manuscript|"
    r"folio|leaf|page|fresco|mural|cartoon|sketch|study|scroll)\b",
    re.IGNORECASE,
)
NOT_FLAT_NAME = re.compile(
    r"\b(sculpture|statue|figure|vase|vessel|bowl|jar|cup|box|coin|medal|ring|armor|helmet|sword|chair|table|"
    r"cabinet|clock|ewer|plate|dish|tile|textile fragment|book binding|negative|stereograph|carte-de-visite|"
    r"cabinet card|baseball card|trade card|playing card)\b",
    re.IGNORECASE,
)
# Every impression of a print or photograph is the same artwork in another collection.
MULTIPLE_CLASSIFICATION = re.compile(r"^(Prints|Photographs)", re.IGNORECASE)


def is_painting(row: dict) -> bool:
    return "Paintings" in row["Classification"]


def is_flat(row: dict) -> bool:
    """A flat work other than a painting: a drawing, print, photograph, manuscript leaf, tapestry and the like."""
    if is_painting(row) or NOT_FLAT_NAME.search(row["Object Name"]):
        return False
    return bool(
        FLAT_CLASSIFICATION.match(row["Classification"]) or FLAT_NAME.search(row["Object Name"])
    )


class MetHydrator:
    def __init__(
        self,
        cache: Path,
        client: PoliteClient,
        *,
        retry_denied: bool = False,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cache = cache
        self.client = client
        self.retry_denied = retry_denied
        self.sleep = sleep
        self.marker = cache.parent / "image-access.json"
        stop = json.loads(self.marker.read_text()) if self.marker.exists() else None
        self.blocked = stop is not None and (
            not retry_denied or stop.get("retryAt", 0) > time.time()
        )
        self.stats = {
            "checked": 0,
            "forbidden": 0,
            "notFound": 0,
            "notRequested": 0,
            "requests": 0,
            "recovered": 0,
        }

    def __call__(self, object_id: str) -> dict:
        if not object_id.isdigit():
            raise ValueError("Met Object ID must be numeric")
        path = self.cache / f"{object_id}.json"
        data = json.loads(path.read_text()) if path.exists() else None
        was_denied = data is not None and data.get("httpStatus") == 403
        if not self.blocked and (data is None or (was_denied and self.retry_denied)):
            data = self._fetch(object_id)
            write_json(path, data)
            self.stats["recovered"] += was_denied and data.get("httpStatus") != 403
        if data is None:
            self.stats["notRequested"] += 1
            return {"unavailable": True, "notRequested": True}
        self.stats["checked"] += 1
        status = data.get("httpStatus")
        self.stats["forbidden"] += status == 403
        self.stats["notFound"] += status == 404
        if self.stats["checked"] % 50 == 0:
            log.info("Met image metadata: %s", self.stats)
        return data

    def _fetch(self, object_id: str) -> dict:
        for attempt in range(3):
            response = self.client.get(
                f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}"
            )
            self.stats["requests"] += 1
            if response.status_code != 403 or attempt == 2:
                break
            delay = max(
                15 * 2**attempt,
                parse_retry_after(response.headers.get("Retry-After"), time.time()) or 0,
            )
            if delay > 120:
                break
            log.warning("Met %s: HTTP 403; cooling down for %.0f seconds", object_id, delay)
            self.sleep(delay)
        if response.status_code == 403:
            self.blocked = True
            write_json(
                self.marker,
                {
                    "blocked": True,
                    "objectID": int(object_id),
                    "reason": "HTTP 403 after bounded retries or excessive Retry-After",
                    "recordedAt": time.time(),
                    "retryAt": time.time()
                    + (parse_retry_after(response.headers.get("Retry-After"), time.time()) or 0),
                },
            )
            log.warning("Met image metadata requests stopped; remaining availability is unknown")
        if response.status_code in (403, 404):
            return {
                "objectID": int(object_id),
                "unavailable": True,
                "httpStatus": response.status_code,
            }
        response.raise_for_status()
        data = response.json()
        if str(data["objectID"]) != object_id:
            raise ValueError("Met API returned a different Object ID")
        self.marker.unlink(missing_ok=True)
        return data


def iter_records(path: Path, *, get_object: Callable[[str], dict]) -> Iterator[RecordTriple]:
    with path.open(encoding="utf-8-sig", newline="") as body:
        reader = csv.DictReader(body)
        validate_met_header(reader.fieldnames or [])
        for row in reader:
            public = row["Is Public Domain"] == "True"
            # Other flat works without an image to recognize would only add rows.
            if not is_painting(row) and not (public and is_flat(row)):
                continue
            source_id = row["Object ID"]
            key = f"met:{source_id}"
            image = get_object(source_id) if public else {}
            # The live institutional flag can revoke the older CSV's affirmative flag.
            if image.get("isPublicDomain") is False:
                public = False
            artwork = ArtworkRecord(
                key=key,
                wikidataId=qid(row["Object Wikidata URL"]),
                title=clean(row["Title"]) or "Untitled",
                artist=clean(row["Artist Display Name"]) or "Unknown artist",
                artistId=qid(row["Artist Wikidata URL"]),
                date=clean(row["Object Date"]),
                yearStart=year(row["Object Begin Date"]),
                yearEnd=year(row["Object End Date"]),
                rightsStatus=from_source_flag(public),
                multiplicity="multiple"
                if MULTIPLE_CLASSIFICATION.match(row["Classification"])
                else "unknown",
            )
            obj = ObjectRecord(
                key=key,
                artworkKey=key,
                ownerKey=MET_KEY,
                accession=clean(row["Object Number"]),
                medium=clean(row["Medium"]),
                dimensions=clean(row["Dimensions"]),
                sourceId=source_id,
                imageRef=clean(image.get("primaryImage")) if public else None,
                thumbnailUrl=clean(image.get("primaryImageSmall")) if public else None,
                pageUrl=clean(row["Link Resource"])
                or f"https://www.metmuseum.org/art/collection/search/{source_id}",
            )
            gallery = clean(row["Gallery Number"])
            yield (
                artwork,
                obj,
                PlacementRecord(
                    objectKey=key,
                    venueKey=MET_KEY,
                    gallery=gallery,
                    onView=bool(gallery),
                    source="feed",
                    confidence=0.9,
                ),
            )

import argparse
import hashlib
import json
import logging
import os
import sqlite3
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .checkpoint import Checkpoint
from .config import JOBS_DIR, get_settings, setup_logging
from .convex_writer import ConvexWriter
from .regions import Region, load_regions, region_for
from .wikidata import MAX_VENUES, IncompleteCountry, VenueRow, iter_museums

log = logging.getLogger(__name__)
MAX_ASSET_BYTES = 10_000_000
BASELINE_VENUES = 42_444


@dataclass(frozen=True)
class VenueAsset:
    path: Path
    version: int
    row_count: int
    size_bytes: int
    websites_omitted: bool


def seed_countries(
    writer: ConvexWriter,
    countries: Mapping[str, Sequence[str]],
    regions: Mapping[str, Region],
    checkpoint: Checkpoint,
    *,
    user_agent: str,
    fetch_venues: Callable = iter_museums,
) -> int:
    # Shared Q-IDs use the first selected country, so another selection can overwrite them.
    selection = json.dumps(list(countries))
    if checkpoint.cursor("seed") != selection:
        checkpoint.clear("seed")
        checkpoint.set_cursor("seed", selection)
    cache_dir = checkpoint.path.parent / "countries"
    cache_dir.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    failed: list[str] = []
    for iso, qids in countries.items():
        cache = cache_dir / f"{iso}.json"
        if cache.exists():
            venues = [VenueRow(**row) for row in json.loads(cache.read_text())]
        else:
            metro_ids = sorted(
                {
                    qid
                    for region in regions.values()
                    if region.get("country") == iso
                    for qid in region.get("adminQids", [])
                }
            )
            try:
                venues = list(
                    fetch_venues(
                        {iso: qids},
                        user_agent=user_agent,
                        metro_admin_qids=metro_ids,
                        known_qids=seen,
                    )
                )
            except IncompleteCountry as error:
                log.error("%s; continuing with the remaining countries", error)
                failed.append(iso)
                continue
            temporary = cache.with_suffix(".tmp")
            temporary.write_text(json.dumps([asdict(row) for row in venues], ensure_ascii=False))
            temporary.replace(cache)
        rows = []
        for venue in venues:
            if venue.qid in seen:
                continue
            seen.add(venue.qid)
            rows.append(
                {
                    "key": f"wikidata:{venue.qid}",
                    "wikidataId": venue.qid,
                    "name": venue.name,
                    "lat": venue.lat,
                    "lng": venue.lng,
                    **({"website": venue.website} if venue.website is not None else {}),
                    "seedSource": "wikidata",
                    "region": region_for(venue, regions),
                }
            )
        if len(seen) > MAX_VENUES:
            raise RuntimeError(
                f"STOP: Wikidata exceeds {MAX_VENUES:,} venues; operator must decide on shards"
            )
        if not checkpoint.is_done("seed", iso):
            writer.upsert("ingest:upsertMuseums", rows, batch_size=500)
            checkpoint.mark_done("seed", [iso])
        log.info(
            "%s: %d venues; %d distinct across selected countries", iso, len(venues), len(seen)
        )
    if failed:
        raise IncompleteCountry(
            f"No export or publication: incomplete countries: {', '.join(failed)}"
        )
    return len(seen)


def export_asset(writer: ConvexWriter, out: Path, *, version: int) -> VenueAsset:
    out.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix="venues-", suffix=".db", dir=out)
    os.close(descriptor)
    temporary = Path(filename)
    omitted = False
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("""CREATE TABLE venues (
              id TEXT PRIMARY KEY, key TEXT, name TEXT NOT NULL,
              lat REAL NOT NULL, lng REAL NOT NULL, website TEXT, region TEXT NOT NULL
            )""")
            db.execute("CREATE TABLE meta (version INTEGER, generatedAt TEXT, rowCount INTEGER)")
            cursor = None
            row_count = 0
            while True:
                result = writer.query("ingest:exportVenues", {"cursor": cursor} if cursor else {})
                for row in result["page"]:
                    db.execute(
                        "INSERT INTO venues VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            row["_id"],
                            row["key"],
                            row["name"],
                            row["lat"],
                            row["lng"],
                            row.get("website"),
                            row["region"],
                        ),
                    )
                    row_count += 1
                if row_count > MAX_VENUES:
                    raise RuntimeError(f"STOP: export exceeds {MAX_VENUES:,} venues")
                if result["isDone"]:
                    break
                next_cursor = result["continueCursor"]
                if not next_cursor or next_cursor == cursor:
                    raise RuntimeError("Venue export pagination did not advance")
                cursor = next_cursor
            if not row_count:
                raise RuntimeError("Refusing to export an empty venue table")
            db.execute(
                "INSERT INTO meta VALUES (?, ?, ?)",
                (
                    version,
                    datetime.now(UTC).isoformat(),
                    row_count,
                ),
            )
            db.commit()
            db.execute("VACUUM")
            if temporary.stat().st_size > MAX_ASSET_BYTES:
                db.execute("UPDATE venues SET website = NULL")
                db.commit()
                db.execute("VACUUM")
                omitted = True
            if temporary.stat().st_size > MAX_ASSET_BYTES:
                raise RuntimeError(
                    "STOP: venue asset exceeds 10 MB without websites; operator must decide on shards"
                )
        destination = out / "venues.db"
        temporary.replace(destination)
        asset = VenueAsset(destination, version, row_count, destination.stat().st_size, omitted)
        log.info(
            "%s: %d rows, %d bytes, version %d, websites omitted: %s",
            asset.path,
            asset.row_count,
            asset.size_bytes,
            asset.version,
            asset.websites_omitted,
        )
        return asset
    finally:
        temporary.unlink(missing_ok=True)


def publish_asset(writer: ConvexWriter, asset: VenueAsset) -> str:
    upload_url = writer.mutation("venueTable:requestUpload")
    with asset.path.open("rb") as body:
        response = httpx.post(
            upload_url,
            content=body,
            headers={"Content-Type": "application/octet-stream"},
            timeout=120,
        )
    response.raise_for_status()
    storage_id = response.json()["storageId"]
    return writer.mutation(
        "venueTable:publish",
        {
            "storageId": storage_id,
            "rowCount": asset.row_count,
            "version": asset.version,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed Wikidata museums and galleries and export SQLite"
    )
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--countries", help="Comma-separated ISO codes, e.g. US,GB,FR")
    selection.add_argument(
        "--all", action="store_true", help="All country slices, including unknown country"
    )
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument(
        "--publish", action="store_true", help="Upload and publish the exported asset"
    )
    parser.add_argument(
        "--refresh", action="store_true", help="Start a fresh Wikidata census; omit when resuming"
    )
    args = parser.parse_args()
    settings = get_settings()
    setup_logging(settings)
    # Upload URLs grant write access; do not include them in HTTPX request logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    country_config = json.loads((JOBS_DIR / "config/countries.json").read_text())
    if args.all:
        countries = {**country_config, "unknown": []}
    else:
        selected = sorted({iso.strip().upper() for iso in args.countries.split(",") if iso.strip()})
        if not selected or any(iso not in country_config for iso in selected):
            parser.error("--countries must contain ISO codes from config/countries.json")
        countries = {iso: country_config[iso] for iso in selected}
    regions = load_regions()
    # Different deployments/configurations must never share completed-write checkpoints.
    scope = hashlib.sha256(
        json.dumps([settings.convex_url, country_config, regions], sort_keys=True).encode()
    ).hexdigest()[:16]
    checkpoint = Checkpoint(settings.scratch_dir / "venue-seed" / scope / "checkpoint.json")
    if args.refresh:
        checkpoint.clear("seed")
        for iso in countries:
            (checkpoint.path.parent / "countries" / f"{iso}.json").unlink(missing_ok=True)
    writer = ConvexWriter(settings)
    log.info("Seeding %s (%d country slices)", settings.convex_url, len(countries))
    total = seed_countries(writer, countries, regions, checkpoint, user_agent=settings.user_agent)
    if args.all and abs(total - BASELINE_VENUES) / BASELINE_VENUES > 0.05:
        raise RuntimeError(
            f"Full census {total:,} differs from spike baseline {BASELINE_VENUES:,} by >5%; investigate before publication"
        )
    asset = export_asset(writer, args.out, version=int(time.time()))
    print(json.dumps({**asdict(asset), "path": str(asset.path), "seeded_venues": total}))
    if args.publish:
        print(json.dumps({"published_id": publish_asset(writer, asset), "version": asset.version}))


if __name__ == "__main__":
    main()

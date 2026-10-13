import argparse
import hashlib
import json
import logging
import os
import sqlite3
import tempfile
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import closing
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .checkpoint import Checkpoint
from .config import DATA_DIR, Settings, get_settings, setup_logging
from .convex_writer import ConvexWriter
from .model_version import REPO_ROOT
from .regions import Region, load_regions, region_for
from .wikidata import MAX_VENUES, IncompleteCountry, VenueRow, iter_museums, resolve_cities

log = logging.getLogger(__name__)
MAX_ASSET_BYTES = 10_000_000
BASELINE_VENUES = 42_444
# The server validator reads the same file; config keys outside it (YU, DD, AC, ...) are seeded without a country.
COUNTRY_CODES = frozenset(json.loads((REPO_ROOT / "shared" / "journal" / "countries.json").read_text()))


@dataclass(frozen=True)
class VenueAsset:
    path: Path
    change_version: int
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
                cities = resolve_cities([venue.qid for venue in venues], user_agent=user_agent)
            except (IncompleteCountry, httpx.HTTPError) as error:
                log.error("%s: %s; continuing with the remaining countries", iso, error)
                failed.append(iso)
                continue
            venues = [
                replace(venue, city=city.name, city_key=f"wikidata:{city.qid}")
                if (city := cities.get(venue.qid))
                else venue
                for venue in venues
            ]
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
                    **({"city": venue.city} if venue.city else {}),
                    **({"cityKey": venue.city_key} if venue.city_key else {}),
                    **({"country": venue.country_iso} if venue.country_iso in COUNTRY_CODES else {}),
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


def _exported_venues(writer: ConvexWriter) -> Iterator[dict]:
    cursor = None
    count = 0
    while True:
        result = writer.query("ingest:exportVenues", {"cursor": cursor} if cursor else {})
        yield from result["page"]
        count += len(result["page"])
        if count > MAX_VENUES:
            raise RuntimeError(f"STOP: export exceeds {MAX_VENUES:,} venues")
        if result["isDone"]:
            return
        next_cursor = result["continueCursor"]
        if not next_cursor or next_cursor == cursor:
            raise RuntimeError("Venue export pagination did not advance")
        cursor = next_cursor


def fill_cities(writer: ConvexWriter, regions: Mapping[str, Region], *, user_agent: str) -> int:
    venues = [row for row in _exported_venues(writer) if row["key"].startswith("wikidata:")]
    cities = resolve_cities(
        [row["key"].removeprefix("wikidata:") for row in venues], user_agent=user_agent
    )
    rows = []
    for venue in venues:
        qid, region = venue["key"].removeprefix("wikidata:"), venue["region"]
        country = (
            region.removeprefix("country:")
            if region.startswith("country:")
            else regions.get(region, {}).get("country")
        )
        city = cities.get(qid)
        row = {
            "key": venue["key"],
            "wikidataId": qid,
            "name": venue["name"],
            "lat": venue["lat"],
            "lng": venue["lng"],
            **({"website": venue["website"]} if venue.get("website") is not None else {}),
            **({"city": city.name, "cityKey": f"wikidata:{city.qid}"} if city else {}),
            **({"country": country} if country in COUNTRY_CODES else {}),
            "seedSource": "wikidata",
            "region": region,
        }
        if any(row.get(field) != venue.get(field) for field in ("city", "cityKey", "country")):
            rows.append(row)
    writer.upsert("ingest:upsertMuseums", rows, batch_size=500)
    log.info("%d of %d venues have a city; %d rows changed", len(cities), len(venues), len(rows))
    return len(cities)


def export_asset(writer: ConvexWriter, out: Path, *, deployment_url: str) -> VenueAsset:
    # Read before paging: phones fetch every change after it, including any made during the export.
    change_version = writer.query("venueChanges:latestVersion")
    out.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix="venues-", suffix=".db", dir=out)
    os.close(descriptor)
    temporary = Path(filename)
    omitted = False
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("""CREATE TABLE venues (
              id TEXT PRIMARY KEY, key TEXT, name TEXT NOT NULL,
              lat REAL NOT NULL, lng REAL NOT NULL, website TEXT, region TEXT NOT NULL, city TEXT, country TEXT, cityKey TEXT,
              excludedFromDiscovery INTEGER NOT NULL DEFAULT 0
            )""")
            db.execute(
                "CREATE TABLE meta (changeVersion INTEGER NOT NULL, generatedAt TEXT NOT NULL, deployment TEXT NOT NULL)"
            )
            row_count = 0
            for row in _exported_venues(writer):
                db.execute(
                    "INSERT INTO venues VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        row["_id"],
                        row["key"],
                        row["name"],
                        row["lat"],
                        row["lng"],
                        row.get("website"),
                        row["region"],
                        row.get("city"),
                        row.get("country"),
                        row.get("cityKey"),
                        int(row.get("excludedFromDiscovery", False)),
                    ),
                )
                row_count += 1
            if not row_count:
                raise RuntimeError("Refusing to export an empty venue table")
            db.execute(
                "INSERT INTO meta VALUES (?, ?, ?)",
                (change_version, datetime.now(UTC).isoformat(), deployment_url),
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
        asset = VenueAsset(
            destination, change_version, row_count, destination.stat().st_size, omitted
        )
        log.info(
            "%s: %d rows, %d bytes, change version %d, websites omitted: %s",
            asset.path,
            asset.row_count,
            asset.size_bytes,
            asset.change_version,
            asset.websites_omitted,
        )
        return asset
    finally:
        temporary.unlink(missing_ok=True)


def _census(
    parser: argparse.ArgumentParser,
    args: argparse.Namespace,
    settings: Settings,
    regions: Mapping[str, Region],
    writer: ConvexWriter,
) -> int:
    country_config = json.loads((DATA_DIR / "config/countries.json").read_text())
    if args.all:
        countries = {**country_config, "unknown": []}
    else:
        selected = sorted({iso.strip().upper() for iso in args.countries.split(",") if iso.strip()})
        if not selected or any(iso not in country_config for iso in selected):
            parser.error("--countries must contain ISO codes from config/countries.json")
        countries = {iso: country_config[iso] for iso in selected}
    # Different deployments/configurations must never share completed-write checkpoints.
    scope = hashlib.sha256(
        json.dumps([settings.convex_url, country_config, regions], sort_keys=True).encode()
    ).hexdigest()[:16]
    checkpoint = Checkpoint(settings.scratch_dir / "venue-seed" / scope / "checkpoint.json")
    if args.refresh:
        checkpoint.clear("seed")
        for iso in countries:
            (checkpoint.path.parent / "countries" / f"{iso}.json").unlink(missing_ok=True)
    log.info("Seeding %s (%d country slices)", settings.convex_url, len(countries))
    total = seed_countries(writer, countries, regions, checkpoint, user_agent=settings.user_agent)
    if args.all and abs(total - BASELINE_VENUES) / BASELINE_VENUES > 0.05:
        raise RuntimeError(
            f"Full census {total:,} differs from baseline {BASELINE_VENUES:,} by >5%; investigate before publication"
        )
    return total


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed Wikidata museums and galleries and export SQLite"
    )
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--countries", help="Comma-separated ISO codes, e.g. US,GB,FR")
    selection.add_argument(
        "--all", action="store_true", help="All country slices, including unknown country"
    )
    selection.add_argument(
        "--cities-only",
        action="store_true",
        help="Resolve cities for venues already in Convex instead of running the census",
    )
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument(
        "--refresh", action="store_true", help="Start a fresh Wikidata census; omit when resuming"
    )
    args = parser.parse_args()
    if args.cities_only and args.refresh:
        parser.error("--refresh starts a fresh census; --cities-only runs none")
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    regions = load_regions()
    writer = ConvexWriter(settings)
    if args.cities_only:
        log.info("Resolving cities for venues in %s", settings.convex_url)
        summary = {"city_venues": fill_cities(writer, regions, user_agent=settings.user_agent)}
    else:
        summary = {"seeded_venues": _census(parser, args, settings, regions, writer)}
    asset = export_asset(writer, args.out, deployment_url=settings.convex_url)
    print(json.dumps({**asdict(asset), "path": str(asset.path), **summary}))


if __name__ == "__main__":
    main()

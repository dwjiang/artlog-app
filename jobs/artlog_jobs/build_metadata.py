import argparse
import hashlib
import json
import logging
from collections import Counter
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from .config import get_settings, setup_logging
from .convex_writer import ConvexWriter
from .multiplicity import apply_multiplicity
from .normalize import RecordTriple, merge_records, qid
from .owner_map import OwnerMap
from .polite_http import PoliteClient
from .sources import aic, met, wikidata_paintings
from .sources.fetch import write_json

log = logging.getLogger(__name__)


def build(
    sources: list[str],
    *,
    out: Path,
    dumps: Path,
    owners: OwnerMap,
    user_agent: str,
    fixtures: Path | None = None,
    aic_snapshot: str = "live",
    retry_met_denied: bool = False,
) -> dict:
    counts = {source: Counter() for source in sources}
    source_rights = {source: Counter() for source in sources}
    coverage = {}

    def measured(source: str, triples: Iterator[RecordTriple]) -> Iterator[RecordTriple]:
        for index, triple in enumerate(triples, 1):
            artwork, obj, placement = triple
            counts[source]["objects"] += 1
            counts[source]["imageRefs"] += obj.imageRef is not None
            counts[source]["thumbnails"] += obj.thumbnailUrl is not None
            counts[source]["placements"] += placement is not None
            counts[source]["onView"] += bool(placement and placement.onView)
            source_rights[source][artwork.rightsStatus] += 1
            if index % 500 == 0:
                log.info("%s: normalized %d objects", source, index)
            yield triple

    def inputs() -> Iterator[RecordTriple]:
        for source in sources:
            if source == "met":
                if fixtures:
                    images = json.loads((fixtures / "met-images-sample.json").read_text())
                    yield from measured(
                        source,
                        met.iter_records(
                            fixtures / "met-sample.csv", get_object=images.__getitem__
                        ),
                    )
                else:
                    cache = dumps / "met" / "objects"
                    with PoliteClient(
                        user_agent=user_agent, per_host_rps=1, robots=False, cache_max_bytes=0
                    ) as client:
                        hydrate = met.MetHydrator(cache, client, retry_denied=retry_met_denied)
                        yield from measured(
                            source,
                            met.iter_records(dumps / "met" / "MetObjects.csv", get_object=hydrate),
                        )
                        receipt = json.loads((dumps / "met" / "stats.json").read_text())
                        coverage["met"] = {
                            "csvRows": receipt["rows"],
                            "revision": receipt["revision"],
                            "imageMetadata": hydrate.stats,
                            "imageCensusComplete": hydrate.stats["notRequested"] == 0
                            and hydrate.stats["forbidden"] == 0,
                        }
            elif source == "aic":
                if fixtures:
                    rows = json.loads((fixtures / "aic-sample.json").read_text())["data"]
                    yield from measured(source, aic.iter_records(rows))
                elif aic_snapshot == "live":
                    path = dumps / "aic" / "live"
                    manifest = json.loads((path / "stats.json").read_text())
                    if not manifest.get("complete"):
                        raise RuntimeError(
                            "AIC live snapshot is incomplete; no current-placement export"
                        )
                    coverage["aic"] = {"snapshot": "live", **manifest}

                    def live_rows(directory=path, files=manifest["files"]):
                        for filename in files:
                            yield from json.loads((directory / filename).read_text())["data"]

                    yield from measured(source, aic.iter_records(live_rows()))
                else:
                    path = dumps / "aic"
                    receipt = json.loads(
                        (path / "artic-api-data.tar.bz2.download.json").read_text()
                    )
                    coverage["aic"] = {
                        "snapshot": "dump",
                        "lastModified": receipt["lastModified"],
                        "currentPlacements": False,
                    }
                    live_stats = path / "live" / "stats.json"
                    if live_stats.exists():
                        coverage["aic"]["liveRefresh"] = json.loads(live_stats.read_text())
                    with (path / "dump-paintings.jsonl").open() as body:
                        yield from measured(
                            source,
                            aic.iter_records((json.loads(line) for line in body), current=False),
                        )
            else:
                path = dumps / "wikidata"
                if fixtures:
                    files = [fixtures / "wikidata-paintings-sample.json"]
                    complete = True
                else:
                    manifest = json.loads((path / "stats.json").read_text())
                    files = [path / filename for filename in manifest["files"]]
                    complete = manifest["complete"]
                    coverage["wikidata"] = {
                        key: manifest[key] for key in ("censusItems", "items", "complete")
                    }
                    coverage["wikidata"]["failedSlices"] = len(manifest["failedSlices"])
                triples, versions, seen, raw_items = [], set(), set(), set()
                for file in files:
                    bindings = json.loads(file.read_text())["results"]["bindings"]
                    for row in bindings:
                        if raw_id := qid(row.get("item", {}).get("value")):
                            raw_items.add(raw_id)
                        if (row.get("versionOf") or row.get("series")) and (
                            entity := qid(row.get("item", {}).get("value"))
                        ):
                            versions.add(entity)
                    for triple in wikidata_paintings.iter_records(bindings, owners=owners):
                        if triple[0].key in seen:
                            raise ValueError(
                                f"Duplicate Wikidata item across slices: {triple[0].key}"
                            )
                        seen.add(triple[0].key)
                        triples.append(triple)
                if not fixtures:
                    coverage["wikidata"]["excludedUnknownImage"] = len(raw_items) - len(seen)
                artworks = apply_multiplicity(
                    (triple[0] for triple in triples), version_items=versions, complete=complete
                )
                yield from measured(
                    source,
                    (
                        (artwork, obj, placement)
                        for artwork, (_, obj, placement) in zip(artworks, triples, strict=True)
                    ),
                )

    artworks, objects, placements = merge_records(inputs())
    stats = {
        "artworks": len(artworks),
        "objects": len(objects),
        "placements": len(placements),
        "sources": {
            source: {**dict(counts[source]), "rights": dict(sorted(source_rights[source].items()))}
            for source in sources
        },
        "rightsDistribution": dict(sorted(Counter(row.rightsStatus for row in artworks).items())),
        "multiplicityDistribution": dict(
            sorted(Counter(row.multiplicity for row in artworks).items())
        ),
        "unmappedOwners": dict(sorted(owners.unmapped.items())),
        "coverage": coverage,
        "rightsPolicyYear": datetime.now(UTC).year,
        "aicImageAccess": "blocked",
        "venues": {
            "count": len(owners.keys),
            "keySetSha256": hashlib.sha256(json.dumps(sorted(owners.keys)).encode()).hexdigest(),
        },
    }
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, rows in [("artworks", artworks), ("objects", objects), ("placements", placements)]:
        path = out / f"{name}.jsonl"
        temporary = path.with_suffix(".jsonl.tmp")
        with temporary.open("w") as body:
            for row in rows:
                body.write(json.dumps(row.row(), ensure_ascii=False) + "\n")
        paths.append((temporary, path))
    # stats.json is the completion marker; readers must reject a directory without it.
    (out / "stats.json").unlink(missing_ok=True)
    for temporary, path in paths:
        temporary.replace(path)
    write_json(out / "stats.json", stats)
    log.info(
        "Wrote %d artworks, %d objects, %d placements to %s",
        len(artworks),
        len(objects),
        len(placements),
        out,
    )
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize corpus metadata without downloading images or writing to Convex"
    )
    parser.add_argument("--sources", default="met,aic,wikidata")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--dumps", type=Path)
    parser.add_argument(
        "--fixtures", type=Path, help="Use synthetic offline fixtures instead of downloaded sources"
    )
    parser.add_argument(
        "--venues", type=Path, help="Use a JSON array of previously exported museum keys"
    )
    parser.add_argument(
        "--retry-met-denied",
        action="store_true",
        help="Retry cached Met 403s and unchecked records at 1 request/sec with bounded cooldowns",
    )
    parser.add_argument(
        "--aic-snapshot",
        choices=["dump", "live"],
        default="live",
        help="Archive has no current placements; live requires a complete refresh",
    )
    args = parser.parse_args()
    sources = args.sources.split(",")
    if (
        not sources
        or len(set(sources)) != len(sources)
        or set(sources) - {"met", "aic", "wikidata"}
    ):
        parser.error("--sources must be a unique comma-separated selection of met,aic,wikidata")
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if args.venues:
        owners = OwnerMap(set(json.loads(args.venues.read_text())))
    elif args.fixtures:
        from .owner_map import AIC_KEY, MET_KEY

        owners = OwnerMap({MET_KEY, AIC_KEY})
    else:
        log.info("Reading seeded museum keys from %s; no Convex writes", settings.convex_url)
        owners = OwnerMap.load(
            ConvexWriter(settings), settings.scratch_dir, deployment_url=settings.convex_url
        )
    result = build(
        sources,
        out=args.out or settings.scratch_dir / "metadata",
        dumps=args.dumps or settings.scratch_dir / "dumps",
        owners=owners,
        user_agent=settings.user_agent,
        fixtures=args.fixtures,
        aic_snapshot=args.aic_snapshot,
        retry_met_denied=args.retry_met_denied,
    )
    print(
        json.dumps(
            {
                key: result[key]
                for key in ("artworks", "objects", "placements", "rightsDistribution", "coverage")
            }
        )
    )


if __name__ == "__main__":
    main()

import argparse
import hashlib
import json
import logging
import time
from collections import Counter, defaultdict
from itertools import zip_longest
from pathlib import Path

from .config import Settings, get_settings, setup_logging
from .convex_writer import ConvexWriter, is_size_rejection
from .features import Features, file_hash, read_jsonl
from .model_version import EMBEDDING_DIM, MODEL_VERSION
from .orb import DESCRIPTOR_BYTES, KEYPOINT_BYTES
from .sources.fetch import write_json

log = logging.getLogger(__name__)
STAGES = ("artworks", "objects", "placements", "vectors", "descriptors", "penalties")
FUNCTIONS = dict(
    zip(
        STAGES,
        (
            "upsertArtworks",
            "upsertObjects",
            "upsertPlacements",
            "upsertVectors",
            "upsertDescriptors",
            "setObjectPenalty",
        ),
        strict=True,
    )
)
BATCH_SIZES = dict.fromkeys(STAGES, 500) | {"vectors": 250, "descriptors": 200}
DEFAULT_CORPUS_LIMIT = 1000


class BatchSizeReduced(RuntimeError):
    pass


def select_objects(keys: list[str], limit: int) -> set[str]:
    if limit < 1:
        raise ValueError("--limit must be positive")
    sources = defaultdict(list)
    for key in sorted(set(keys), key=lambda key: (hashlib.sha256(key.encode()).digest(), key)):
        sources[key.split(":", 1)[0]].append(key)
    selected = set()
    for group in zip_longest(*(sources[source] for source in sorted(sources))):
        for key in group:
            if key is not None:
                selected.add(key)
                if len(selected) == limit:
                    return selected
    return selected


def checkpoint_name(limit: int | None) -> str:
    return f"push-small-{limit}.json" if limit is not None else "push.json"


class Corpus:
    def __init__(self, directory: Path, *, limit: int | None = None):
        if limit is not None and limit < 1:
            raise ValueError("--limit must be positive")
        self.directory = directory
        self.limit = limit
        self.stats = json.loads((directory / "stats.json").read_text())
        if limit is None and not self.stats["completeFeatures"]:
            raise ValueError(
                "Full push requires all feature shards from a full build; use a small corpus"
            )
        for name, digest in self.stats["files"].items():
            if file_hash(directory / name) != digest:
                raise ValueError(f"Merged input changed: {name}; rerun dedupe")
        self.features = Features(directory)
        self.rows = {
            name: read_jsonl(directory / f"{name}.jsonl")
            for name in ("artworks", "objects", "placements")
        }
        self.rows["vectors"] = read_jsonl(directory / "vector-index.jsonl")
        self.rows["descriptors"] = read_jsonl(directory / "descriptor-index.jsonl")
        self.objects = {row["key"]: row for row in self.rows["objects"]}
        works = {row["key"]: row for row in self.rows["artworks"]}
        for row in self.objects.values():
            if (
                "thumbnailUrl" in row
                and works[row["artworkKey"]]["rightsStatus"] != "public_domain"
            ):
                raise ValueError(f"Non-public-domain thumbnail on {row['key']}")
            target = row.get("mergedIntoKey")
            if target and (target not in self.objects or "mergedIntoKey" in self.objects[target]):
                raise ValueError("Merge targets must be surviving objects")
        self.rows["objects"].sort(key=lambda row: ("mergedIntoKey" in row, row["key"]))
        # Hub scoring is deferred; also clear prior corpus penalties when reimporting.
        self.rows["penalties"] = [
            {"objectKey": row["key"], "calibratorPenalty": 0} for row in self.rows["objects"]
        ]
        for stage in STAGES[:-1]:
            if len(self.rows[stage]) != self.stats[stage]:
                raise ValueError(f"Merged {stage} count disagrees with stats.json")
        if limit is not None:
            selected = select_objects([row["objectKey"] for row in self.rows["vectors"]], limit)
            # Keep all original records and views belonging to each selected survivor.
            selected |= {
                row["key"] for row in self.objects.values() if row.get("mergedIntoKey") in selected
            }
            self.rows["objects"] = [row for row in self.rows["objects"] if row["key"] in selected]
            work_keys = {row["artworkKey"] for row in self.rows["objects"]}
            self.rows["artworks"] = [
                row for row in self.rows["artworks"] if row["key"] in work_keys
            ]
            for stage in STAGES[2:]:
                self.rows[stage] = [row for row in self.rows[stage] if row["objectKey"] in selected]
        for stage, rows in self.rows.items():
            keys = [json.dumps(self.identity(stage, row), sort_keys=True) for row in rows]
            if len(keys) != len(set(keys)):
                raise ValueError(f"Duplicate {stage} identities")
        self.fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "files": self.stats["files"],
                    "hubPenalty": 0,
                    "limit": limit,
                    "selectedSurvivors": sorted({row["objectKey"] for row in self.rows["vectors"]}),
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()

    def plan(self) -> dict:
        survivors = sorted({row["objectKey"] for row in self.rows["vectors"]})
        venues = {row["ownerKey"] for row in self.rows["objects"] if row.get("ownerKey")}
        venues.update(row["venueKey"] for row in self.rows["placements"])
        return {
            "limit": self.limit,
            "hubPenalty": 0,
            "fingerprint": self.fingerprint,
            "inputCounts": {stage: len(self.rows[stage]) for stage in STAGES},
            "selectedSurvivors": survivors,
            "sources": dict(sorted(Counter(key.split(":", 1)[0] for key in survivors).items())),
            "requiredVenueKeys": sorted(venues),
            "featureBytes": {
                "embeddingsFloat32": len(self.rows["vectors"]) * EMBEDDING_DIM * 4,
                "embeddingsFloat64": len(self.rows["vectors"]) * EMBEDDING_DIM * 8,
                "orb": sum(
                    self.features.locations[row["viewKey"]]["keypointCount"]
                    * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)
                    for row in self.rows["descriptors"]
                ),
            },
        }

    @staticmethod
    def identity(stage: str, row: dict) -> dict:
        result = {"key": row.get("key", row.get("objectKey"))}
        if stage == "vectors":
            result["key"] = row["viewKey"]
            result.update(modelVersion=MODEL_VERSION, source=row["source"], viewKey=row["viewKey"])
        elif stage == "placements":
            result.update(venueKey=row["venueKey"], source=row["source"])
        return result

    def batch(self, stage: str, start: int, size: int) -> list[dict]:
        rows = self.rows[stage][start : start + size]
        if stage == "vectors":
            return [
                {
                    **row,
                    "modelVersion": MODEL_VERSION,
                    "vector": self.features.vectors[row["viewKey"]].tolist(),
                }
                for row in rows
            ]
        if stage == "descriptors":
            return [
                {
                    "objectKey": row["objectKey"],
                    "extractedFrom": self.objects[row["viewKey"]]["imageRef"],
                    **self.features.descriptors(row["viewKey"]),
                }
                for row in rows
            ]
        return rows


def run(corpus: Corpus, writer: ConvexWriter, *, checkpoint: Path, deployment_url: str) -> dict:
    checkpoint = Path(checkpoint)
    if checkpoint.exists():
        state = json.loads(checkpoint.read_text())
        if state["fingerprint"] != corpus.fingerprint or state["deployment"] != deployment_url:
            raise ValueError(
                "Push checkpoint belongs to different inputs or deployment; use a new checkpoint"
            )
    else:
        baseline = writer.query("ingest:counts")
        expected = dict(baseline)
        # Resolve overlaps before any write. Persist this target before the first mutation so
        # a lost response can be safely replayed without changing the expected final counts.
        for stage in STAGES[:-1]:
            rows = corpus.rows[stage]
            existing = 0
            for start in range(0, len(rows), 500):
                existing += writer.query(
                    "ingest:countExisting",
                    {
                        "table": stage,
                        "rows": [corpus.identity(stage, row) for row in rows[start : start + 500]],
                    },
                )
            expected[stage] = baseline[stage] + len(rows) - existing
            log.info("Preflight %s: %d input, %d existing", stage, len(rows), existing)
        state = {
            "fingerprint": corpus.fingerprint,
            "deployment": deployment_url,
            "baseline": baseline,
            "expected": expected,
            "stages": {},
            "batchSizes": dict(BATCH_SIZES),
        }
        write_json(checkpoint, state)
    for stage in STAGES:
        progress = state["stages"].setdefault(stage, {"offset": 0, "seconds": 0.0})
        total = len(corpus.rows[stage])
        while progress["offset"] < total:
            size = state["batchSizes"][stage]
            rows = corpus.batch(stage, progress["offset"], size)
            started = time.monotonic()
            try:
                call = writer.action if stage == "descriptors" else writer.mutation
                response = call(f"ingest:{FUNCTIONS[stage]}", {"rows": rows})
            except Exception as error:
                size_rejection = is_size_rejection(error)
                operation_limit = "timed out performing too many system operations" in str(error)
                if (not size_rejection and not operation_limit) or size == 1:
                    raise
                state["batchSizes"][stage] = max(1, size // 2)
                write_json(checkpoint, state)
                if operation_limit:
                    log.warning(
                        "%s system-operation timeout: reducing batch %d → %d and replaying",
                        stage,
                        size,
                        state["batchSizes"][stage],
                    )
                    continue
                raise BatchSizeReduced(
                    f"STOP: {stage} write-size rejection; batch reduced from {size} "
                    f"to {state['batchSizes'][stage]}. Resume after reviewing the error."
                ) from error
            if len(response["ids"]) != len(rows):
                raise RuntimeError(f"{stage} upsert did not acknowledge every unique row")
            progress["offset"] += len(rows)
            progress["seconds"] += time.monotonic() - started
            write_json(checkpoint, state)
            log.info("%s: %d/%d", stage, progress["offset"], total)
    actual = writer.query("ingest:counts")
    audit = {"checked": 0, "violations": 0}
    cursor = None
    while True:
        page = writer.query("ingest:auditThumbnails", {"cursor": cursor} if cursor else {})
        for key in audit:
            audit[key] += page[key]
        if page["isDone"]:
            break
        cursor = page["continueCursor"]
    report = {
        "deployment": deployment_url,
        "expected": state["expected"],
        "actual": actual,
        "countsMatch": actual == state["expected"],
        "thumbnailAudit": audit,
        "inputCounts": {s: len(corpus.rows[s]) for s in STAGES},
        "merges": corpus.stats["merges"],
        "stages": {},
    }
    for stage, progress in state["stages"].items():
        report["stages"][stage] = {
            **progress,
            "batchSize": state["batchSizes"][stage],
            "rowsPerSecond": progress["offset"] / progress["seconds"] if progress["seconds"] else 0,
        }
    write_json(checkpoint.with_suffix(".report.json"), report)
    if not report["countsMatch"] or audit["violations"]:
        raise RuntimeError(f"Import audit failed; see {checkpoint.with_suffix('.report.json')}")
    return report


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(
        description="Push a merged corpus to Convex, resuming each stage"
    )
    parser.add_argument("--in", dest="directory", type=Path, required=True)
    size = parser.add_mutually_exclusive_group()
    size.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_CORPUS_LIMIT,
        help="sample N surviving objects across sources (default: 1000)",
    )
    size.add_argument("--full", action="store_true", help="explicitly import the full corpus")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="print the local import plan only")
    mode.add_argument(
        "--export", type=Path, help="write a portable small corpus locally; no upload"
    )
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args(argv)
    limit = None if args.full else args.limit
    if limit is not None and limit < 1:
        parser.error("--limit must be positive")
    if args.export and args.full:
        parser.error("--export is for small corpora; omit --full")
    corpus = Corpus(args.directory, limit=limit)
    if args.dry_run:
        print(json.dumps(corpus.plan(), indent=2))
        return
    if args.export:
        from .subset import export

        print(json.dumps(export(corpus, args.export), indent=2))
        return
    settings: Settings = get_settings()
    setup_logging(settings)
    path = args.checkpoint or args.directory / checkpoint_name(limit)
    log.info("Import target: %s", settings.convex_url)
    print(
        json.dumps(
            run(
                corpus, ConvexWriter(settings), checkpoint=path, deployment_url=settings.convex_url
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

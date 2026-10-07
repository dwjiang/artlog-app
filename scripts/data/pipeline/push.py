import argparse
import hashlib
import json
import logging
import math
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from itertools import zip_longest
from pathlib import Path

from .config import Settings, get_settings, setup_logging
from .convex_writer import UPLOAD_BATCH_ROWS, ConvexWriter, is_size_rejection
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
BATCH_SIZES = dict.fromkeys(STAGES, 500) | dict.fromkeys(
    ("vectors", "descriptors"), UPLOAD_BATCH_ROWS
)
PREFLIGHT_WORKERS = 4
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
        # A package of additions points at already imported rows; it names them to check they exist first.
        self.external = (
            read_jsonl(directory / "external-references.jsonl") if "delta" in self.stats else []
        )
        imported_objects = {row["key"] for row in self.external if row["table"] == "objects"}
        works = {row["key"]: row for row in self.rows["artworks"]} | {
            row["key"]: row for row in self.external if row["table"] == "artworks"
        }
        for row in self.objects.values():
            if (
                "thumbnailUrl" in row
                and works[row["artworkKey"]]["rightsStatus"] != "public_domain"
            ):
                raise ValueError(f"Non-public-domain thumbnail on {row['key']}")
            target = row.get("mergedIntoKey")
            if (
                target
                and target not in imported_objects
                and (target not in self.objects or "mergedIntoKey" in self.objects[target])
            ):
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
            # Every alias travels with its survivor, including its artwork dependency.
            local_works = {row["key"] for row in self.rows["artworks"]}
            dependent_groups = {
                row.get("mergedIntoKey", row["key"])
                for row in self.objects.values()
                if row["artworkKey"] not in local_works
            }
            selected = select_objects(
                [
                    row["objectKey"]
                    for row in self.rows["vectors"]
                    if row["objectKey"] in self.objects and row["objectKey"] not in dependent_groups
                ],
                limit,
            )
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

    def referenced_rows(self) -> dict[str, list[str]]:
        """Imported rows the selected rows point at."""
        objects = {row["key"] for row in self.rows["objects"]}
        works = {row["key"] for row in self.rows["artworks"]}
        targets = {row.get("mergedIntoKey") for row in self.rows["objects"]}
        targets |= {row["objectKey"] for stage in STAGES[2:] for row in self.rows[stage]}
        external = {(row["table"], row["key"]) for row in self.external}
        return {
            "objects": sorted(
                key for key in targets if ("objects", key) in external and key not in objects
            ),
            "artworks": sorted(
                key
                for key in {row["artworkKey"] for row in self.rows["objects"]}
                if ("artworks", key) in external and key not in works
            ),
        }

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


def sample_indices(corpus: Corpus, stage: str, fraction: float) -> list[int]:
    if not 0 < fraction <= 1:
        raise ValueError("Verification fraction must be within (0, 1]")
    groups = defaultdict(list)
    for index, row in enumerate(corpus.rows[stage]):
        identity = corpus.identity(stage, row)
        groups[identity["key"].split(":", 1)[0]].append(
            (hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).digest(), index)
        )
    return sorted(
        index
        for group in groups.values()
        for _, index in sorted(group)[: math.ceil(len(group) * fraction)]
    )


def verify_sample(corpus: Corpus, writer: ConvexWriter, fraction: float) -> dict:
    report = {"fraction": fraction, "verifiedAt": time.time(), "stages": {}, "matches": True}
    for stage in STAGES:
        indices = sample_indices(corpus, stage, fraction)
        mismatches = []
        for start in range(0, len(indices), 32):
            batch = indices[start : start + 32]
            expected = [corpus.batch(stage, index, 1)[0] for index in batch]
            actual = writer.action(
                "ingest:readSample",
                {"table": stage, "rows": [corpus.identity(stage, row) for row in expected]},
            )
            if stage == "vectors":
                keys = [
                    {"modelVersion": row["modelVersion"], "viewKey": row["viewKey"]}
                    for row in expected
                ]
                for attempt in range(6):
                    if writer.action("vectorSync:verifyCorpus", {"keys": keys}):
                        break
                    if attempt == 5:
                        raise RuntimeError(
                            "Pinecone vector readback failed; resume after sync completes"
                        )
                    time.sleep(2)
            if len(actual) != len(expected):
                raise RuntimeError(f"{stage} readback did not return every sampled row")
            for wanted, stored in zip(expected, actual, strict=True):
                if wanted != stored:
                    mismatches.append(corpus.identity(stage, wanted))
            log.info(
                "Readback %s: %d/%d checked", stage, min(start + 32, len(indices)), len(indices)
            )
        report["stages"][stage] = {"checked": len(indices), "mismatches": mismatches}
        report["matches"] &= not mismatches
    audit = {"mode": "sample", "checked": 0, "violations": 0}
    keys = [
        corpus.rows["objects"][index]["key"]
        for index in sample_indices(corpus, "objects", fraction)
    ]
    for start in range(0, len(keys), 500):
        page = writer.query("ingest:auditThumbnails", {"objectKeys": keys[start : start + 500]})
        for key in ("checked", "violations"):
            audit[key] += page[key]
    report["thumbnailAudit"] = audit
    report["matches"] &= not audit["violations"]
    return report


def run(
    corpus: Corpus,
    writer: ConvexWriter,
    *,
    checkpoint: Path,
    deployment_url: str,
    verify_fraction: float = 0.02,
) -> dict:
    if not 0 < verify_fraction <= 1:
        raise ValueError("Verification fraction must be within (0, 1]")
    checkpoint = Path(checkpoint)
    search_index = writer.action("vectorSync:configuration", {})
    if checkpoint.exists():
        state = json.loads(checkpoint.read_text())
        if (
            state["fingerprint"] != corpus.fingerprint
            or state["deployment"] != deployment_url
            or state.get("searchIndex") != search_index
        ):
            raise ValueError(
                "Push checkpoint belongs to different inputs, deployment, or Pinecone index; use a new checkpoint"
            )
    else:
        baseline = writer.query("ingest:counts")
        state = {
            "fingerprint": corpus.fingerprint,
            "deployment": deployment_url,
            "searchIndex": search_index,
            "baseline": baseline,
            "expected": dict(baseline),
            "preflight": {},
            "stages": {},
            "batchSizes": dict(BATCH_SIZES),
        }
        write_json(checkpoint, state)
    if "preflight" in state:
        # No writes are allowed until every overlap is known. A resumed read phase must
        # still describe the same baseline, or its final-count calculation is invalid.
        if writer.query("ingest:counts") != state["baseline"]:
            raise ValueError(
                "Preflight baseline changed; review the deployment and use a new checkpoint"
            )
        referenced = corpus.referenced_rows()
        for table in ("artworks", "objects"):
            keys = referenced[table]
            for start in range(0, len(keys), 500):
                batch = [{"key": key} for key in keys[start : start + 500]]
                if writer.query("ingest:countExisting", {"table": table, "rows": batch}) != len(
                    batch
                ):
                    raise ValueError(f"Imported {table} these additions point at are missing")
        with ThreadPoolExecutor(max_workers=PREFLIGHT_WORKERS) as pool:
            for stage in STAGES[:-1]:
                rows = corpus.rows[stage]
                progress = state["preflight"].setdefault(stage, {"offset": 0, "existing": 0})
                while progress["offset"] < len(rows):
                    start = progress["offset"]
                    batches = [
                        rows[offset : offset + 500]
                        for offset in range(
                            start, min(start + 500 * PREFLIGHT_WORKERS, len(rows)), 500
                        )
                    ]
                    futures = [
                        pool.submit(
                            writer.query,
                            "ingest:countExisting",
                            {
                                "table": stage,
                                "rows": [corpus.identity(stage, row) for row in batch],
                            },
                        )
                        for batch in batches
                    ]
                    for batch, future in zip(batches, futures, strict=True):
                        existing = future.result()
                        if (
                            not isinstance(existing, (int, float))
                            or not math.isfinite(existing)
                            or existing != int(existing)
                            or not 0 <= existing <= len(batch)
                        ):
                            raise RuntimeError("Preflight returned an invalid overlap count")
                        progress["existing"] += int(existing)
                        progress["offset"] += len(batch)
                        write_json(checkpoint, state)
                    log.info(
                        "Preflight %s: %d/%d checked, %d existing",
                        stage,
                        progress["offset"],
                        len(rows),
                        progress["existing"],
                    )
                if progress["existing"] > state["baseline"][stage]:
                    raise RuntimeError("Preflight overlap exceeds baseline count")
                state["expected"][stage] = (
                    state["baseline"][stage] + len(rows) - progress["existing"]
                )
        if writer.query("ingest:counts") != state["baseline"]:
            raise ValueError(
                "Preflight baseline changed; review the deployment and use a new checkpoint"
            )
        del state["preflight"]
        write_json(checkpoint, state)
    for stage in STAGES:
        progress = state["stages"].setdefault(stage, {"offset": 0, "seconds": 0.0})
        total = len(corpus.rows[stage])
        features = stage in {"descriptors", "vectors"}
        if features:
            state["batchSizes"][stage] = min(state["batchSizes"][stage], UPLOAD_BATCH_ROWS)
        while progress["offset"] < total:
            size = state["batchSizes"][stage]
            batches = (
                corpus.batch(stage, offset, size)
                for offset in range(progress["offset"], total, size)
            )
            started = time.monotonic()
            try:
                responses = (
                    writer.ingest_feature_batches(f"ingest:{FUNCTIONS[stage]}", batches)
                    if features
                    else (
                        (len(batch), writer.mutation(f"ingest:{FUNCTIONS[stage]}", {"rows": batch}))
                        for batch in batches
                    )
                )
                with closing(responses):
                    for count, response in responses:
                        if (
                            count != min(size, total - progress["offset"])
                            or len(response["ids"]) != count
                        ):
                            raise RuntimeError(
                                f"{stage} upsert did not acknowledge every unique row"
                            )
                        progress["offset"] += count
                        progress["seconds"] += time.monotonic() - started
                        write_json(checkpoint, state)
                        log.info("%s: %d/%d", stage, progress["offset"], total)
                        started = time.monotonic()
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
    from .vector_sync import wait_for_sync

    wait_for_sync(writer)
    actual = writer.query("ingest:counts")
    verification = state.get("verification")
    if not verification or verification["fraction"] != verify_fraction:
        verification = verify_sample(corpus, writer, verify_fraction)
        if verification["matches"]:
            state["verification"] = verification
            write_json(checkpoint, state)
    report = {
        "deployment": deployment_url,
        "expected": state["expected"],
        "actual": actual,
        "countsMatch": actual == state["expected"],
        "thumbnailAudit": verification["thumbnailAudit"],
        "readback": verification,
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
    if not report["countsMatch"] or not verification["matches"]:
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
    parser.add_argument(
        "--verify-fraction",
        type=float,
        default=0.02,
        help="deterministic readback fraction per source and stage (default: 0.02; 1 checks all imported rows)",
    )
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args(argv)
    if not 0 < args.verify_fraction <= 1:
        parser.error("--verify-fraction must be within (0, 1]")
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
    with ConvexWriter(settings) as writer:
        report = run(
            corpus,
            writer,
            checkpoint=path,
            deployment_url=settings.convex_url,
            verify_fraction=args.verify_fraction,
        )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

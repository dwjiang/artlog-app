"""The local index build: drift gate, then per shard download → embed → delete the images,
so at most one shard of JPEGs exists at a time and none outlives the build (design §5.5)."""

import argparse
import json
import logging
import shutil
import sys
from collections import Counter
from collections.abc import Callable
from pathlib import Path

from .checkpoint import Checkpoint
from .config import Settings, get_settings, setup_logging
from .download import (
    SHARD_SIZE,
    SOURCE_RATES,
    ImageTask,
    default_client_factory,
    download_shard,
    iter_tasks,
    parse_rates,
    plan_shards,
)
from .drift_check import (
    DEFAULT_HASHES,
    DEFAULT_REFERENCE,
    DEFAULT_URLS,
    MIN_MEAN,
    MIN_MIN,
    check_with_fallback,
    fetch_calibration_images,
    format_report,
)
from .embed import BATCH_SIZE, WORKERS, embed_shard, update_manifest
from .model import DEFAULT_FAKEQUANT, load_embedder, sha256_of
from .polite_http import PoliteClient

log = logging.getLogger(__name__)

STAGES = ("download", "drift", "embed", "cleanup")


class DriftCheckFailed(RuntimeError):
    pass


def parse_stages(value: str) -> list[str]:
    stages = [stage for stage in value.split(",") if stage]
    unknown = set(stages) - set(STAGES)
    if not stages or unknown or len(set(stages)) != len(stages):
        raise argparse.ArgumentTypeError(f"--stage takes a unique subset of {','.join(STAGES)}")
    return stages


def projection(
    totals: Counter, download_reports: list[dict[str, object]], embed_reports: list[dict]
) -> dict:
    """Wall-clock for the full corpus from this run's achieved rates; sources download
    concurrently, so the download estimate is the slowest source, then the embed pass."""
    per_source = {}
    for source, total in sorted(totals.items()):
        processed = sum(r[source].done + r[source].failed for r in download_reports if source in r)
        seconds = sum(r[source].seconds for r in download_reports if source in r)
        rate = processed / seconds if seconds else 0.0
        per_source[source] = {
            "objects": total,
            "achievedReqPerSecond": round(rate, 3),
            "hours": round(total / rate / 3600, 1) if rate else None,
        }
    images = sum(r["images"] for r in embed_reports)
    embed_seconds = sum(r["seconds"] for r in embed_reports)
    embed_rate = images / embed_seconds if embed_seconds else 0.0
    download_hours = max((s["hours"] or 0) for s in per_source.values()) if per_source else 0
    embed_hours = sum(totals.values()) / embed_rate / 3600 if embed_rate else None
    return {
        "sources": per_source,
        "embedImagesPerSecond": round(embed_rate, 2),
        "embedHours": round(embed_hours, 1) if embed_hours else None,
        "wallClockDays": round((download_hours + (embed_hours or 0)) / 24, 2),
    }


def run(
    stages: list[str],
    *,
    settings: Settings,
    limit: int | None = None,
    keep_images: bool = False,
    shard_size: int = SHARD_SIZE,
    rates: dict[str, float] | None = None,
    fakequant: Path = DEFAULT_FAKEQUANT,
    dtype: str = "auto",
    batch_size: int = BATCH_SIZE,
    workers: int = WORKERS,
    load: Callable | None = None,
    download: Callable = download_shard,
    embed: Callable = embed_shard,
    drift: Callable | None = None,
) -> dict:
    if keep_images and limit is None:
        raise ValueError("--keep-images is only for debugging a --limit pilot")
    scratch = settings.scratch_dir
    images_dir, features_dir = scratch / "images", scratch / "features"
    checkpoint = Checkpoint.for_job(settings, "build_index")
    manifest_path = features_dir / "manifest.json"
    sharded = "download" in stages or "embed" in stages
    recorded = (
        json.loads(manifest_path.read_text()).get("limit") if manifest_path.exists() else limit
    )
    if sharded and recorded != limit:
        # Shard membership depends on the limit, so a pilot's checkpoint would hide objects.
        raise RuntimeError(
            f"{features_dir} holds a run with a different --limit; move it and "
            f"{checkpoint.path} aside before starting this run"
        )
    if sharded:
        update_manifest(features_dir, run={"limit": limit})
    rates = rates or dict(SOURCE_RATES)
    load = load or (lambda dt: load_embedder(fakequant, device=settings.device, dtype=dt))
    embedder = None
    drift_result = None
    if "drift" in stages:
        drift_result = (drift or default_drift)(load, settings, dtype=dtype)
        print(format_report(drift_result) if "mean" in drift_result else drift_result)
        if not drift_result["passed"]:
            raise DriftCheckFailed("drift check failed; the build must not embed")
        update_manifest(features_dir, run={"driftCheck": drift_result})
        dtype = drift_result["dtype"]
    tasks: list[ImageTask] = []
    if "download" in stages or "embed" in stages:
        tasks = list(iter_tasks(scratch / "metadata" / "objects.jsonl"))
    totals = Counter(task.source for task in tasks)
    shards = plan_shards(tasks, shard_size=shard_size, limit=limit)
    download_reports, embed_reports = [], []
    for number, shard_tasks in enumerate(shards):
        key = f"shard-{number}"
        shard_dir = images_dir / key
        if "embed" in stages and checkpoint.is_done("embed", key):
            continue
        if "download" in stages:
            if checkpoint.is_done("download", key) and not shard_dir.exists():
                # Images vanished before their embed; the shard must be fetched again.
                checkpoint.unmark("download", [key])
            if not checkpoint.is_done("download", key):
                reports = download(
                    number,
                    shard_tasks,
                    images_dir=images_dir,
                    state_dir=scratch / "downloads",
                    client_factory=default_client_factory(settings, rates),
                )
                download_reports.append(reports)
                checkpoint.mark_done("download", [key])
        if "embed" in stages:
            if not shard_dir.exists():
                raise FileNotFoundError(f"{shard_dir} is missing; run the download stage first")
            if embedder is None:
                embedder = load("float16" if dtype == "auto" else dtype)
                update_manifest(features_dir, run={"fakequantSha256": sha256_of(fakequant)})
            report = embed(
                shard_dir, features_dir, number, embedder, batch_size=batch_size, workers=workers
            )
            embed_reports.append(report)
            update_manifest(features_dir, shard_report=report)
            checkpoint.mark_done("embed", [key])
            if not keep_images:
                shutil.rmtree(shard_dir)
    if "cleanup" in stages and images_dir.exists():
        shutil.rmtree(images_dir)
    if images_dir.exists() and not any(images_dir.iterdir()):
        images_dir.rmdir()
    summary = {
        "shards": len(shards),
        "downloaded": [{s: r.as_dict() for s, r in report.items()} for report in download_reports],
        "embedded": embed_reports,
    }
    if download_reports or embed_reports:
        summary["projection"] = projection(totals, download_reports, embed_reports)
    return summary


def default_drift(load: Callable, settings: Settings, *, dtype: str) -> dict:
    urls = DEFAULT_URLS.read_text().splitlines()
    with PoliteClient(
        user_agent=settings.user_agent, per_host_rps=8.0, robots=False, cache_max_bytes=0
    ) as client:
        paths = fetch_calibration_images(
            urls,
            settings.scratch_dir / "calibration",
            json.loads(DEFAULT_HASHES.read_text()),
            client,
        )
    result = check_with_fallback(
        load,
        dtypes=("float16", "float32") if dtype == "auto" else (dtype,),
        urls=urls,
        reference=json.loads(DEFAULT_REFERENCE.read_text()),
        paths=paths,
        min_mean=MIN_MEAN,
        min_min=MIN_MIN,
    )
    out = settings.scratch_dir / "features" / "drift-check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the index features in SCRATCH_DIR")
    parser.add_argument("--stage", type=parse_stages, default=list(STAGES[:3]))
    parser.add_argument("--limit", type=int, help="pilot: only the first N downloadable objects")
    parser.add_argument("--keep-images", action="store_true", help="debugging a --limit pilot only")
    parser.add_argument("--shard-size", type=int, default=SHARD_SIZE)
    parser.add_argument(
        "--rate", type=parse_rates, default=dict(SOURCE_RATES), help="met=8,wikidata=1"
    )
    parser.add_argument("--fakequant", type=Path, default=DEFAULT_FAKEQUANT)
    parser.add_argument("--dtype", choices=("auto", "float16", "float32"), default="auto")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args(argv)
    if args.keep_images and args.limit is None:
        parser.error("--keep-images is refused without --limit")
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        summary = run(
            args.stage,
            settings=settings,
            limit=args.limit,
            keep_images=args.keep_images,
            shard_size=args.shard_size,
            rates=args.rate,
            fakequant=args.fakequant,
            dtype=args.dtype,
            batch_size=args.batch_size,
            workers=args.workers,
        )
    except DriftCheckFailed as error:
        print(error, file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

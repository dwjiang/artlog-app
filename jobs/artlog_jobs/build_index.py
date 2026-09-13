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
    SOURCE_STREAMS,
    WIKIMEDIA_MBPS,
    DownloadIncomplete,
    ShardState,
    default_client_factory,
    download_shard,
    iter_tasks,
    parse_rates,
    parse_streams,
    plan_shards,
    task_fingerprint,
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
from .push import DEFAULT_CORPUS_LIMIT, checkpoint_name

log = logging.getLogger(__name__)

STAGES = ("download", "drift", "embed", "dedupe", "hubs", "push", "cleanup")


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
    push_limit: int | None = DEFAULT_CORPUS_LIMIT,
    keep_images: bool = False,
    shard_size: int = SHARD_SIZE,
    rates: dict[str, float] | None = None,
    streams: dict[str, int] | None = None,
    mbps: float = WIKIMEDIA_MBPS,
    fakequant: Path = DEFAULT_FAKEQUANT,
    dtype: str = "auto",
    batch_size: int = BATCH_SIZE,
    workers: int = WORKERS,
    load: Callable | None = None,
    download: Callable = download_shard,
    embed: Callable = embed_shard,
    drift: Callable | None = None,
) -> dict:
    if push_limit is not None and push_limit < 1:
        raise ValueError("--push-limit must be positive")
    if keep_images and limit is None:
        raise ValueError("--keep-images is only for debugging a --limit pilot")
    scratch = settings.scratch_dir
    images_dir, features_dir = scratch / "images", scratch / "features"
    checkpoint = Checkpoint.for_job(settings, "build_index")
    manifest_path = features_dir / "manifest.json"
    sharded = "download" in stages or "embed" in stages
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    tasks = list(iter_tasks(scratch / "metadata" / "objects.jsonl")) if sharded else []
    shard_plan = {
        "limit": limit,
        "shardSize": shard_size,
        "downloadInputsSha256": task_fingerprint(tasks),
    }
    if (
        sharded
        and ("limit" in manifest or manifest.get("shards") or checkpoint.path.exists())
        and any(manifest.get(name) != value for name, value in shard_plan.items())
    ):
        raise RuntimeError(
            f"{features_dir} holds a run with a different --limit, --shard-size or "
            "missing/mismatched download inputs fingerprint; move it, "
            f"{images_dir}, {scratch / 'downloads'} and {checkpoint.path} aside "
            "before starting this run"
        )
    if "drift" in stages or "embed" in stages:
        weights_sha256 = sha256_of(fakequant)
        has_features = bool(manifest.get("shards") or checkpoint.done_keys("embed"))
        if has_features and manifest.get("fakequantSha256") != weights_sha256:
            raise RuntimeError(
                f"{features_dir}: completed features have different or unverified weights; "
                "use the original --fakequant file or start a fresh build in a new SCRATCH_DIR"
            )
    if sharded:
        update_manifest(features_dir, run=shard_plan)
    rates = rates or dict(SOURCE_RATES)
    load = load or (lambda dt: load_embedder(fakequant, device=settings.device, dtype=dt))
    embedder = None
    drift_result = None
    if "drift" in stages or "embed" in stages:
        drift_result = (drift or default_drift)(load, settings, dtype=dtype)
        print(format_report(drift_result) if "mean" in drift_result else drift_result)
        update_manifest(
            features_dir,
            run={"driftCheck": drift_result, "fakequantSha256": weights_sha256},
        )
        if not drift_result["passed"]:
            raise DriftCheckFailed("drift check failed; the build must not embed")
        dtype = drift_result["dtype"]
    totals = Counter(task.source for task in tasks)
    shards = plan_shards(tasks, shard_size=shard_size, limit=limit)
    download_reports, embed_reports = [], []
    for number, shard_tasks in enumerate(shards):
        key = f"shard-{number}"
        shard_dir = images_dir / key
        if "embed" in stages and checkpoint.is_done("embed", key):
            if not keep_images and shard_dir.exists():
                shutil.rmtree(shard_dir)
            continue
        if "download" in stages:
            if checkpoint.is_done("download", key):
                try:
                    ShardState(scratch / "downloads", number).require_complete(
                        shard_tasks, shard_dir
                    )
                except DownloadIncomplete:
                    checkpoint.unmark("download", [key])
            if not checkpoint.is_done("download", key):
                reports = download(
                    number,
                    shard_tasks,
                    images_dir=images_dir,
                    state_dir=scratch / "downloads",
                    client_factory=default_client_factory(settings, rates),
                    streams=streams or dict(SOURCE_STREAMS),
                    mbps=mbps,
                )
                download_reports.append(reports)
                checkpoint.mark_done("download", [key])
        if "embed" in stages:
            if not shard_dir.exists():
                raise FileNotFoundError(f"{shard_dir} is missing; run the download stage first")
            ShardState(scratch / "downloads", number).require_complete(shard_tasks, shard_dir)
            if embedder is None:
                embedder = load(dtype)
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
    merged = scratch / "merged"
    if "dedupe" in stages:
        from .dedupe import run as dedupe

        summary["dedupe"] = dedupe(features_dir, scratch / "metadata", merged)
    if "hubs" in stages:
        from .hubs import run as hubs

        summary["hubs"] = hubs(merged, merged / "penalties.jsonl")
    if "push" in stages:
        from .convex_writer import ConvexWriter
        from .push import Corpus
        from .push import run as push

        summary["push"] = push(
            Corpus(merged, limit=push_limit),
            ConvexWriter(settings),
            checkpoint=merged / checkpoint_name(push_limit),
            deployment_url=settings.convex_url,
        )
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
    push_size = parser.add_mutually_exclusive_group()
    push_size.add_argument(
        "--push-limit",
        type=int,
        default=DEFAULT_CORPUS_LIMIT,
        help="push only N surviving objects (default: 1000)",
    )
    push_size.add_argument(
        "--full-corpus",
        dest="push_limit",
        action="store_const",
        const=None,
        help="explicitly push the full corpus",
    )
    parser.add_argument("--keep-images", action="store_true", help="debugging a --limit pilot only")
    parser.add_argument("--shard-size", type=int, default=SHARD_SIZE)
    parser.add_argument(
        "--rate", type=parse_rates, default=dict(SOURCE_RATES), help="met=8,wikidata=10"
    )
    parser.add_argument(
        "--streams", type=parse_streams, default=dict(SOURCE_STREAMS), help="wikidata=2"
    )
    parser.add_argument(
        "--mbps", type=float, default=WIKIMEDIA_MBPS, help="Wikimedia media bandwidth cap"
    )
    parser.add_argument("--fakequant", type=Path, default=DEFAULT_FAKEQUANT)
    parser.add_argument("--dtype", choices=("auto", "float16", "float32"), default="auto")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args(argv)
    if args.keep_images and args.limit is None:
        parser.error("--keep-images is refused without --limit")
    if args.push_limit is not None and args.push_limit < 1:
        parser.error("--push-limit must be positive")
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        summary = run(
            args.stage,
            settings=settings,
            limit=args.limit,
            push_limit=args.push_limit,
            keep_images=args.keep_images,
            shard_size=args.shard_size,
            rates=args.rate,
            streams=args.streams,
            mbps=args.mbps,
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

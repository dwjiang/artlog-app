"""Embed a downloaded image shard with the phone's numerics and extract ORB features from the
same letterboxed input, writing one feature shard per image shard."""

import argparse
import json
import logging
import statistics
import sys
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset

from .config import get_settings, setup_logging
from .download import key_from_filename
from .letterbox import letterbox
from .model import DEFAULT_FAKEQUANT, Embedder, load_embedder, sha256_of
from .model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION, ORB_MAX_KEYPOINTS
from .orb import DESCRIPTOR_BYTES, KEYPOINT_BYTES, OrbFeatures, extract_orb, to_gray

log = logging.getLogger(__name__)

BATCH_SIZE = 128
WORKERS = 6


class ShardImages(Dataset):
    """Decoding, letterboxing and ORB run in DataLoader workers; the main process only
    batches the GPU forward. Module-level so macOS's `spawn` workers can import it. Pixels
    cross the process boundary as numpy, not tensors: torch's shared-memory tensor transport
    can delay spawned macOS workers during shutdown."""

    def __init__(self, files: list[Path], size: int = INPUT_SIZE):
        self.files = list(files)
        self.size = size

    def __len__(self) -> int:
        return len(self.files)

    def __getitem__(self, index: int) -> tuple[str, np.ndarray, OrbFeatures]:
        path = self.files[index]
        with Image.open(path) as image:
            boxed = letterbox(image, self.size)
        pixels = np.ascontiguousarray(np.array(boxed, dtype=np.uint8).transpose(2, 0, 1))
        return key_from_filename(path.name), pixels, extract_orb(to_gray(boxed), ORB_MAX_KEYPOINTS)


def collate(items: list[tuple[str, np.ndarray, OrbFeatures]]):
    keys, pixels, features = zip(*items, strict=True)
    return list(keys), np.stack(pixels), list(features)


def shard_files(images_dir: Path) -> list[Path]:
    return sorted(path for path in Path(images_dir).glob("*.jpg"))


def keypoint_summary(counts: list[int]) -> dict:
    if not counts:
        return {"median": 0, "min": 0, "max": 0, "zero": 0}
    return {
        "median": int(statistics.median(counts)),
        "min": min(counts),
        "max": max(counts),
        "zero": sum(count == 0 for count in counts),
    }


def embed_shard(
    images_dir: Path,
    out_dir: Path,
    shard: int,
    embedder: Embedder,
    *,
    batch_size: int = BATCH_SIZE,
    workers: int = WORKERS,
) -> dict:
    """Writes `vectors-<n>.npy` (float32 [N, dim], L2-normalized), `keys-<n>.json` (row order),
    `descriptors-<n>.bin` (per image: descriptors then keypoints in the shared ORB wire format)
    and `descriptors-<n>.json` (`[{key, offset, keypointCount}]`)."""
    files = shard_files(images_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    loader = DataLoader(
        ShardImages(files), batch_size=batch_size, num_workers=workers, collate_fn=collate
    )
    keys: list[str] = []
    vectors: list[np.ndarray] = []
    index: list[dict] = []
    counts: list[int] = []
    offset = 0
    blob_path = out_dir / f"descriptors-{shard}.bin.tmp"
    with blob_path.open("wb") as blob:
        for batch_keys, pixels, features in loader:
            vectors.append(embedder.embed(torch.from_numpy(pixels)))
            for key, feature in zip(batch_keys, features, strict=True):
                blob.write(feature.descriptors)
                blob.write(feature.keypoints)
                index.append({"key": key, "offset": offset, "keypointCount": feature.count})
                offset += len(feature.descriptors) + len(feature.keypoints)
                counts.append(feature.count)
            keys.extend(batch_keys)
            log.info("shard %d embedded %d/%d", shard, len(keys), len(files))
    matrix = (
        np.concatenate(vectors).astype(np.float32)
        if vectors
        else np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
    )
    with (out_dir / f"vectors-{shard}.npy.tmp").open("wb") as body:
        np.save(body, matrix)
    (out_dir / f"keys-{shard}.json.tmp").write_text(json.dumps(keys) + "\n")
    (out_dir / f"descriptors-{shard}.json.tmp").write_text(json.dumps(index) + "\n")
    for name in (f"vectors-{shard}.npy", f"keys-{shard}.json", f"descriptors-{shard}.json"):
        (out_dir / f"{name}.tmp").replace(out_dir / name)
    blob_path.replace(out_dir / f"descriptors-{shard}.bin")
    seconds = time.monotonic() - started
    report = {
        "shard": shard,
        "images": len(files),
        "vectors": int(matrix.shape[0]),
        "keypointCount": keypoint_summary(counts),
        "seconds": round(seconds, 2),
        "imagesPerSecond": round(len(files) / seconds, 2) if seconds else 0.0,
        "device": embedder.device,
        "dtype": embedder.dtype_name,
    }
    log.info("shard %d features: %s", shard, report)
    return report


def read_features(features_dir: Path, shard: int) -> Iterator[tuple[str, np.ndarray, OrbFeatures]]:
    """Yields `(key, vector, features)` in shard row order."""
    features_dir = Path(features_dir)
    vectors = np.load(features_dir / f"vectors-{shard}.npy")
    keys = json.loads((features_dir / f"keys-{shard}.json").read_text())
    index = json.loads((features_dir / f"descriptors-{shard}.json").read_text())
    blob = (features_dir / f"descriptors-{shard}.bin").read_bytes()
    if not len(vectors) == len(keys) == len(index):
        raise ValueError(f"feature shard {shard} files disagree on row count")
    for row, (key, entry) in enumerate(zip(keys, index, strict=True)):
        if entry["key"] != key:
            raise ValueError(f"feature shard {shard} row {row} key mismatch")
        count = entry["keypointCount"]
        start = entry["offset"]
        split = start + count * DESCRIPTOR_BYTES
        end = split + count * KEYPOINT_BYTES
        yield key, vectors[row], OrbFeatures(blob[start:split], blob[split:end], count)


def update_manifest(
    features_dir: Path, *, run: dict | None = None, shard_report: dict | None = None
) -> dict:
    """`features/manifest.json` describes the whole build; per-shard reports accumulate."""
    features_dir = Path(features_dir)
    features_dir.mkdir(parents=True, exist_ok=True)
    path = features_dir / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    manifest.setdefault("modelVersion", MODEL_VERSION)
    manifest.setdefault("inputSize", INPUT_SIZE)
    manifest.setdefault("embeddingDim", EMBEDDING_DIM)
    manifest.setdefault("orbMaxKeypoints", ORB_MAX_KEYPOINTS)
    manifest.setdefault("startedAt", datetime.now(UTC).isoformat())
    manifest.setdefault("shards", {})
    if run:
        manifest.update(run)
    if shard_report:
        manifest["shards"][str(shard_report["shard"])] = shard_report
        manifest["device"] = shard_report["device"]
        manifest["dtype"] = shard_report["dtype"]
    shards = manifest["shards"].values()
    manifest["counts"] = {
        "shards": len(manifest["shards"]),
        "images": sum(report["images"] for report in shards),
        "vectors": sum(report["vectors"] for report in shards),
    }
    manifest["finishedAt"] = datetime.now(UTC).isoformat()
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(path)
    return manifest


def benchmark(embedder: Embedder, images: int, batch_size: int) -> dict:
    """Throughput of the forward pass alone on repeated letterboxed fixture pixels."""
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "test-painting.jpg"
    with Image.open(fixture) as image:
        pixels = torch.from_numpy(np.array(letterbox(image, INPUT_SIZE))).permute(2, 0, 1)
    batch = pixels.unsqueeze(0).repeat(batch_size, 1, 1, 1).contiguous()
    embedder.embed(batch[:1])
    started = time.monotonic()
    processed = 0
    while processed < images:
        embedder.embed(batch)
        processed += batch_size
    seconds = time.monotonic() - started
    return {
        "images": processed,
        "batchSize": batch_size,
        "seconds": round(seconds, 2),
        "imagesPerSecond": round(processed / seconds, 2),
        "device": embedder.device,
        "dtype": embedder.dtype_name,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Embed one downloaded image shard")
    parser.add_argument("--images", type=Path, help="shard directory, e.g. images/shard-0")
    parser.add_argument(
        "--out", type=Path, help="features directory (default SCRATCH_DIR/features)"
    )
    parser.add_argument("--shard", type=int, help="shard number (default: parsed from --images)")
    parser.add_argument("--fakequant", type=Path, default=DEFAULT_FAKEQUANT)
    parser.add_argument("--dtype", choices=("float16", "float32"), default="float16")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--workers", type=int, default=WORKERS)
    parser.add_argument("--benchmark", type=int, metavar="N", help="time N forward passes and exit")
    args = parser.parse_args(argv)
    settings = get_settings()
    setup_logging(settings)
    embedder = load_embedder(args.fakequant, device=settings.device, dtype=args.dtype)
    if args.benchmark:
        print(json.dumps(benchmark(embedder, args.benchmark, args.batch_size)))
        return 0
    if args.images is None:
        parser.error("--images is required unless --benchmark is given")
    shard = args.shard if args.shard is not None else int(args.images.name.rsplit("-", 1)[1])
    out = args.out or settings.scratch_dir / "features"
    report = embed_shard(
        args.images, out, shard, embedder, batch_size=args.batch_size, workers=args.workers
    )
    update_manifest(out, run={"fakequantSha256": sha256_of(args.fakequant)}, shard_report=report)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())

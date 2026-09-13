"""Gate every build: embed the 200 calibration paintings with the job model and require
cosine ≥ 0.99 mean / ≥ 0.97 min against the iPhone's Neural Engine vectors (decision 001)."""

import argparse
import hashlib
import json
import logging
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

from .config import get_settings, setup_logging
from .model import DEFAULT_FAKEQUANT, Embedder, NonFiniteEmbedding, load_embedder, sha256_of
from .model_version import INPUT_SIZE, MODEL_VERSION, REPO_ROOT
from .polite_http import PoliteClient

log = logging.getLogger(__name__)

CALIBRATION_DIR = Path(__file__).resolve().parents[1] / "calibration"
DEFAULT_URLS = REPO_ROOT / "shared/model/calibration/urls.txt"
DEFAULT_REFERENCE = CALIBRATION_DIR / "iphone-embeddings.json"
DEFAULT_HASHES = CALIBRATION_DIR / "image-hashes.json"
MIN_MEAN = 0.99
MIN_MIN = 0.97
WORST = 5


def reference_letterbox(image: Image.Image, size: int = INPUT_SIZE) -> Image.Image:
    """The exact pixels the iPhone reference was embedded from (spike 00.01: bicubic,
    `round` dimensions, black pad) — this isolates model numerics from preprocessing. The
    index letterbox (`letterbox.py`, mean pad) is the phone's capture contract instead."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = size / max(image.size)
    dimensions = tuple(max(1, round(side * scale)) for side in image.size)
    resized = image.resize(dimensions, Image.Resampling.BICUBIC)
    square = Image.new("RGB", (size, size), (0, 0, 0))
    square.paste(resized, ((size - dimensions[0]) // 2, (size - dimensions[1]) // 2))
    return square


def image_path(cache_dir: Path, url: str) -> Path:
    return Path(cache_dir) / (hashlib.sha256(url.encode()).hexdigest() + ".jpg")


def fetch_calibration_images(
    urls: list[str], cache_dir: Path, hashes: dict[str, str], client: PoliteClient
) -> list[Path]:
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for url in urls:
        path = image_path(cache_dir, url)
        if not path.exists():
            response = client.get(url)
            response.raise_for_status()
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(response.content)
            temporary.replace(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != hashes[url]:
            path.unlink()
            raise ValueError(f"calibration image changed upstream: {url}")
        paths.append(path)
    return paths


def normalized(vectors: np.ndarray) -> np.ndarray:
    values = np.asarray(vectors, dtype=np.float64)
    if values.ndim != 2 or not np.isfinite(values).all():
        raise ValueError("expected a finite matrix of embeddings")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if (norms == 0).any():
        raise ValueError("zero embedding")
    return values / norms


def compare(
    job: np.ndarray,
    reference: np.ndarray,
    urls: list[str],
    *,
    min_mean: float = MIN_MEAN,
    min_min: float = MIN_MIN,
) -> dict:
    if np.shape(job) != np.shape(reference) or len(urls) != len(job) or not len(job):
        raise ValueError("job and reference embeddings must align with the URL list")
    scores = np.sum(normalized(job) * normalized(reference), axis=1)
    order = np.argsort(scores)[:WORST]
    return {
        "mean": float(scores.mean()),
        "min": float(scores.min()),
        "count": len(scores),
        "minMean": min_mean,
        "minMin": min_min,
        "passed": bool(scores.mean() >= min_mean and scores.min() >= min_min),
        "worst": [{"url": urls[i], "cosine": float(scores[i])} for i in order],
    }


def embed_paths(embedder: Embedder, paths: list[Path], batch_size: int = 32) -> np.ndarray:
    vectors = []
    for start in range(0, len(paths), batch_size):
        batch = []
        for path in paths[start : start + batch_size]:
            with Image.open(path) as image:
                pixels = np.array(reference_letterbox(image), dtype=np.uint8)
            batch.append(torch.from_numpy(pixels).permute(2, 0, 1))
        vectors.append(embedder.embed(torch.stack(batch)))
    return np.concatenate(vectors)


def run_drift_check(
    embedder: Embedder,
    *,
    urls: list[str],
    reference: dict[str, list[float]],
    paths: list[Path],
    min_mean: float = MIN_MEAN,
    min_min: float = MIN_MIN,
) -> dict:
    if set(reference) != set(urls):
        raise ValueError("reference embeddings do not cover the calibration URL list")
    job = embed_paths(embedder, paths)
    result = compare(
        job,
        np.asarray([reference[url] for url in urls]),
        urls,
        min_mean=min_mean,
        min_min=min_min,
    )
    return {
        **result,
        "device": embedder.device,
        "dtype": embedder.dtype_name,
        "modelVersion": MODEL_VERSION,
        "checkedAt": datetime.now(UTC).isoformat(),
    }


def format_report(result: dict) -> str:
    verdict = "PASS" if result["passed"] else "FAIL"
    lines = [
        (
            f"drift check on {result['device']}/{result['dtype']}: mean {result['mean']:.5f} "
            f"min {result['min']:.5f} over {result['count']} images "
            f"({verdict}; thresholds {result['minMean']}/{result['minMin']})"
        ),
        "worst:",
    ]
    lines += [f"  {row['cosine']:.5f}  {row['url']}" for row in result["worst"]]
    return "\n".join(lines)


def check_with_fallback(
    load: Callable[[str], Embedder],
    *,
    dtypes: tuple[str, ...],
    urls: list[str],
    reference: dict[str, list[float]],
    paths: list[Path],
    min_mean: float = MIN_MEAN,
    min_min: float = MIN_MIN,
) -> dict:
    """fp16 is the phone's compute dtype; the int8 numerics live in the weights, so fp32 with
    the same weights is the fallback when fp16 is non-finite or misses the thresholds."""
    attempts: list[dict] = []
    last: dict | None = None
    for dtype in dtypes:
        try:
            last = run_drift_check(
                load(dtype),
                urls=urls,
                reference=reference,
                paths=paths,
                min_mean=min_mean,
                min_min=min_min,
            )
        except NonFiniteEmbedding as error:
            log.warning("%s: %s", dtype, error)
            attempts.append({"dtype": dtype, "error": str(error)})
            continue
        attempts.append({"dtype": dtype, "mean": last["mean"], "min": last["min"]})
        if last["passed"]:
            break
    result = dict(last) if last else {"passed": False}
    result["attempts"] = attempts
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare the job model with the iPhone reference")
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--urls", type=Path, default=DEFAULT_URLS)
    parser.add_argument("--hashes", type=Path, default=DEFAULT_HASHES)
    parser.add_argument("--fakequant", type=Path, default=DEFAULT_FAKEQUANT)
    parser.add_argument("--cache", type=Path, help="image cache (default SCRATCH_DIR/calibration)")
    parser.add_argument(
        "--out", type=Path, help="result JSON (default SCRATCH_DIR/features/drift-check.json)"
    )
    parser.add_argument("--dtype", choices=("auto", "float16", "float32"), default="auto")
    parser.add_argument("--min-mean", type=float, default=MIN_MEAN)
    parser.add_argument("--min-min", type=float, default=MIN_MIN)
    args = parser.parse_args(argv)
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    urls = args.urls.read_text().splitlines()
    if len(urls) != len(set(urls)) or not urls:
        parser.error("calibration URLs must be unique and nonempty")
    hashes = json.loads(args.hashes.read_text())
    reference = json.loads(args.reference.read_text())
    with PoliteClient(
        user_agent=settings.user_agent, per_host_rps=8.0, robots=False, cache_max_bytes=0
    ) as client:
        paths = fetch_calibration_images(
            urls, args.cache or settings.scratch_dir / "calibration", hashes, client
        )
    dtypes = ("float16", "float32") if args.dtype == "auto" else (args.dtype,)
    result = check_with_fallback(
        lambda dtype: load_embedder(args.fakequant, device=settings.device, dtype=dtype),
        dtypes=dtypes,
        urls=urls,
        reference=reference,
        paths=paths,
        min_mean=args.min_mean,
        min_min=args.min_min,
    )
    result["fakequantSha256"] = sha256_of(args.fakequant)
    out = args.out or settings.scratch_dir / "features" / "drift-check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    if "mean" in result:
        print(format_report(result))
    else:
        print(f"drift check produced no finite embeddings: {result['attempts']}")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

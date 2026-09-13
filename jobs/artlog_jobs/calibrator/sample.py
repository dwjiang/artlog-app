"""Export the active index, sample public-domain objects, and write augmented candidate rows."""

import argparse
import hashlib
import json
import logging
import shutil
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import torch
from PIL import Image

from ..config import get_settings, setup_logging
from ..convex_writer import ConvexWriter
from ..download import (
    SOURCE_RATES,
    DownloadIncomplete,
    ImageTask,
    SourceBlocked,
    default_client_factory,
    download_shard,
    image_filename,
)
from ..letterbox import letterbox
from ..model import DEFAULT_FAKEQUANT, Embedder, load_embedder, sha256_of
from ..model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION, ORB_MAX_KEYPOINTS
from ..orb import OrbFeatures, extract_orb, to_gray
from .augment import augment
from .features import candidate_rows

log = logging.getLogger(__name__)

BATCH_SIZE = 25
DOWNLOAD_ATTEMPTS = 3


@dataclass(frozen=True)
class Reference:
    features: OrbFeatures
    input_size: int


@dataclass
class Index:
    vectors: np.ndarray
    object_ids: list[str]
    objects: dict[str, dict]
    descriptors: dict[str, Reference]

    def fingerprint(self) -> str:
        digest = hashlib.sha256(memoryview(self.vectors))
        digest.update(json.dumps(self.object_ids).encode())
        digest.update(json.dumps(self.objects, sort_keys=True).encode())
        for object_id, reference in sorted(self.descriptors.items()):
            digest.update(
                json.dumps([object_id, reference.input_size, reference.features.count]).encode()
            )
            digest.update(reference.features.descriptors)
            digest.update(reference.features.keypoints)
        return digest.hexdigest()


def _pages(call, name: str, args: dict):
    cursor = None
    while True:
        result = call(name, args | ({"cursor": cursor} if cursor is not None else {}))
        yield result["page"]
        if result["isDone"]:
            return
        next_cursor = result["continueCursor"]
        if not next_cursor or next_cursor == cursor:
            raise ValueError(f"{name}: pagination did not advance")
        cursor = next_cursor


def load_index(writer: ConvexWriter, *, model_version: str = MODEL_VERSION) -> Index:
    chunks = []
    object_ids = []
    objects = {}
    for page in _pages(writer.query, "ingest:exportVectors", {"modelVersion": model_version}):
        if not page:
            continue
        chunk = np.asarray([row["vector"] for row in page], dtype=np.float32)
        if chunk.shape != (len(page), EMBEDDING_DIM) or not np.isfinite(chunk).all():
            raise ValueError("exported vectors have invalid dimensions or non-finite values")
        norms = np.linalg.norm(chunk, axis=1, keepdims=True)
        if (norms == 0).any():
            raise ValueError("export contains a zero-norm vector")
        chunks.append(chunk / norms)
        for row in page:
            obj = row["object"]
            object_id = obj["objectId"]
            if object_id in objects and objects[object_id] != obj:
                raise ValueError("index changed during export; rerun against a stable index")
            objects[object_id] = obj
            object_ids.append(object_id)
        log.info("exported %d vectors", len(object_ids))
    if not chunks:
        raise ValueError(f"no indexed vectors for {model_version}; finish plan 02.05 first")
    descriptors = {}
    for page in _pages(writer.action, "ingest:exportDescriptors", {}):
        for row in page:
            if row["objectId"] not in objects:
                continue
            count = int(row["keypointCount"])
            features = OrbFeatures(row["descriptors"], row["keypoints"], count)
            if (
                count != row["keypointCount"]
                or not 0 <= count <= ORB_MAX_KEYPOINTS
                or len(features.descriptors) != count * 32
                or len(features.keypoints) != count * 16
                or row["inputSize"] != INPUT_SIZE
                or not np.isfinite(features.keypoint_array()).all()
            ):
                raise ValueError("exported ORB reference differs from the current model contract")
            if row["objectId"] in descriptors:
                raise ValueError("duplicate reference descriptors for an object")
            descriptors[row["objectId"]] = Reference(features, int(row["inputSize"]))
    return Index(np.concatenate(chunks), object_ids, objects, descriptors)


def select_objects(index: Index, *, count: int = 5000, seed: int) -> list[dict]:
    strata: dict[str, list[dict]] = {}
    for object_id, obj in sorted(index.objects.items()):
        source = obj["key"].split(":", 1)[0]
        if (
            obj["rightsStatus"] == "public_domain"
            and obj["source"] == "corpus"
            and obj.get("imageRef")
            and object_id in index.descriptors
            and source in SOURCE_RATES
        ):
            strata.setdefault(source, []).append(obj)
    available = sum(map(len, strata.values()))
    if not 1 <= count <= available:
        raise ValueError(
            f"requested {count} objects, but only {available} eligible public-domain "
            "objects have vectors, descriptors and downloadable images"
        )
    names = sorted(strata)
    quotas = np.array([len(strata[name]) * count / available for name in names])
    counts = np.floor(quotas).astype(int)
    for i in np.argsort(-(quotas - counts), kind="stable")[: count - int(counts.sum())]:
        counts[i] += 1
    rng = np.random.default_rng(seed)
    selected = []
    for name, size in zip(names, counts, strict=True):
        indices = rng.choice(len(strata[name]), size=int(size), replace=False)
        selected.extend(strata[name][i] for i in indices)
    rng.shuffle(selected)
    return selected


def _download_batch(downloader, shard: int, tasks: list[ImageTask], *, work: Path, client_factory):
    """Retry a batch whose retryable downloads (429s, exhausted transports) were left pending;
    `download_shard` resumes from its state directory, so only missing images are refetched.
    Permanent failures stay missing and the caller skips them; a blocked source still stops."""
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            downloader(
                shard,
                tasks,
                images_dir=work / "images",
                state_dir=work / "downloads",
                client_factory=client_factory,
            )
            return
        except SourceBlocked:
            raise
        except DownloadIncomplete as error:
            log.warning(
                "batch %d download attempt %d/%d: %s", shard, attempt, DOWNLOAD_ATTEMPTS, error
            )


def write_samples(
    *,
    index: Index,
    selected: list[dict],
    embedder: Embedder,
    out: Path,
    scratch: Path,
    seed: int,
    client_factory,
    downloader=download_shard,
) -> dict:
    scratch.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    rows_written = 0
    positives = 0
    processed: list[dict] = []
    skipped: list[dict] = []
    with TemporaryDirectory(prefix="calibrator-", dir=scratch) as work:
        work = Path(work)
        temporary = work / "features.jsonl"
        with temporary.open("w") as body:
            for start in range(0, len(selected), BATCH_SIZE):
                batch = selected[start : start + BATCH_SIZE]
                tasks = [
                    ImageTask(obj["key"], obj["imageRef"], obj["key"].split(":")[0])
                    for obj in batch
                ]
                shard = start // BATCH_SIZE
                _download_batch(downloader, shard, tasks, work=work, client_factory=client_factory)
                for offset, obj in enumerate(batch):
                    path = work / "images" / f"shard-{shard}" / image_filename(obj["key"])
                    if not path.exists():
                        log.warning("skipping %s: image could not be downloaded", obj["key"])
                        skipped.append({"objectId": obj["objectId"], "key": obj["key"]})
                        continue
                    processed.append(obj)
                    # Seeds follow the selection index, so a skipped object leaves the others unchanged.
                    sample_seed = seed + start + offset
                    with Image.open(path) as image:
                        variants = augment(image, seed=sample_seed)
                    boxed = [letterbox(variant, INPUT_SIZE) for variant in variants.values()]
                    pixels = np.stack([np.asarray(image).transpose(2, 0, 1) for image in boxed])
                    embeddings = embedder.embed(torch.from_numpy(pixels))
                    for i, (name, image) in enumerate(zip(variants, boxed, strict=True)):
                        rows = candidate_rows(
                            index,
                            embeddings[i],
                            extract_orb(to_gray(image)),
                            source_object_id=obj["objectId"],
                            query_id=f"{obj['objectId']}:{name}",
                            rng=np.random.default_rng(sample_seed * 4 + i),
                        )
                        for row in rows:
                            body.write(json.dumps(row, allow_nan=False) + "\n")
                        rows_written += len(rows)
                        positives += sum(row["label"] for row in rows)
                    body.flush()
                    path.unlink()
                    log.info(
                        "augmented %d/%d objects (%d rows)",
                        start + offset + 1,
                        len(selected),
                        rows_written,
                    )
        if not processed:
            raise ValueError("no sampled image could be downloaded; nothing was published")
        # Scratch and output may be on different volumes.
        staged = out.with_suffix(out.suffix + ".tmp")
        try:
            shutil.copyfile(temporary, staged)
            staged.replace(out)
        finally:
            staged.unlink(missing_ok=True)
    return {
        "objects": len(processed),
        "skipped": len(skipped),
        "queries": len(processed) * 4,
        "rows": rows_written,
        "positiveRows": positives,
        "queriesWithoutTrueCandidate": len(processed) * 4 - positives,
        "sources": dict(Counter(obj["key"].split(":")[0] for obj in processed)),
        "sourceObjects": [{"objectId": obj["objectId"], "key": obj["key"]} for obj in processed],
        "skippedObjects": skipped,
        "seed": seed,
        "indexVectors": len(index.vectors),
        "indexObjects": len(index.objects),
        "indexSha256": index.fingerprint(),
        "featuresSha256": sha256_of(out),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--objects", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20260911)
    parser.add_argument("--out", type=Path, default=Path("out/calibrator-features.jsonl"))
    parser.add_argument("--fakequant", type=Path, default=DEFAULT_FAKEQUANT)
    parser.add_argument("--dtype", choices=["float16", "float32"], default="float16")
    args = parser.parse_args(argv)
    settings = get_settings()
    setup_logging(settings)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        index = load_index(ConvexWriter(settings))
        selected = select_objects(index, count=args.objects, seed=args.seed)
        embedder = load_embedder(args.fakequant, device=settings.device, dtype=args.dtype)
        summary = write_samples(
            index=index,
            selected=selected,
            embedder=embedder,
            out=args.out,
            scratch=settings.scratch_dir,
            seed=args.seed,
            client_factory=default_client_factory(settings, dict(SOURCE_RATES)),
        )
        summary.update(
            modelVersion=MODEL_VERSION,
            device=embedder.device,
            dtype=embedder.dtype_name,
            fakequantSha256=sha256_of(args.fakequant),
            convexUrl=settings.convex_url,
        )
        args.out.with_suffix(".manifest.json").write_text(
            json.dumps(summary, indent=2, allow_nan=False) + "\n"
        )
        print(
            json.dumps(
                {
                    key: value
                    for key, value in summary.items()
                    if key not in ("sourceObjects", "skippedObjects")
                }
            )
        )
    except (ValueError, FileNotFoundError) as error:
        log.error("%s", error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

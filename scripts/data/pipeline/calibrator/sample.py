"""Load the local corpus package, sample public-domain objects, and write augmented candidate rows."""

import argparse
import json
import logging
import shutil
from collections import Counter, defaultdict
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import torch
from PIL import Image

from ..config import get_settings, setup_logging
from ..download import (
    SOURCE_RATES,
    DownloadIncomplete,
    ImageTask,
    SourceBlocked,
    default_client_factory,
    download_shard,
    image_filename,
)
from ..features import Features, file_hash, read_jsonl
from ..letterbox import letterbox
from ..model import DEFAULT_FAKEQUANT, Embedder, load_embedder, sha256_of
from ..model_version import INPUT_SIZE, MODEL_VERSION
from ..orb import OrbFeatures, extract_orb, to_gray
from .augment import augment
from .features import OUT_OF_INDEX_RATE, candidate_rows

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
    descriptors: Mapping[str, Reference]
    fingerprint: str

    def __post_init__(self):
        rows = defaultdict(list)
        works = defaultdict(list)
        for row, object_id in enumerate(self.object_ids):
            rows[object_id].append(row)
            works[self.objects[object_id]["artworkKey"]].append(row)
        self.object_rows = dict(rows)
        self.artwork_rows = dict(works)
        self._withheld: dict[str, np.ndarray] = {}

    def withheld_rows(self, object_id: str, duplicate_cosine: float) -> np.ndarray:
        """Hide the source artwork and every view of objects with a reference this close to
        the source. Cached because every variant of an object reuses it."""
        if object_id not in self._withheld:
            source = self.vectors[self.object_rows[object_id]]
            hidden = (self.vectors @ source.T).max(axis=1) >= duplicate_cosine
            duplicates = {self.object_ids[row] for row in np.flatnonzero(hidden)}
            for duplicate in duplicates:
                hidden[self.object_rows[duplicate]] = True
            hidden[self.artwork_rows[self.objects[object_id]["artworkKey"]]] = True
            self._withheld = {object_id: np.flatnonzero(hidden)}
        return self._withheld[object_id]


class PackageReferences(Mapping):
    """Each indexed survivor's selected ORB reference, read from the shard on demand."""

    def __init__(self, features: Features, views: dict[str, str]):
        self.features = features
        self.views = views

    def __getitem__(self, object_id: str) -> Reference:
        row = self.features.descriptors(self.views[object_id])
        return Reference(
            OrbFeatures(row["descriptors"], row["keypoints"], row["keypointCount"]),
            row["inputSize"],
        )

    def __iter__(self) -> Iterator[str]:
        return iter(self.views)

    def __len__(self) -> int:
        return len(self.views)

    def __contains__(self, object_id: object) -> bool:
        return object_id in self.views


def load_index(directory: Path) -> Index:
    """A merged corpus package: every indexed view, one
    ORB reference per survivor, and artwork keys for artwork-level labels."""
    stats = json.loads((directory / "stats.json").read_text())
    if not stats["completeFeatures"]:
        raise ValueError(
            f"{directory} lacks complete features; train against the full corpus build"
        )
    features = Features(directory)
    views = read_jsonl(directory / "vector-index.jsonl")
    # A plain array: memmap-subclass results make every later row lookup slow.
    vectors = np.ascontiguousarray(
        np.stack([features.vectors[row["viewKey"]] for row in views]), dtype=np.float32
    )
    survivors = {row["objectKey"] for row in views}
    works = {row["key"]: row for row in read_jsonl(directory / "artworks.jsonl")}
    objects = {}
    for row in read_jsonl(directory / "objects.jsonl"):
        if row["key"] in survivors:
            objects[row["key"]] = {
                "objectId": row["key"],
                "key": row["key"],
                "artworkKey": row["artworkKey"],
                "source": row["source"],
                "imageRef": row.get("imageRef"),
                "rightsStatus": works[row["artworkKey"]]["rightsStatus"],
                # Training uses the zero corpus penalties written by the importer.
                "objectPenalty": 0,
            }
    if objects.keys() != survivors:
        raise ValueError("vector-index.jsonl names objects that objects.jsonl lacks")
    references = {
        row["objectKey"]: row["viewKey"] for row in read_jsonl(directory / "descriptor-index.jsonl")
    }
    return Index(
        vectors,
        [row["objectKey"] for row in views],
        objects,
        PackageReferences(features, references),
        file_hash(directory / "stats.json"),
    )


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
    queries = 0
    lost = 0
    hidden = 0
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
                    queries += len(boxed)
                    pixels = np.stack([np.asarray(image).transpose(2, 0, 1) for image in boxed])
                    embeddings = embedder.embed(torch.from_numpy(pixels))
                    # One pass over the index serves every variant of this object.
                    scores = index.vectors @ embeddings.T
                    for i, (name, image) in enumerate(zip(variants, boxed, strict=True)):
                        rng = np.random.default_rng([sample_seed, i])
                        out_of_index = bool(rng.random() < OUT_OF_INDEX_RATE)
                        rows = candidate_rows(
                            index,
                            embeddings[i],
                            extract_orb(to_gray(image)),
                            source_object_id=obj["objectId"],
                            query_id=f"{obj['objectId']}:{name}",
                            rng=rng,
                            out_of_index=out_of_index,
                            scores=np.ascontiguousarray(scores[:, i]),
                        )
                        for row in rows:
                            body.write(json.dumps(row, allow_nan=False) + "\n")
                        rows_written += len(rows)
                        positives += sum(row["label"] for row in rows)
                        hidden += out_of_index
                        lost += not out_of_index and not any(row["label"] for row in rows)
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
        "queries": queries,
        "rows": rows_written,
        "positiveRows": positives,
        "outOfIndexQueries": hidden,
        "queriesWithoutTrueCandidate": lost,
        "sources": dict(Counter(obj["key"].split(":")[0] for obj in processed)),
        "sourceObjects": [{"objectId": obj["objectId"], "key": obj["key"]} for obj in processed],
        "skippedObjects": skipped,
        "seed": seed,
        "indexVectors": len(index.vectors),
        "indexObjects": len(index.objects),
        "indexSha256": index.fingerprint,
        "featuresSha256": sha256_of(out),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--index", type=Path, required=True, help="merged corpus package, e.g. merged-pca512"
    )
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
        index = load_index(args.index)
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
            indexSource=str(args.index),
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

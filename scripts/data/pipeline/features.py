"""Read the feature shard format written by embed_shard, without loading image pixels."""

import hashlib
import json
from collections.abc import Iterable
from pathlib import Path

import numpy as np

from .model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION, ORB_MAX_KEYPOINTS
from .orb import DESCRIPTOR_BYTES, KEYPOINT_BYTES


def read_jsonl(path: Path) -> list[dict]:
    with path.open() as body:
        return [json.loads(line) for line in body if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as body:
        for row in rows:
            body.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(path)


def file_hash(path: Path) -> str:
    with path.open("rb") as body:
        return hashlib.file_digest(body, "sha256").hexdigest()


class Features:
    def __init__(self, directory: Path):
        self.directory = directory
        self.manifest = json.loads((directory / "manifest.json").read_text())
        for field, expected in (
            ("modelVersion", MODEL_VERSION),
            ("inputSize", INPUT_SIZE),
            ("embeddingDim", EMBEDDING_DIM),
            ("orbMaxKeypoints", ORB_MAX_KEYPOINTS),
        ):
            if self.manifest.get(field) != expected:
                raise ValueError(f"Feature manifest {field} must equal {expected}")
        drift = self.manifest.get("driftCheck", {})
        if not drift.get("passed") or drift.get("mean", 0) < 0.99 or drift.get("min", 0) < 0.97:
            raise ValueError("Feature manifest must contain a passing phone drift check")
        self.vectors: dict[str, np.ndarray] = {}
        self.locations: dict[str, dict] = {}
        self.files = ["manifest.json"]
        for shard in sorted(self.manifest["shards"], key=int):
            names = [
                f"vectors-{shard}.npy",
                f"keys-{shard}.json",
                f"descriptors-{shard}.json",
                f"descriptors-{shard}.bin",
            ]
            matrix = np.load(directory / names[0], mmap_mode="r", allow_pickle=False)
            keys = json.loads((directory / names[1]).read_text())
            index = json.loads((directory / names[2]).read_text())
            if matrix.shape != (len(keys), EMBEDDING_DIM) or matrix.dtype != np.float32:
                raise ValueError(f"Invalid vector shape or dtype in shard {shard}")
            if len(index) != len(keys) or self.manifest["shards"][shard]["vectors"] != len(keys):
                raise ValueError(f"Feature shard {shard} row counts disagree")
            if not np.isfinite(matrix).all() or not np.allclose(
                np.linalg.norm(matrix, axis=1), 1, atol=0.001
            ):
                raise ValueError(f"Feature shard {shard} vectors must be finite unit vectors")
            offset = 0
            for row, (key, entry) in enumerate(zip(keys, index, strict=True)):
                count = entry["keypointCount"]
                if (
                    key in self.vectors
                    or entry["key"] != key
                    or entry["offset"] != offset
                    or type(count) is not int
                    or not 0 <= count <= ORB_MAX_KEYPOINTS
                ):
                    raise ValueError(f"Invalid descriptor index for {key}")
                self.vectors[key] = matrix[row]
                self.locations[key] = {"shard": int(shard), "row": row, **entry}
                offset += count * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)
            if (directory / names[3]).stat().st_size != offset:
                raise ValueError(f"Truncated or trailing descriptor bytes in shard {shard}")
            self.files.extend(names)
        if len(self.vectors) != self.manifest["counts"]["vectors"]:
            raise ValueError("Feature manifest total does not match shards")

    def descriptors(self, key: str) -> dict:
        entry = self.locations[key]
        count = entry["keypointCount"]
        with (self.directory / f"descriptors-{entry['shard']}.bin").open("rb") as body:
            body.seek(entry["offset"])
            descriptors = body.read(count * DESCRIPTOR_BYTES)
            keypoints = body.read(count * KEYPOINT_BYTES)
        return {
            "descriptors": descriptors,
            "keypoints": keypoints,
            "keypointCount": count,
            "inputSize": INPUT_SIZE,
        }

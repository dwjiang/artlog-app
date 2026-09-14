"""The TypeScript calibrator's feature order, transforms, and candidate budget."""

import argparse
import json
import math
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from ..model_version import REPO_ROOT
from ..orb import OrbFeatures
from .verify import verify

if TYPE_CHECKING:
    from .sample import Index

FEATURE_NAMES = [
    "similarity",
    "margin",
    "logCandidateCount",
    "atVenue",
    "gallerySame",
    "galleryDifferent",
    "onView",
    "logKeypointCount",
    "logInliers",
    "homographyValid",
    "objectPenalty",
]


def _finite(value: float, name: str, *, count: bool = False) -> float:
    if not math.isfinite(value) or (count and value < 0):
        raise ValueError(f"{name} must be finite" + (" and non-negative" if count else ""))
    return value


def featurize(signals: dict) -> np.ndarray:
    similarity = min(1, max(0, _finite(signals["similarity"], "similarity")))
    runner = _finite(signals["runnerUpSimilarity"], "runnerUpSimilarity")
    count = _finite(signals["candidateCount"], "candidateCount", count=True)
    keypoints = _finite(signals["keypointCount"] or 0, "keypointCount", count=True)
    inliers = _finite(signals["orbInliers"], "orbInliers", count=True)
    penalty = min(1, max(0, _finite(signals["objectPenalty"], "objectPenalty")))
    return np.array(
        [
            similarity,
            max(0, similarity - runner),
            math.log1p(count),
            int(signals["atVenue"]),
            int(signals["gallery"] == "same"),
            int(signals["gallery"] == "different"),
            int(signals["onView"] is True),
            math.log1p(keypoints),
            math.log1p(inliers),
            int(signals["homographyValid"]),
            penalty,
        ],
        dtype=np.float64,
    )


def top_candidates(
    vectors: np.ndarray, object_ids: list[str], query: np.ndarray, *, limit: int = 32
) -> list[tuple[str, float]]:
    if not len(vectors):
        return []
    query = np.asarray(query, dtype=np.float32)
    norm = np.linalg.norm(query)
    if query.shape != (vectors.shape[1],) or not np.isfinite(query).all() or norm == 0:
        raise ValueError("query must be a finite, nonzero embedding of the index dimension")
    scores = vectors @ (query / norm)
    count = min(limit, len(scores))
    if count <= 0:
        raise ValueError("limit must be positive")
    cutoff = np.partition(scores, len(scores) - count)[-count]
    # Include boundary ties, then use vector order so equal scores remain reproducible.
    hits = np.flatnonzero(scores >= cutoff)
    hits = hits[np.lexsort((hits, -scores[hits]))][:count]
    objects: dict[str, float] = {}
    for i in hits:
        objects.setdefault(object_ids[i], float(scores[i]))
    return list(objects.items())[:20]


def candidate_rows(
    index: "Index",
    vector: np.ndarray,
    orb: OrbFeatures,
    *,
    source_object_id: str,
    query_id: str,
    rng: np.random.Generator,
) -> list[dict]:
    candidates = top_candidates(index.vectors, index.object_ids, vector)
    rows = []
    verified = 0
    for object_id, similarity in candidates:
        reference = index.descriptors.get(object_id)
        verification = {"orbInliers": 0, "homographyValid": False}
        if reference is not None and verified < 10:
            verification = verify(orb, reference.features, input_size=reference.input_size)
            verified += 1
        positive = object_id == source_object_id
        at_venue = bool(rng.random() < (0.85 if positive else 0.1))
        # Gallery is unknown off venue, as in identifyPipeline. See scripts/data/README.md for priors.
        gallery = str(
            rng.choice(
                ["same", "unknown", "different"], p=[0.5, 0.4, 0.1] if positive else [0.1, 0.8, 0.1]
            )
        )
        on_view = rng.choice([True, False, None], p=[0.8, 0.1, 0.1])
        signals = {
            "similarity": similarity,
            "runnerUpSimilarity": next((score for oid, score in candidates if oid != object_id), 0),
            "candidateCount": len(candidates),
            "atVenue": at_venue,
            "gallery": gallery if at_venue else "unknown",
            "onView": on_view,
            "keypointCount": reference.features.count if reference is not None else None,
            **verification,
            "objectPenalty": index.objects[object_id]["objectPenalty"],
        }
        rows.append(
            {
                "queryId": query_id,
                "sourceObjectId": source_object_id,
                "candidateObjectId": object_id,
                "label": int(positive),
                "signals": signals,
                "features": featurize(signals).tolist(),
            }
        )
    return rows


def parity_rows() -> list[dict]:
    base = {
        "similarity": 0,
        "runnerUpSimilarity": 0,
        "candidateCount": 0,
        "atVenue": False,
        "gallery": "unknown",
        "onView": None,
        "keypointCount": 0,
        "orbInliers": 0,
        "homographyValid": False,
        "objectPenalty": 0,
    }
    variations = [
        {},
        {
            "similarity": 0.9,
            "runnerUpSimilarity": 0.8,
            "candidateCount": 20,
            "atVenue": True,
            "gallery": "same",
            "onView": True,
            "keypointCount": 300,
            "orbInliers": 40,
            "homographyValid": True,
        },
        {"similarity": 1.4, "runnerUpSimilarity": 0.95, "objectPenalty": 7},
        {"similarity": -0.2, "runnerUpSimilarity": -0.3, "objectPenalty": -1},
        {"similarity": 0.7, "runnerUpSimilarity": 0.9, "gallery": "different"},
        {"keypointCount": None, "onView": False, "candidateCount": 32},
        {"similarity": 0.93, "runnerUpSimilarity": 0.89, "keypointCount": 79, "atVenue": True},
        {"keypointCount": 80, "orbInliers": 15, "homographyValid": True},
        {"candidateCount": 1, "keypointCount": 500, "orbInliers": 500, "objectPenalty": 0.8},
        {"candidateCount": 2.5, "keypointCount": 0.5, "orbInliers": 0.5, "onView": True},
    ]
    return [
        {"signals": base | change, "expectedFeatures": featurize(base | change).tolist()}
        for change in variations
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the Python → TypeScript parity fixture")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "shared/calibrator/fixtures/calibrator-features.json",
    )
    args = parser.parse_args()
    args.out.write_text(json.dumps(parity_rows(), indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()

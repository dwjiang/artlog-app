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
    "atVenue",
    "gallerySame",
    "galleryDifferent",
    "onView",
    "logKeypointCount",
    "logInliers",
    "homographyValid",
    "objectPenalty",
    "venueKnown",
    "inlierLead",
]
# Mirrors MAX_ORB_VERIFICATIONS in convex/lib/identifyPipeline.ts.
MAX_ORB_VERIFICATIONS = 10
# Share of training queries that carry a venue. Scans without one (at home, a screen, an unresolved
# location) must not score lower merely because no candidate can be at the venue.
VENUE_KNOWN_RATE = 0.5
# Share of training queries whose artwork is withheld from the index, as for a scan of a work the
# catalogue lacks: the top candidate is then wrong however far it stands from the rest.
OUT_OF_INDEX_RATE = 0.3
# A different-artwork reference this close to the source's is an unmerged duplicate entry of the
# same image, not a look-alike: training sets it aside and withholding hides it with the source.
DUPLICATE_REFERENCE_COSINE = 0.97


def _finite(value: float, name: str, *, count: bool = False) -> float:
    if not math.isfinite(value) or (count and value < 0):
        raise ValueError(f"{name} must be finite" + (" and non-negative" if count else ""))
    return value


def featurize(signals: dict) -> np.ndarray:
    similarity = min(1, max(0, _finite(signals["similarity"], "similarity")))
    runner = _finite(signals["runnerUpSimilarity"], "runnerUpSimilarity")
    keypoints = _finite(signals["keypointCount"] or 0, "keypointCount", count=True)
    inliers = _finite(signals["orbInliers"], "orbInliers", count=True)
    runner_inliers = _finite(signals["runnerUpInliers"], "runnerUpInliers", count=True)
    penalty = min(1, max(0, _finite(signals["objectPenalty"], "objectPenalty")))
    return np.array(
        [
            similarity,
            max(0, similarity - runner),
            int(signals["atVenue"]),
            int(signals["gallery"] == "same"),
            int(signals["gallery"] == "different"),
            int(signals["onView"] is True),
            math.log1p(keypoints),
            math.log1p(inliers),
            int(signals["homographyValid"]),
            penalty,
            int(signals["venueKnown"]),
            math.log1p(inliers) - math.log1p(runner_inliers),
        ],
        dtype=np.float64,
    )


def top_candidates(
    vectors: np.ndarray,
    object_ids: list[str],
    query: np.ndarray,
    *,
    limit: int = 32,
    excluded: np.ndarray | None = None,
    scores: np.ndarray | None = None,
) -> list[tuple[str, float]]:
    """`scores` may carry `vectors @ query` precomputed (one matrix product serves a batch of
    queries); excluded rows are dropped from it in place."""
    if not len(vectors):
        return []
    if scores is None:
        query = np.asarray(query, dtype=np.float32)
        norm = np.linalg.norm(query)
        if query.shape != (vectors.shape[1],) or not np.isfinite(query).all() or norm == 0:
            raise ValueError("query must be a finite, nonzero embedding of the index dimension")
        scores = vectors @ (query / norm)
    if excluded is not None and len(excluded):
        scores[excluded] = -np.inf
    if limit <= 0:
        raise ValueError("limit must be positive")
    count = min(limit, int(np.isfinite(scores).sum()))
    if count == 0:
        return []
    cutoff = np.partition(scores, len(scores) - count)[-count]
    # Include boundary ties, then use vector order so equal scores remain reproducible.
    hits = np.flatnonzero(scores >= cutoff)
    hits = hits[np.lexsort((hits, -scores[hits]))][:count]
    objects: dict[str, float] = {}
    for i in hits:
        objects.setdefault(object_ids[i], float(scores[i]))
    return list(objects.items())[:20]


def reference_match(index: "Index", source_object_id: str, object_id: str) -> bool:
    """The two catalogue references show one composition: a duplicate entry, replica or copy
    whose embedding sits below the duplicate cutoff but whose geometry still lines up."""
    source = index.descriptors.get(source_object_id)
    other = index.descriptors.get(object_id)
    if source is None or other is None:
        return False
    return verify(other.features, source.features, input_size=source.input_size)["homographyValid"]


def candidate_rows(
    index: "Index",
    vector: np.ndarray,
    orb: OrbFeatures,
    *,
    source_object_id: str,
    query_id: str,
    rng: np.random.Generator,
    out_of_index: bool = False,
    scores: np.ndarray | None = None,
) -> list[dict]:
    """Labels are artwork-level: another object of the source's artwork is a correct answer.
    `referenceCosine` compares each candidate's reference vectors with the source's, so training
    can set aside unmerged duplicate entries of the same image instead of calling them wrong;
    `referenceMatch` flags verified wrong answers whose reference shows the same composition.
    An out-of-index query searches without the source artwork and its duplicates."""
    source_artwork = index.objects[source_object_id]["artworkKey"]
    source_vectors = index.vectors[index.object_rows[source_object_id]]
    excluded = (
        index.withheld_rows(source_object_id, DUPLICATE_REFERENCE_COSINE) if out_of_index else None
    )
    candidates = top_candidates(
        index.vectors, index.object_ids, vector, excluded=excluded, scores=scores
    )
    references = {object_id: index.descriptors.get(object_id) for object_id, _ in candidates}
    verifications = {}
    for object_id, _ in candidates:
        reference = references[object_id]
        if reference is not None and len(verifications) < MAX_ORB_VERIFICATIONS:
            verifications[object_id] = verify(
                orb, reference.features, input_size=reference.input_size
            )
    venue_known = bool(rng.random() < VENUE_KNOWN_RATE)
    rows = []
    for object_id, similarity in candidates:
        reference = references[object_id]
        verification = verifications.get(object_id, {"orbInliers": 0, "homographyValid": False})
        positive = index.objects[object_id]["artworkKey"] == source_artwork
        at_venue = venue_known and bool(rng.random() < (0.85 if positive else 0.1))
        # Simulated context priors, not observed visits: atVenue 0.85/0.10 (positive/negative)
        # when the scan has a venue, gallery same/unknown/different 0.5/0.4/0.1 vs 0.1/0.8/0.1,
        # onView true/false/unknown 0.8/0.1/0.1. Gallery is unknown off venue, as in identifyPipeline.
        gallery = str(
            rng.choice(
                ["same", "unknown", "different"], p=[0.5, 0.4, 0.1] if positive else [0.1, 0.8, 0.1]
            )
        )
        on_view = rng.choice([True, False, None], p=[0.8, 0.1, 0.1])
        signals = {
            "similarity": similarity,
            "runnerUpSimilarity": next((score for oid, score in candidates if oid != object_id), 0),
            "atVenue": at_venue,
            "venueKnown": venue_known,
            "gallery": gallery if at_venue else "unknown",
            "onView": on_view,
            "keypointCount": reference.features.count if reference is not None else None,
            **verification,
            "runnerUpInliers": max(
                (v["orbInliers"] for oid, v in verifications.items() if oid != object_id), default=0
            ),
            "objectPenalty": index.objects[object_id]["objectPenalty"],
        }
        reference_cosine = float(
            (index.vectors[index.object_rows[object_id]] @ source_vectors.T).max()
        )
        # Only geometrically verified wrong answers can look right, so only they are checked.
        same_composition = (
            not positive
            and verification["homographyValid"]
            and reference_match(index, source_object_id, object_id)
        )
        rows.append(
            {
                "queryId": query_id,
                "sourceObjectId": source_object_id,
                "candidateObjectId": object_id,
                "candidateArtworkId": index.objects[object_id]["artworkKey"],
                "label": int(positive),
                "outOfIndex": out_of_index,
                "referenceCosine": reference_cosine,
                "referenceMatch": same_composition,
                "signals": signals,
                "features": featurize(signals).tolist(),
            }
        )
    return rows


def parity_rows() -> list[dict]:
    base = {
        "similarity": 0,
        "runnerUpSimilarity": 0,
        "atVenue": False,
        "gallery": "unknown",
        "onView": None,
        "keypointCount": 0,
        "orbInliers": 0,
        "homographyValid": False,
        "runnerUpInliers": 0,
        "objectPenalty": 0,
        "venueKnown": False,
    }
    variations = [
        {},
        {
            "similarity": 0.9,
            "runnerUpSimilarity": 0.8,
            "atVenue": True,
            "venueKnown": True,
            "gallery": "same",
            "onView": True,
            "keypointCount": 300,
            "orbInliers": 40,
            "homographyValid": True,
        },
        {"similarity": 1.4, "runnerUpSimilarity": 0.95, "objectPenalty": 7},
        {"similarity": -0.2, "runnerUpSimilarity": -0.3, "objectPenalty": -1},
        {"similarity": 0.7, "runnerUpSimilarity": 0.9, "gallery": "different"},
        {"keypointCount": None, "onView": False},
        {
            "similarity": 0.93,
            "runnerUpSimilarity": 0.89,
            "keypointCount": 79,
            "atVenue": True,
            "venueKnown": True,
        },
        {"keypointCount": 80, "orbInliers": 15, "homographyValid": True},
        {"keypointCount": 500, "orbInliers": 500, "objectPenalty": 0.8},
        {"keypointCount": 0.5, "orbInliers": 0.5, "onView": True},
        {"venueKnown": True, "orbInliers": 101, "runnerUpInliers": 17, "homographyValid": True},
        {"orbInliers": 6, "runnerUpInliers": 140, "keypointCount": 500},
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

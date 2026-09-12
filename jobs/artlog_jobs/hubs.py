import argparse
import json
from pathlib import Path

import numpy as np

from .features import Features, file_hash, read_jsonl, write_jsonl
from .sources.fetch import write_json

SEED = 20260908


def hub_scores(vectors: np.ndarray, *, sample_size=20000):
    size = min(len(vectors), sample_size)
    if size == 0:
        return (
            np.empty(0),
            np.empty(0, dtype=int),
            {
                "sampleSize": 0,
                "flaggedVectors": 0,
                "threshold": 0,
                "histogram": {"counts": [], "edges": []},
            },
        )
    sample = np.random.default_rng(SEED).choice(len(vectors), size, replace=False)
    # Mean of dot products equals dot product with the sample mean: no N × 20,000 matrix.
    centroid = vectors[sample].mean(axis=0, dtype=np.float64)
    means = np.empty(len(vectors))
    for start in range(0, len(vectors), 20000):
        means[start : start + 20000] = vectors[start : start + 20000] @ centroid
    threshold = float(means.mean() + 3 * means.std())
    candidates = np.flatnonzero(means > threshold)
    cap = int(len(vectors) * 0.005)
    flagged = candidates[np.argsort(-means[candidates], kind="stable")[:cap]]
    counts, edges = np.histogram(means, bins=30)
    return (
        means,
        flagged,
        {
            "seed": SEED,
            "sampleSize": size,
            "mean": float(means.mean()),
            "std": float(means.std()),
            "threshold": threshold,
            "flaggedVectors": len(flagged),
            "histogram": {"counts": counts.tolist(), "edges": edges.tolist()},
        },
    )


def run(features: Path, out: Path) -> dict:
    stats = json.loads((features / "stats.json").read_text())
    data = Features(features)
    rows = read_jsonl(features / "vector-index.jsonl")
    matrix = (
        np.stack([data.vectors[row["viewKey"]] for row in rows]) if rows else np.empty((0, 1536))
    )
    _, flagged, summary = hub_scores(matrix)
    hubs = {rows[i]["objectKey"] for i in flagged}
    objects = read_jsonl(features / "objects.jsonl")
    write_jsonl(
        out,
        (
            {"objectKey": row["key"], "calibratorPenalty": 0.5 if row["key"] in hubs else 0}
            for row in objects
        ),
    )
    summary["flaggedObjects"] = len(hubs)
    summary["inputFiles"] = stats["files"]
    summary["penaltiesSha256"] = file_hash(out)
    write_json(out.with_suffix(".summary.json"), summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Flag unusually central embedding vectors")
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    summary = run(args.features, args.out)
    print(json.dumps({k: v for k, v in summary.items() if k != "inputFiles"}))


if __name__ == "__main__":
    main()

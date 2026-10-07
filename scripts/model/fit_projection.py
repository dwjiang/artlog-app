"""Fit the PCA projection the export appends to the model, from an index build's summary vectors.

    uv run python fit_projection.py --features "$SCRATCH_DIR/merged" --out projection.npz

Reads every `vectors-*.npy` (L2-normalized SUMMARY_DIM floats) and writes the centering mean
and the SUMMARY_DIM × EMBEDDING_DIM matrix whose columns are the top principal components
divided by λ^(WHITEN_POWER / 2). Square-root whitening limits amplification of the phone's
int8/fp16 noise so the projected vectors can pass the drift gate.
"""

import argparse
import json
import sys
from hashlib import sha256
from pathlib import Path

import numpy as np

from export_coreml import EMBEDDING_DIM, PROJECTION, SUMMARY_DIM, WHITEN_POWER

CHUNK = 50_000


def fit(vectors: np.ndarray, dim: int = EMBEDDING_DIM, power: float = WHITEN_POWER):
    if vectors.ndim != 2 or vectors.shape[1] != SUMMARY_DIM or len(vectors) <= SUMMARY_DIM:
        raise ValueError(f"Expected more than {SUMMARY_DIM} vectors of {SUMMARY_DIM} floats, got {vectors.shape}")
    mean = vectors.mean(axis=0, dtype=np.float64)
    covariance = np.zeros((SUMMARY_DIM, SUMMARY_DIM))
    for start in range(0, len(vectors), CHUNK):
        centered = vectors[start : start + CHUNK].astype(np.float64) - mean
        covariance += centered.T @ centered
    values, components = np.linalg.eigh(covariance / (len(vectors) - 1))
    top = np.argsort(values)[::-1][:dim]
    # eigh leaves each component's sign arbitrary; fix it so refits are reproducible.
    signs = np.sign(components[np.abs(components[:, top]).argmax(axis=0), top])
    matrix = components[:, top] * signs / values[top] ** (power / 2)
    return mean.astype(np.float32), matrix.astype(np.float32), float(values[top].sum() / values.sum())


def load_vectors(features: Path) -> np.ndarray:
    shards = sorted(features.glob("vectors-*.npy"), key=lambda path: int(path.stem.split("-")[1]))
    if not shards:
        raise FileNotFoundError(f"No vectors-*.npy in {features}")
    return np.concatenate([np.load(path) for path in shards])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=PROJECTION)
    args = parser.parse_args(argv)
    vectors = load_vectors(args.features)
    mean, matrix, explained = fit(vectors)
    np.savez(args.out, mean=mean, matrix=matrix, whitenPower=np.float64(WHITEN_POWER))
    print(json.dumps({
        "vectors": len(vectors),
        "embeddingDim": matrix.shape[1],
        "whitenPower": WHITEN_POWER,
        "explainedVariance": round(explained, 4),
        "sha256": sha256(args.out.read_bytes()).hexdigest(),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

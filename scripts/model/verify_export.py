"""Compare vectors produced by the phone module (or its Mac harness) with the PyTorch fake-quant
reference computed on the same crop files.

    uv run python verify_export.py --embeddings /tmp/harness.json [--fakequant out/fakequant_state.pt] [--device mps]

`--embeddings` is the Mac harness output (`{"embeddings": {"<crop path>": [floats]}, ...}`) or a
plain `{"<crop path>": [floats]}` object; every crop path must exist locally. Prints the mean and
minimum cosine and exits non-zero below the drift thresholds (mean 0.99, minimum 0.97).
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from export_coreml import EMBEDDING_DIM, ROOT, build

MIN_MEAN_COSINE = 0.99
MIN_MIN_COSINE = 0.97


def reference_embeddings(paths, fakequant, device):
    model = build()
    model.load_state_dict(torch.load(fakequant, weights_only=True))
    model = model.to(device).half().eval()
    # Module.half() does not update RADIO's ordinary dtype attribute.
    model.radio.input_conditioner.dtype = torch.float16
    vectors = []
    with torch.inference_mode():
        for path in paths:
            pixels = np.asarray(Image.open(path).convert("RGB")).copy()
            tensor = torch.from_numpy(pixels).permute(2, 0, 1).unsqueeze(0).to(device=device, dtype=torch.float16) / 255
            vectors.append(model(tensor).float().cpu().numpy()[0])
    return np.asarray(vectors)


def normalized(vectors):
    values = np.asarray(vectors, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] != EMBEDDING_DIM or not np.isfinite(values).all():
        raise ValueError(f"Expected a finite matrix of {EMBEDDING_DIM}-float embeddings, got {values.shape}")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("Zero embedding")
    return values / norms


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--embeddings", type=Path, required=True)
    parser.add_argument("--fakequant", type=Path, default=ROOT / "out" / "fakequant_state.pt")
    parser.add_argument("--device", choices=("mps", "cuda", "cpu"), default="mps")
    args = parser.parse_args(argv)
    data = json.loads(args.embeddings.read_text())
    measured = data.get("embeddings", data)
    paths = sorted(measured)
    if not paths:
        raise SystemExit("No embeddings in the file")
    device_vectors = normalized([measured[path] for path in paths])
    reference = normalized(reference_embeddings(paths, args.fakequant, args.device))
    cosines = np.sum(device_vectors * reference, axis=1)
    worst = sorted(zip(cosines, paths))[:5]
    report = {
        "count": len(paths),
        "device": args.device,
        "meanCosine": round(float(cosines.mean()), 6),
        "minCosine": round(float(cosines.min()), 6),
        "worst": [{"cosine": round(float(c), 6), "path": p} for c, p in worst],
        "ok": bool(cosines.mean() >= MIN_MEAN_COSINE and cosines.min() >= MIN_MIN_COSINE),
    }
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

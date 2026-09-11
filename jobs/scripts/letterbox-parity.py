"""Compare a phone-produced letterbox PNG with the Python reference (plan 03.02).

    cd jobs && uv run python scripts/letterbox-parity.py --phone crop.png --source image.jpg --size 512

Exit status 0 when the mean absolute pixel difference is <= 2/255 and any padding matches within +-1.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from artlog_jobs.letterbox import letterbox

MAX_MEAN_ABS_DIFF = 2.0
MAX_PAD_DIFF = 1


def padding_mask(source: Image.Image, size: int) -> np.ndarray:
    width, height = source.size
    scale = size / max(width, height)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    left = (size - resized_width) // 2
    top = (size - resized_height) // 2
    padding = np.ones((size, size), dtype=bool)
    padding[top : top + resized_height, left : left + resized_width] = False
    return padding


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phone", required=True, type=Path, help="PNG letterbox produced by the phone"
    )
    parser.add_argument(
        "--source", required=True, type=Path, help="Source image both sides letterboxed"
    )
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args()

    source = Image.open(args.source)
    reference = np.asarray(letterbox(source, args.size), dtype=np.int16)
    phone = np.asarray(Image.open(args.phone).convert("RGB"), dtype=np.int16)
    if phone.shape != reference.shape:
        print(json.dumps({"ok": False, "reason": f"shape {phone.shape} != {reference.shape}"}))
        return 1

    diff = np.abs(phone - reference)
    padding = padding_mask(source, args.size)
    pad_reference = pad_phone = pad_diff = None
    if padding.any():
        padding_diff = diff[padding]
        worst_pixel = int(padding_diff.max(axis=1).argmax())
        pad_reference = reference[padding][worst_pixel].tolist()
        pad_phone = phone[padding][worst_pixel].tolist()
        pad_diff = int(padding_diff.max())
    result = {
        "meanAbsDiff": round(float(diff.mean()), 4),
        "maxAbsDiff": int(diff.max()),
        "pixelsOver2": round(float((diff.max(axis=2) > 2).mean()), 4),
        "padReference": pad_reference,
        "padPhone": pad_phone,
        "padDiff": pad_diff,
    }
    result["ok"] = result["meanAbsDiff"] <= MAX_MEAN_ABS_DIFF and (
        pad_diff is None or pad_diff <= MAX_PAD_DIFF
    )
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

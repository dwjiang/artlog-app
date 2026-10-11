"""Offline ORB robustness checks using the committed CC0 painting and synthetic negatives."""

import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from PIL import __version__ as pillow_version

from ..letterbox import letterbox
from ..model_version import INPUT_SIZE, MODEL_VERSION
from ..orb import extract_orb, to_gray
from .verify import verify

FIXTURE = Path(__file__).parents[2] / "fixtures/test-painting.jpg"
SEEDS = (7, 19, 41)


def _crop(image: Image.Image, area: float, rng: np.random.Generator) -> Image.Image:
    width, height = image.size
    crop_width = max(2, round(width * math.sqrt(area)))
    crop_height = max(2, round(height * math.sqrt(area)))
    left = int(rng.integers(0, width - crop_width + 1))
    top = int(rng.integers(0, height - crop_height + 1))
    return image.crop((left, top, left + crop_width, top + crop_height))


def _glare(image: Image.Image, opacity: float, rng: np.random.Generator) -> Image.Image:
    width, height = image.size
    cx, cy = rng.uniform(0.35, 0.65, 2) * [width, height]
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).ellipse(
        (cx - width * 0.45, cy - height * 0.45, cx + width * 0.45, cy + height * 0.45),
        fill=round(255 * opacity),
    )
    mask = mask.filter(ImageFilter.GaussianBlur(min(width, height) * 0.025))
    return Image.composite(Image.new("RGB", image.size, "white"), image, mask)


def cases(image: Image.Image, *, seed: int) -> list[tuple[str, bool, Image.Image]]:
    """Known crops retain the same composition; unknown inputs contain no artwork pixels."""
    rgb = image.convert("RGB")
    rng = np.random.default_rng(seed)
    result = [("clean", True, rgb)]
    for opacity in (0.45, 1.0):
        result.append((f"glare-{opacity:.2f}", True, _glare(rgb, opacity, rng)))
    for area in (0.75, 0.5, 0.25, 0.1):
        result.append((f"crop-area-{area:.2f}", True, _crop(rgb, area, rng)))
    result.append(("crop-glare", True, _glare(_crop(rgb, 0.25, rng), 1.0, rng)))
    noise = rng.integers(0, 256, (rgb.height, rgb.width, 3), dtype=np.uint8)
    result.append(("unknown-noise", False, Image.fromarray(noise)))
    result.append(("unknown-blank", False, Image.new("RGB", rgb.size, "white")))
    return result


def summarize(rows: list[dict], *, min_inliers: int = 15) -> dict:
    known = [row for row in rows if row["knownArtwork"]]
    unknown = [row for row in rows if not row["knownArtwork"]]

    def accepted(row):
        return row["homographyValid"] and row["orbInliers"] >= min_inliers

    verified = sum(accepted(row) for row in known)
    false_verified = sum(accepted(row) for row in unknown)
    return {
        "queries": len(rows),
        "knownQueries": len(known),
        "unknownQueries": len(unknown),
        "verifiedKnown": verified,
        "missedKnown": len(known) - verified,
        "falseVerifiedUnknown": false_verified,
        "knownVerificationRate": verified / len(known) if known else None,
        "unknownFalseVerificationRate": false_verified / len(unknown) if unknown else None,
    }


def evaluate(*, fixture: Path = FIXTURE, seeds: tuple[int, ...] = SEEDS) -> dict:
    if not seeds or len(set(seeds)) != len(seeds):
        raise ValueError("evaluation seeds must be nonempty and unique")
    with Image.open(fixture) as image:
        rgb = image.convert("RGB")
    reference = extract_orb(to_gray(letterbox(rgb, INPUT_SIZE)))
    rows = []
    for seed in seeds:
        for condition, known, image in cases(rgb, seed=seed):
            boxed = letterbox(image, INPUT_SIZE)
            query = extract_orb(to_gray(boxed))
            rows.append(
                {
                    "queryId": f"{seed}:{condition}",
                    "condition": condition,
                    "seed": seed,
                    "knownArtwork": known,
                    "pixelSha256": hashlib.sha256(boxed.tobytes()).hexdigest(),
                    "queryKeypoints": query.count,
                    **verify(query, reference, input_size=INPUT_SIZE),
                }
            )
    return {
        "workload": "single-CC0-reference synthetic ORB robustness",
        "limitations": [
            "One artwork with synthetic nuisances; unknowns are noise and blank images.",
            "Measures Python/OpenCV ORB verification, not embedding retrieval or confident matches.",
            "OpenCV RANSAC differs from the TypeScript runtime; this is not runtime parity.",
            "No independent camera photos, look-alike artworks, model inference, or accuracy estimate.",
        ],
        "provenance": {
            "fixtureSha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
            "modelVersion": MODEL_VERSION,
            "inputSize": INPUT_SIZE,
            "opencvVersion": cv2.__version__,
            "numpyVersion": np.__version__,
            "pillowVersion": pillow_version,
            "seeds": list(seeds),
            "referenceKeypoints": reference.count,
        },
        **summarize(rows),
        "byCondition": {
            condition: summarize([row for row in rows if row["condition"] == condition])
            for condition in dict.fromkeys(row["condition"] for row in rows)
        },
        "inlierSweep": [
            {"minInliers": minimum, **summarize(rows, min_inliers=minimum)}
            for minimum in (15, 30, 50)
        ],
        "rows": rows,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    report = json.dumps(evaluate(), indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report)
    else:
        print(report, end="")


if __name__ == "__main__":
    main()

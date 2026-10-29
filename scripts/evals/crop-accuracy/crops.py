"""Crops every ground-truth photo the way the app does, then snaps each crop to its reference as a verified match would.

Writes predictions.jsonl: one row per photo and capture method with the app's crop and the snapped crop (null when the
match did not verify or the snap was rejected).

uv run python crops.py --photos <photo set dir> --out <eval dir> --harness <vision-rect harness>
"""

import argparse
import base64
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[3]
APP_CROPS = Path(__file__).with_name("app-crops.mts")
MODEL = json.loads((REPO / "shared/model/model-version.json").read_text())
BATCH = 50


def orb(png: Path) -> dict:
    """The phone's and the corpus pipeline's ORB on a letterboxed square, in the wire format of shared/orb/features.ts."""
    image = cv2.imread(str(png), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"cannot read {png}")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    keypoints, descriptors = cv2.ORB_create(nfeatures=MODEL["orbMaxKeypoints"]).detectAndCompute(gray, None)
    if descriptors is None:
        return {"descriptors": "", "keypoints": ""}
    keypoints, descriptors = keypoints[: MODEL["orbMaxKeypoints"]], descriptors[: MODEL["orbMaxKeypoints"]]
    packed = np.array([[k.pt[0], k.pt[1], k.size, k.angle] for k in keypoints], dtype="<f4").tobytes()
    return {
        "descriptors": base64.b64encode(descriptors.tobytes()).decode(),
        "keypoints": base64.b64encode(packed).decode(),
    }


def letterbox(harness: str, image: Path, out: Path, quad=None) -> dict:
    args = [harness, "letterbox", str(image), str(MODEL["inputSize"]), str(out)]
    if quad:
        args += ["--quad", ",".join(f"{v:.6f}" for corner in quad for v in corner)]
    return json.loads(subprocess.run(args, capture_output=True, text=True, check=True).stdout)


def app_crops(mode: str, lines: list[str]) -> list[dict]:
    output = subprocess.run(
        ["npx", "tsx", str(APP_CROPS), mode], input="\n".join(lines), capture_output=True, text=True, check=True, cwd=REPO
    ).stdout
    return [json.loads(line) for line in output.splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", type=Path, required=True, help="directory with photos/")
    parser.add_argument("--out", type=Path, required=True, help="eval directory with truth.jsonl")
    parser.add_argument("--harness", required=True, help="compiled modules/vision-rect/scripts/mac-harness.swift")
    args = parser.parse_args()

    truth = [row for row in map(json.loads, (args.out / "truth.jsonl").open()) if row["usable"]]
    references = {row["name"]: row for row in map(json.loads, (args.out / "references.jsonl").open())}
    work = args.out / "work"
    work.mkdir(exist_ok=True)
    reference_features: dict[str, dict] = {}
    with (args.out / "predictions.jsonl").open("w") as predictions:
        for start in range(0, len(truth), BATCH):
            batch = truth[start : start + BATCH]
            analysis = subprocess.run(
                [args.harness, "analyze", *(str(args.photos / "photos" / row["photo"]) for row in batch)],
                capture_output=True, text=True, check=True,
            ).stdout.splitlines()
            chosen = app_crops("select", analysis)
            by_photo = {row["photo"]: row for row in batch}
            snap_inputs = []
            for crop in chosen:
                if not crop["quad"]:
                    continue
                reference = references[by_photo[crop["photo"]]["reference"]]
                if reference["name"] not in reference_features:
                    png = work / f"reference-{Path(reference['path']).stem}.png"
                    letterbox(args.harness, args.out / "references" / reference["path"], png)
                    reference_features[reference["name"]] = orb(png)
                png = work / f"{Path(crop['photo']).stem}-{crop['method']}.png"
                warped = letterbox(args.harness, args.photos / "photos" / crop["photo"], png, crop["quad"])
                snap_inputs.append(json.dumps({
                    "photo": crop["photo"],
                    "method": crop["method"],
                    "cropCorners": warped["usedQuad"],
                    "contentBounds": warped["contentBounds"],
                    "referenceSize": {"width": reference["width"], "height": reference["height"]},
                    "query": orb(png),
                    "reference": reference_features[reference["name"]],
                }))
            snapped = {(row["photo"], row["method"]): row for row in app_crops("snap", snap_inputs)}
            for crop in chosen:
                result = snapped.get((crop["photo"], crop["method"]), {})
                predictions.write(json.dumps({
                    **crop, "inliers": result.get("inliers", 0), "verified": result.get("verified", False),
                    "snapped": result.get("quad"),
                }) + "\n")
            print(f"{min(start + BATCH, len(truth))}/{len(truth)}", flush=True)


if __name__ == "__main__":
    main()

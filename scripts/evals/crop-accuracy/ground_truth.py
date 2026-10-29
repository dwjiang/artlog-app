"""Locates each reference image in its photo: SIFT matches at full photo resolution, a MAGSAC homography, and the
reference's corners projected into the photo. Independent of the app's 512 px ORB, so it can score a crop snapped
to the ORB match.

uv run python ground_truth.py --photos <photo set dir> --out <eval dir>
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from geometry import is_convex, quad_area

RATIO = 0.75
REPROJECTION_PX = 3.0
MIN_INLIERS = 60
# Inliers must span this share of the reference, so projected corners are not extrapolated from one patch.
MIN_INLIER_HULL = 0.3
# Reference corners this far outside the photo, normalized, mean the painting runs off it.
OFF_PHOTO_TOLERANCE = 0.005


def gray(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"cannot read {path}")
    return image


def locate(sift: cv2.SIFT, photo: np.ndarray, reference: np.ndarray) -> dict | None:
    photo_points, photo_descriptors = sift.detectAndCompute(photo, None)
    reference_points, reference_descriptors = sift.detectAndCompute(reference, None)
    if photo_descriptors is None or reference_descriptors is None or len(photo_points) < 8:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(reference_descriptors, photo_descriptors, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < RATIO * pair[1].distance]
    if len(good) < MIN_INLIERS:
        return None
    source = np.float32([reference_points[m.queryIdx].pt for m in good])
    target = np.float32([photo_points[m.trainIdx].pt for m in good])
    homography, mask = cv2.findHomography(source, target, cv2.USAC_MAGSAC, REPROJECTION_PX, maxIters=10000, confidence=0.9999)
    if homography is None:
        return None
    inliers = mask.ravel().astype(bool)
    height, width = reference.shape
    hull = cv2.convexHull(source[inliers]) if inliers.sum() >= 3 else None
    hull_share = cv2.contourArea(hull) / (width * height) if hull is not None else 0.0
    corners = np.float32([[0, 0], [width, 0], [width, height], [0, height]]).reshape(-1, 1, 2)
    projected = cv2.perspectiveTransform(corners, homography).reshape(-1, 2)
    photo_height, photo_width = photo.shape
    quad = [[float(x / photo_width), float(y / photo_height)] for x, y in projected]
    return {"inliers": int(inliers.sum()), "inlierHull": round(float(hull_share), 3), "quad": quad}


def is_truth(found: dict | None) -> bool:
    return (
        found is not None
        and found["inliers"] >= MIN_INLIERS
        and found["inlierHull"] >= MIN_INLIER_HULL
        and is_convex(found["quad"])
        and quad_area(found["quad"]) >= 0.01
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", type=Path, required=True, help="directory with photos.jsonl and photos/")
    parser.add_argument("--out", type=Path, required=True, help="eval directory with references.jsonl")
    args = parser.parse_args()

    references = {
        row["name"]: row for row in map(json.loads, (args.out / "references.jsonl").open()) if row
    }
    sift = cv2.SIFT_create(nfeatures=8000)
    truth_path = args.out / "truth.jsonl"
    done = {json.loads(line)["photo"] for line in truth_path.open()} if truth_path.exists() else set()
    rows = [json.loads(line) for line in (args.photos / "photos.jsonl").open() if line.strip()]
    with truth_path.open("a") as out:
        for index, row in enumerate(rows):
            if row["photo"] in done:
                continue
            photo = gray(args.photos / "photos" / row["photo"])
            best = None
            for name in row["referenceFiles"]:
                reference = references.get(name)
                if reference is None:
                    continue
                found = locate(sift, photo, gray(args.out / "references" / reference["path"]))
                if found and (best is None or found["inliers"] > best["inliers"]):
                    best = {**found, "reference": name}
            record = {"photo": row["photo"], "usable": is_truth(best), **(best or {})}
            if record["usable"]:
                record["whole"] = all(
                    -OFF_PHOTO_TOLERANCE <= v <= 1 + OFF_PHOTO_TOLERANCE for corner in best["quad"] for v in corner
                )
            out.write(json.dumps(record) + "\n")
            out.flush()
            if index % 50 == 0:
                print(f"{index}/{len(rows)}", flush=True)


if __name__ == "__main__":
    main()

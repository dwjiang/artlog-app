"""Quad geometry in normalized photo coordinates; corners run top-left, top-right, bottom-right, bottom-left."""

import cv2
import numpy as np

Quad = list[list[float]]

# Share of the painting a crop must keep, and share of the crop that must be painting, to count as accurate.
ACCURATE = 0.9


def quad_area(quad: Quad) -> float:
    twice = sum(quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1] for i in range(4))
    return abs(twice) / 2


def is_convex(quad: Quad) -> bool:
    crosses = []
    for i in range(4):
        a, b, c = quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]
        crosses.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    return all(cross > 0 for cross in crosses) or all(cross < 0 for cross in crosses)


def intersection_area(a: Quad, b: Quad) -> float:
    area, _ = cv2.intersectConvexConvex(np.float32(a), np.float32(b))
    return float(area)


def score(crop: Quad, truth: Quad) -> dict:
    # Area ratios are the same in normalized and pixel units, so the photo's aspect does not matter.
    overlap = intersection_area(crop, truth)
    crop_area, truth_area = quad_area(crop), quad_area(truth)
    kept = overlap / truth_area if truth_area else 0.0
    precision = overlap / crop_area if crop_area else 0.0
    iou = overlap / (crop_area + truth_area - overlap) if crop_area + truth_area - overlap else 0.0
    if kept >= ACCURATE and precision >= ACCURATE:
        verdict = "accurate"
    elif kept >= ACCURATE:
        verdict = "too loose"
    elif precision >= ACCURATE:
        verdict = "too tight"
    else:
        verdict = "off"
    return {"iou": iou, "kept": kept, "precision": precision, "verdict": verdict}

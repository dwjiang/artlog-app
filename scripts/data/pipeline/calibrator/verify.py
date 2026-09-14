"""OpenCV verifier with the matching parameters and quad rules in shared/orb."""

import cv2
import numpy as np

from ..orb import OrbFeatures


def is_sane_quad(matrix: np.ndarray, input_size: int) -> bool:
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:2, :2])) <= 1e-6:
        return False
    square = np.array(
        [[0, 0, 1], [input_size, 0, 1], [input_size, input_size, 1], [0, input_size, 1]]
    )
    projected = square @ matrix.T
    if (np.abs(projected[:, 2]) < 1e-9).any():
        return False
    corners = projected[:, :2] / projected[:, 2:]
    if not np.isfinite(corners).all():
        return False
    twice_area = 0.0
    for i in range(4):
        a, b, c = corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]
        turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if turn <= 0:
            return False
        twice_area += a[0] * b[1] - b[0] * a[1]
    return bool(0.05 <= twice_area / 2 / input_size**2 <= 20)


def verify(query: OrbFeatures, reference: OrbFeatures, *, input_size: int) -> dict:
    empty = {"orbInliers": 0, "homographyValid": False}
    if min(query.count, reference.count) < 4:
        return empty
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
        query.descriptor_array(), reference.descriptor_array(), k=2
    )
    good = sorted(
        [a for a, b in matches if a.distance <= 64 and a.distance < 0.8 * b.distance],
        key=lambda match: match.distance,
    )
    if len(good) < 4:
        return empty
    source = np.float32([reference.keypoint_array()[m.trainIdx, :2] for m in good])
    target = np.float32([query.keypoint_array()[m.queryIdx, :2] for m in good])
    # Reference → query, matching the TypeScript projected-corner convention.
    cv2.setRNGSeed(1)
    matrix, mask = cv2.findHomography(
        source, target, cv2.RANSAC, 5.0, maxIters=1000, confidence=0.995
    )
    if matrix is None or mask is None:
        return empty
    inliers = int(mask.sum())
    return {
        "orbInliers": inliers,
        "homographyValid": inliers >= 15 and is_sane_quad(matrix, input_size),
    }

from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from ..letterbox import letterbox
from ..orb import OrbFeatures, extract_orb, to_gray
from .verify import is_sane_quad, verify


@pytest.mark.parametrize(
    "matrix,expected",
    [
        (np.eye(3), True),
        (np.array([[0, 0, 500], [0, -1, 512], [0.001, 0, 1]]), True),
        (np.diag([-1, 1, 1]), False),
        (np.diag([0.01, 0.01, 1]), False),
        (np.diag([5, 5, 1]), False),
        (np.zeros((3, 3)), False),
        (np.array([[1, 0, 0], [0, 1, 0], [-1 / 512, 0, 1]]), False),
    ],
)
def test_quad_sanity_rules(matrix, expected):
    assert is_sane_quad(matrix, 512) == expected


def test_real_descriptors_verify_a_perspective_warp_but_not_an_unrelated_image():
    with Image.open(Path(__file__).parents[2] / "fixtures/test-painting.jpg") as image:
        gray = to_gray(letterbox(image, 512))
    reference = extract_orb(gray)
    matrix = np.array([[0.85, 0.03, 20], [0.02, 0.9, 12], [0.0001, 0.00005, 1]])
    query = extract_orb(cv2.warpPerspective(gray, matrix, (512, 512)))
    result = verify(query, reference, input_size=512)
    assert result["homographyValid"]
    assert result["orbInliers"] >= 15
    assert result == verify(query, reference, input_size=512)
    random = extract_orb(np.random.default_rng(3).integers(0, 256, (512, 512), dtype=np.uint8))
    assert not verify(random, reference, input_size=512)["homographyValid"]
    assert verify(OrbFeatures(b"", b"", 0), reference, input_size=512) == {
        "orbInliers": 0,
        "homographyValid": False,
    }

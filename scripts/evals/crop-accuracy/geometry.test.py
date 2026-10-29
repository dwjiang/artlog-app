import pytest

from geometry import is_convex, quad_area, score

PAINTING = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]


def box(left: float, top: float, right: float, bottom: float) -> list[list[float]]:
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


def test_area_and_convexity():
    assert quad_area(PAINTING) == pytest.approx(0.36)
    assert is_convex(PAINTING)
    assert not is_convex([[0.2, 0.2], [0.8, 0.8], [0.8, 0.2], [0.2, 0.8]])


def test_exact_crop_is_accurate():
    assert score(PAINTING, PAINTING) == pytest.approx(
        {"iou": 1.0, "kept": 1.0, "precision": 1.0, "verdict": "accurate"}
    )


def test_frame_included_is_too_loose():
    result = score(box(0.1, 0.1, 0.9, 0.9), PAINTING)
    assert result["verdict"] == "too loose"
    assert result["kept"] == pytest.approx(1.0)


def test_detail_is_too_tight():
    result = score(box(0.3, 0.3, 0.7, 0.7), PAINTING)
    assert result["verdict"] == "too tight"
    assert result["precision"] == pytest.approx(1.0)


def test_shifted_crop_is_off():
    assert score(box(0.5, 0.5, 1.0, 1.0), PAINTING)["verdict"] == "off"

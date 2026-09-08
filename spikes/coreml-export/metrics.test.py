import numpy as np
import pytest
from PIL import Image

from calibration import letterbox
from drift_check import agreement, cosine, normalized


def test_cosine_is_scale_invariant_and_reports_worst_image():
    result = cosine([[1, 0], [1, 0]], [[10, 0], [0, 2]])
    assert result == {"mean": 0.5, "min": 0.0, "count": 2}


@pytest.mark.parametrize("vectors", [[[0, 0]], [[float("nan"), 1]], [[float("inf"), 1]], [1, 2]])
def test_invalid_embeddings_cannot_pass_drift(vectors):
    with pytest.raises(ValueError):
        normalized(vectors)


def test_retrieval_measures_changed_neighbors_on_the_same_index():
    assert agreement([[1, 0], [0, 1]], [[1, 0], [1, 0]], [[1, 0], [0, 1]]) == 50


def test_mismatched_batches_are_rejected():
    with pytest.raises(ValueError):
        cosine([[1, 0]], [[1, 0], [0, 1]])


def test_letterbox_preserves_rgb_and_uses_centered_black_padding():
    image = letterbox(Image.new("RGB", (4, 2), (255, 12, 7)), 8)
    pixels = np.asarray(image)
    assert image.size == (8, 8)
    assert np.all(pixels[:2] == 0) and np.all(pixels[6:] == 0)
    assert np.all(pixels[2:6] == [255, 12, 7])

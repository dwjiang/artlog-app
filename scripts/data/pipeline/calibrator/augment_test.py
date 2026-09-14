import numpy as np
from PIL import Image

from .augment import augment


def test_four_repeatable_distinct_rgb_variants_without_mutating_the_original():
    pixels = np.random.default_rng(2).integers(30, 220, (240, 320, 3), dtype=np.uint8)
    image = Image.fromarray(pixels)
    first = augment(image, seed=42)
    second = augment(image, seed=42)
    other = augment(image, seed=43)
    assert list(first) == ["perspective", "glare", "low-light", "frame"]
    for name, variant in first.items():
        assert variant.mode == "RGB"
        assert min(variant.size) > 0
        np.testing.assert_array_equal(np.asarray(variant), np.asarray(second[name]))
        assert variant.tobytes() != other[name].tobytes()
        assert variant.tobytes() != image.tobytes()
    assert np.asarray(first["low-light"]).mean() < pixels.mean()
    assert np.asarray(first["glare"]).mean() > pixels.mean()
    assert first["frame"].width > image.width
    np.testing.assert_array_equal(np.asarray(image), pixels)

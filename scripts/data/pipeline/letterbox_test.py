import numpy as np
from PIL import Image

from pipeline.letterbox import letterbox


def gradient(width: int, height: int) -> Image.Image:
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    pixels[..., 0] = np.linspace(0, 255, width, dtype=np.uint8)[None, :]
    pixels[..., 1] = 40
    pixels[..., 2] = np.linspace(255, 0, height, dtype=np.uint8)[:, None]
    return Image.fromarray(pixels)


def test_output_is_a_square_of_the_requested_size():
    for width, height in ((300, 100), (100, 300), (512, 512), (7, 3)):
        assert letterbox(gradient(width, height), 64).size == (64, 64)
    assert letterbox(gradient(300, 100), 512).mode == "RGB"


def test_wide_input_is_centered_and_padded_with_the_mean_color():
    out = np.asarray(letterbox(gradient(300, 100), 60))
    scaled = np.asarray(gradient(300, 100).resize((60, 20), Image.Resampling.BILINEAR))
    mean = tuple(int(c + 0.5) for c in scaled.reshape(-1, 3).mean(axis=0))

    assert (out[:20] == mean).all() and (out[40:] == mean).all()
    assert np.array_equal(out[20:40], scaled)


def test_tall_input_pads_the_columns():
    out = np.asarray(letterbox(gradient(100, 300), 60))
    scaled = np.asarray(gradient(100, 300).resize((20, 60), Image.Resampling.BILINEAR))
    mean = tuple(int(c + 0.5) for c in scaled.reshape(-1, 3).mean(axis=0))

    assert (out[:, :20] == mean).all() and (out[:, 40:] == mean).all()
    assert np.array_equal(out[:, 20:40], scaled)


def test_non_rgb_inputs_are_converted():
    gray = Image.fromarray(np.full((30, 90), 120, dtype=np.uint8))
    rgba = gradient(90, 30).convert("RGBA")
    assert letterbox(gray, 32).mode == "RGB"
    assert np.asarray(letterbox(gray, 32)).min() == 120
    assert letterbox(rgba, 32).mode == "RGB"

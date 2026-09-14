import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from pipeline.letterbox import letterbox

SIZE = 64


def painting(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), "red")
    image.paste("blue", (0, height // 2, width, height))
    return image


def compare(source: Image.Image, phone: Image.Image, tmp_path: Path) -> tuple[int, dict]:
    source_path = tmp_path / "source.png"
    phone_path = tmp_path / "phone.png"
    source.save(source_path)
    phone.save(phone_path)
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("letterbox-parity.py")),
            "--source",
            str(source_path),
            "--phone",
            str(phone_path),
            "--size",
            str(SIZE),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, json.loads(result.stdout)


@pytest.mark.parametrize(
    ("dimensions", "pad_diff"),
    [
        ((32, 32), None),
        ((128, 127), None),
        ((127, 128), None),
        ((65, 64), 0),
        ((64, 65), 0),
        ((96, 32), 0),
        ((32, 96), 0),
    ],
)
def test_accepts_identical_reference_with_or_without_padding(dimensions, pad_diff, tmp_path):
    source = painting(*dimensions)
    status, report = compare(source, letterbox(source, SIZE), tmp_path)

    assert status == 0
    assert report["ok"] is True
    assert report["meanAbsDiff"] == 0
    assert report["padDiff"] == pad_diff
    if pad_diff is None:
        assert report["padReference"] is None
        assert report["padPhone"] is None


@pytest.mark.parametrize("dimensions", [(65, 64), (64, 65), (96, 32), (32, 96)])
def test_rejects_wrong_padding_even_when_overall_pixel_difference_is_small(dimensions, tmp_path):
    source = painting(*dimensions)
    phone = letterbox(source, SIZE)
    red, green, blue = phone.getpixel((SIZE - 1, SIZE - 1))
    phone.putpixel((SIZE - 1, SIZE - 1), (red, green + 4, blue))
    status, report = compare(source, phone, tmp_path)

    assert status == 1
    assert report["ok"] is False
    assert report["meanAbsDiff"] < 2
    assert report["padDiff"] == 4


def test_rejects_artwork_pixel_differences_without_padding(tmp_path):
    source = painting(32, 32)
    status, report = compare(source, Image.new("RGB", (SIZE, SIZE), "black"), tmp_path)

    assert status == 1
    assert report["ok"] is False
    assert report["meanAbsDiff"] > 2

import hashlib
import json
from io import BytesIO

import httpx
import numpy as np
import pytest
from PIL import Image

from artlog_jobs.drift_check import (
    CALIBRATION_DIR,
    check_with_fallback,
    compare,
    fetch_calibration_images,
    format_report,
    reference_letterbox,
)
from artlog_jobs.model import NonFiniteEmbedding
from artlog_jobs.model_version import EMBEDDING_DIM
from artlog_jobs.polite_http import PoliteClient

URLS = [f"https://images.example/{i}.jpg" for i in range(6)]


def unit_vectors(seed: int, count: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    vectors = rng.standard_normal((count, EMBEDDING_DIM))
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def test_identical_embeddings_pass_and_scaling_does_not_matter():
    job = unit_vectors(1, 6)
    result = compare(job, job * 37.5, URLS)
    assert result["passed"] and result["mean"] == pytest.approx(1.0)
    assert result["min"] == pytest.approx(1.0) and result["count"] == 6
    assert len(result["worst"]) == 5


def test_one_drifted_vector_fails_the_minimum_and_tops_the_worst_table():
    job = unit_vectors(2, 6)
    reference = job.copy()
    reference[3] = unit_vectors(9, 1)[0]

    result = compare(job, reference, URLS)

    assert not result["passed"] and result["min"] < 0.5 and result["mean"] < 0.99
    assert result["worst"][0]["url"] == URLS[3]
    assert compare(job, reference, URLS, min_mean=0.5, min_min=-1.0)["passed"]
    assert "FAIL" in format_report({**result, "device": "mps", "dtype": "float16"})


def test_misaligned_or_invalid_inputs_are_rejected():
    job = unit_vectors(3, 6)
    with pytest.raises(ValueError):
        compare(job, job[:5], URLS)
    with pytest.raises(ValueError):
        compare(job, job, URLS[:5])
    with pytest.raises(ValueError):
        compare(job, np.zeros_like(job), URLS)


def test_reference_letterbox_reproduces_the_spike_pixels():
    image = Image.fromarray(np.full((100, 300, 3), 200, dtype=np.uint8))
    boxed = np.asarray(reference_letterbox(image, 60))
    assert boxed.shape == (60, 60, 3)
    assert (boxed[:20] == 0).all() and (boxed[40:] == 0).all()
    assert (boxed[20:40] == 200).all()


def test_calibration_images_are_cached_and_hash_checked(tmp_path):
    data = BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(data, "JPEG")
    body = data.getvalue()
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, content=body)

    client = PoliteClient(
        user_agent="t", per_host_rps=1000, robots=False, transport=httpx.MockTransport(handler)
    )
    hashes = {URLS[0]: hashlib.sha256(body).hexdigest()}

    first = fetch_calibration_images(URLS[:1], tmp_path, hashes, client)
    second = fetch_calibration_images(URLS[:1], tmp_path, hashes, client)

    assert first == second and first[0].exists() and calls == ["/0.jpg"]
    with pytest.raises(ValueError, match="changed upstream"):
        fetch_calibration_images(URLS[:1], tmp_path, {URLS[0]: "0" * 64}, client)
    assert not first[0].exists()


class Stub:
    def __init__(self, dtype_name, vectors=None):
        self.device = "mps"
        self.dtype_name = dtype_name
        self.vectors = vectors

    def embed(self, batch):
        if self.vectors is None:
            raise NonFiniteEmbedding("nan")
        return self.vectors[: len(batch)]


def test_fp32_is_tried_when_fp16_is_non_finite(tmp_path):
    paths = []
    for index in range(2):
        path = tmp_path / f"{index}.png"
        Image.new("RGB", (4, 4), (index, 0, 0)).save(path)
        paths.append(path)
    vectors = unit_vectors(4, 2).astype(np.float32)
    reference = {URLS[i]: vectors[i].tolist() for i in range(2)}
    loads = []

    def load(dtype):
        loads.append(dtype)
        return Stub(dtype, None if dtype == "float16" else vectors)

    result = check_with_fallback(
        load, dtypes=("float16", "float32"), urls=URLS[:2], reference=reference, paths=paths
    )

    assert loads == ["float16", "float32"]
    assert result["passed"] and result["dtype"] == "float32"
    assert result["attempts"][0] == {"dtype": "float16", "error": "nan"}
    assert result["attempts"][1]["dtype"] == "float32"

    failed = check_with_fallback(
        lambda dtype: Stub(dtype),
        dtypes=("float16",),
        urls=URLS[:2],
        reference=reference,
        paths=paths,
    )
    assert failed == {"passed": False, "attempts": [{"dtype": "float16", "error": "nan"}]}


def test_committed_calibration_set_is_consistent():
    urls = (CALIBRATION_DIR / "urls.txt").read_text().splitlines()
    hashes = json.loads((CALIBRATION_DIR / "image-hashes.json").read_text())
    reference = json.loads((CALIBRATION_DIR / "iphone-embeddings.json").read_text())
    report = json.loads((CALIBRATION_DIR / "iphone-report.json").read_text())

    assert len(urls) == 200 and len(set(urls)) == 200
    assert set(hashes) == set(urls) == set(reference)
    assert all(len(vector) == EMBEDDING_DIM for vector in reference.values())
    assert report["size"] == 512 and report["compute_units"] == "cpuAndNeuralEngine"

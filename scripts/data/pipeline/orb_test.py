import json

import numpy as np
import pytest
from PIL import Image

from pipeline.model_version import INPUT_SIZE, ORB_MAX_KEYPOINTS, REPO_ROOT
from pipeline.orb import (
    DESCRIPTOR_BYTES,
    KEYPOINT_BYTES,
    OrbFeatures,
    extract_from_image,
    extract_orb,
    from_fixture,
    to_fixture,
)

FIXTURE_IMAGE = REPO_ROOT / "scripts" / "data" / "fixtures" / "test-painting.jpg"
FIXTURE_JSON = REPO_ROOT / "shared" / "orb" / "fixtures" / "orb-features-v1.json"


def test_features_from_the_test_painting_follow_the_wire_format():
    features = extract_from_image(Image.open(FIXTURE_IMAGE))

    assert 0 < features.count <= ORB_MAX_KEYPOINTS
    assert len(features.descriptors) == features.count * DESCRIPTOR_BYTES
    assert len(features.keypoints) == features.count * KEYPOINT_BYTES
    points = features.keypoint_array()
    assert points.shape == (features.count, 4)
    assert (points[:, :2] >= 0).all() and (points[:, :2] < INPUT_SIZE).all()
    assert (points[:, 2] > 0).all()
    assert (points[:, 3] >= 0).all() and (points[:, 3] < 360).all()
    assert features.descriptor_array().shape == (features.count, DESCRIPTOR_BYTES)


def test_keypoints_are_packed_little_endian_float32():
    features = extract_from_image(Image.open(FIXTURE_IMAGE))
    first = np.frombuffer(features.keypoints[:KEYPOINT_BYTES], dtype="<f4")
    assert np.array_equal(first, features.keypoint_array()[0])


def test_fixture_json_round_trips():
    features = extract_from_image(Image.open(FIXTURE_IMAGE))
    fixture = json.loads(json.dumps(to_fixture(features, INPUT_SIZE)))
    assert fixture["count"] == features.count
    assert fixture["inputSize"] == INPUT_SIZE
    assert from_fixture(fixture) == features


def test_committed_fixture_matches_a_fresh_extraction():
    fixture = json.loads(FIXTURE_JSON.read_text())
    assert from_fixture(fixture) == extract_from_image(Image.open(FIXTURE_IMAGE))


def test_blank_image_yields_no_features():
    blank = np.zeros((INPUT_SIZE, INPUT_SIZE), dtype=np.uint8)
    assert extract_orb(blank) == OrbFeatures(b"", b"", 0)


def test_rejects_inputs_outside_the_contract():
    with pytest.raises(ValueError):
        extract_orb(np.zeros((64, 32), dtype=np.uint8))
    with pytest.raises(ValueError):
        extract_orb(np.zeros((64, 64), dtype=np.float32))
    with pytest.raises(ValueError):
        extract_orb(np.zeros((64, 64), dtype=np.uint8), nfeatures=1001)
    with pytest.raises(ValueError):
        from_fixture({"count": 2, "descriptorsBase64": "", "keypointsBase64": ""})

import json
from pathlib import Path

import numpy as np
import pytest

from .features import FEATURE_NAMES, featurize, top_candidates


def signals(**overrides):
    return {
        "similarity": 0.9,
        "runnerUpSimilarity": 0.8,
        "candidateCount": 32,
        "atVenue": True,
        "gallery": "unknown",
        "onView": None,
        "keypointCount": 300,
        "orbInliers": 40,
        "homographyValid": True,
        "objectPenalty": 0,
        **overrides,
    }


def test_transforms_clamps_and_unknowns_follow_typescript():
    result = featurize(
        signals(similarity=1.4, runnerUpSimilarity=0.9, keypointCount=None, objectPenalty=-2)
    )
    np.testing.assert_allclose(result, [1, 0.1, np.log1p(32), 1, 0, 0, 0, 0, np.log1p(40), 1, 0])
    assert featurize(signals(similarity=0.7))[1] == 0
    assert featurize(signals(gallery="same", onView=True))[4:7].tolist() == [1, 0, 1]
    assert featurize(signals(gallery="different"))[5] == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("similarity", np.nan),
        ("runnerUpSimilarity", np.inf),
        ("candidateCount", -1),
        ("keypointCount", -1),
        ("orbInliers", -1),
        ("objectPenalty", -np.inf),
    ],
)
def test_rejects_invalid_numbers(field, value):
    with pytest.raises(ValueError):
        featurize(signals(**{field: value}))


def test_retrieval_caps_vector_hits_before_collapsing_multiple_views():
    vectors = np.array([[1, 0], [1, 0], [0.8, 0.6], [0, 1]], dtype=np.float32)
    found = top_candidates(vectors, ["a", "a", "b", "c"], np.array([1, 0]), limit=3)
    assert [object_id for object_id, _ in found] == ["a", "b"]
    assert found[1][1] == pytest.approx(0.8)


def test_candidate_signals_match_the_twenty_object_and_ten_verification_budgets(monkeypatch):
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample_test import make_index

    index = make_index(40)
    calls = []

    def verify(query, reference, **kwargs):
        calls.append(reference)
        return {"orbInliers": 20, "homographyValid": True}

    monkeypatch.setattr("artlog_jobs.calibrator.features.verify", verify)
    del index.descriptors["0"]
    index.objects["1"]["objectPenalty"] = 0.6
    rows = candidate_rows(
        index,
        index.vectors[0],
        OrbFeatures(b"", b"", 0),
        source_object_id="1",
        query_id="one",
        rng=np.random.default_rng(8),
    )
    assert len(rows) == 20
    assert len(calls) == 10
    assert rows[0]["signals"]["keypointCount"] is None
    assert rows[1]["label"] == 1
    assert rows[1]["signals"]["objectPenalty"] == 0.6
    assert all(row["signals"]["candidateCount"] == 20 for row in rows)
    assert all(row["features"][1] == 0 for row in rows)
    assert not rows[11]["signals"]["homographyValid"]
    assert all(
        row["signals"]["gallery"] == "unknown" for row in rows if not row["signals"]["atVenue"]
    )


def test_committed_fixture_is_python_output():
    path = Path(__file__).parents[3] / "shared/fixtures/calibrator-features.json"
    rows = json.loads(path.read_text())
    assert len(rows) == 10
    for row in rows:
        np.testing.assert_allclose(featurize(row["signals"]), row["expectedFeatures"], atol=1e-12)
        assert len(row["expectedFeatures"]) == len(FEATURE_NAMES)

import json

import numpy as np
import pytest

from ..model_version import REPO_ROOT
from .features import FEATURE_NAMES, featurize, top_candidates


def signals(**overrides):
    return {
        "similarity": 0.9,
        "runnerUpSimilarity": 0.8,
        "atVenue": True,
        "venueKnown": True,
        "gallery": "unknown",
        "onView": None,
        "keypointCount": 300,
        "orbInliers": 40,
        "homographyValid": True,
        "runnerUpInliers": 0,
        "objectPenalty": 0,
        **overrides,
    }


def test_transforms_clamps_and_unknowns_follow_typescript():
    result = featurize(
        signals(similarity=1.4, runnerUpSimilarity=0.9, keypointCount=None, objectPenalty=-2)
    )
    np.testing.assert_allclose(result, [1, 0.1, 1, 0, 0, 0, 0, np.log1p(40), 1, 0, 1, np.log1p(40)])
    lead = featurize(signals(orbInliers=6, runnerUpInliers=140, venueKnown=False))[-2:]
    np.testing.assert_allclose(lead, [0, np.log1p(6) - np.log1p(140)])
    assert featurize(signals(similarity=0.7))[1] == 0
    assert featurize(signals(gallery="same", onView=True))[3:6].tolist() == [1, 0, 1]
    assert featurize(signals(gallery="different"))[4] == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("similarity", np.nan),
        ("runnerUpSimilarity", np.inf),
        ("keypointCount", -1),
        ("orbInliers", -1),
        ("runnerUpInliers", -1),
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
        calls.append(query)
        return {"orbInliers": 20, "homographyValid": True}

    monkeypatch.setattr("pipeline.calibrator.features.verify", verify)
    del index.descriptors["0"]
    index.objects["1"]["objectPenalty"] = 0.6
    scan = OrbFeatures(b"", b"", 0)
    rows = candidate_rows(
        index,
        index.vectors[0],
        scan,
        source_object_id="1",
        query_id="one",
        rng=np.random.default_rng(8),
    )
    assert len(rows) == 20
    assert sum(query is scan for query in calls) == 10
    assert rows[0]["signals"]["keypointCount"] is None
    assert rows[1]["label"] == 1
    assert all(
        row["candidateArtworkId"] == index.objects[row["candidateObjectId"]]["artworkKey"]
        for row in rows
    )
    assert rows[1]["signals"]["objectPenalty"] == 0.6
    assert all(row["features"][1] == 0 for row in rows)
    assert not rows[11]["signals"]["homographyValid"]
    assert all(
        row["signals"]["gallery"] == "unknown" for row in rows if not row["signals"]["atVenue"]
    )


def test_labels_are_artwork_level_and_runner_up_inliers_exclude_the_candidate(monkeypatch):
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample import Reference
    from .sample_test import make_index

    index = make_index(5)
    index.objects["2"]["artworkKey"] = index.objects["1"]["artworkKey"]
    index.descriptors = {
        key: Reference(OrbFeatures(b"", b"", int(key)), 512) for key in index.objects
    }

    def verify(query, reference, **kwargs):
        return {"orbInliers": 10 * reference.count, "homographyValid": True}

    monkeypatch.setattr("pipeline.calibrator.features.verify", verify)
    rows = candidate_rows(
        index,
        index.vectors[0],
        OrbFeatures(b"", b"", 0),
        source_object_id="1",
        query_id="one",
        rng=np.random.default_rng(1),
    )
    assert {row["candidateObjectId"]: row["label"] for row in rows} == {
        "0": 0,
        "1": 1,
        "2": 1,
        "3": 0,
        "4": 0,
    }
    assert [row["signals"]["runnerUpInliers"] for row in rows] == [40, 40, 40, 40, 30]
    assert all(row["referenceCosine"] == pytest.approx(1) for row in rows)


def test_scans_without_a_venue_never_place_a_candidate_at_one():
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample_test import make_index

    index = make_index(30)
    contexts = set()
    for seed in range(40):
        rows = candidate_rows(
            index,
            index.vectors[0],
            OrbFeatures(b"", b"", 0),
            source_object_id="3",
            query_id="one",
            rng=np.random.default_rng(seed),
        )
        known = {row["signals"]["venueKnown"] for row in rows}
        assert len(known) == 1
        contexts |= known
        if known == {False}:
            assert not any(row["signals"]["atVenue"] for row in rows)
            assert all(row["signals"]["gallery"] == "unknown" for row in rows)
    assert contexts == {True, False}


def test_out_of_index_queries_hide_the_artwork_and_its_duplicate_entries_without_shrinking():
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample_test import make_index

    index = make_index(30)
    rng = np.random.default_rng(3)
    index.vectors = rng.normal(size=index.vectors.shape).astype(np.float32)
    index.vectors /= np.linalg.norm(index.vectors, axis=1, keepdims=True)
    index.vectors[4] = index.vectors[1]  # an unmerged duplicate entry of the source image
    index.objects["2"]["artworkKey"] = index.objects["1"]["artworkKey"]
    index.__post_init__()
    rows = candidate_rows(
        index,
        index.vectors[1],
        OrbFeatures(b"", b"", 0),
        source_object_id="1",
        query_id="one",
        rng=np.random.default_rng(1),
        out_of_index=True,
    )
    assert len(rows) == 20
    assert {"1", "2", "4"}.isdisjoint(row["candidateObjectId"] for row in rows)
    assert not any(row["label"] for row in rows)
    assert all(row["outOfIndex"] for row in rows)


@pytest.mark.parametrize("precomputed_scores", [False, True])
def test_withheld_duplicates_cannot_reenter_or_affect_competitors_through_another_view(
    monkeypatch, precomputed_scores
):
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample import Reference
    from .sample_test import make_index

    index = make_index(4)
    index.object_ids = ["0", "1", "1", "2", "3"]
    index.vectors = np.array(
        [[1, 0], [1, 0], [0.9, np.sqrt(0.19)], [0.8, 0.6], [0.6, 0.8]], dtype=np.float32
    )
    index.descriptors = {
        key: Reference(OrbFeatures(b"", b"", count), 512)
        for key, count in zip(index.objects, [100, 100, 4, 2], strict=True)
    }
    index.__post_init__()
    verified = []

    def verify(query, reference, **kwargs):
        verified.append(reference.count)
        return {"orbInliers": reference.count, "homographyValid": reference.count >= 15}

    monkeypatch.setattr("pipeline.calibrator.features.verify", verify)
    query = index.vectors[0]
    rows = candidate_rows(
        index,
        query,
        OrbFeatures(b"", b"", 100),
        source_object_id="0",
        query_id="withheld",
        rng=np.random.default_rng(1),
        out_of_index=True,
        scores=index.vectors @ query if precomputed_scores else None,
    )

    assert [row["candidateObjectId"] for row in rows] == ["2", "3"]
    assert verified == [4, 2]
    assert rows[0]["signals"]["runnerUpSimilarity"] == pytest.approx(0.6)
    assert [row["signals"]["runnerUpInliers"] for row in rows] == [2, 4]
    assert rows[0]["features"][-1] == pytest.approx(np.log1p(4) - np.log1p(2))


def test_verified_wrong_answers_record_whether_their_reference_shows_the_same_composition(
    monkeypatch,
):
    from ..orb import OrbFeatures
    from .features import candidate_rows
    from .sample import Reference
    from .sample_test import make_index

    index = make_index(4)
    index.descriptors = {
        key: Reference(OrbFeatures(b"", b"", int(key)), 512) for key in index.objects
    }

    def verify(query, reference, **kwargs):
        # Object 2's reference lines up with the source's (object 1); object 3 only with the query.
        valid = {query.count, reference.count} != {1, 3}
        return {"orbInliers": 40, "homographyValid": valid}

    monkeypatch.setattr("pipeline.calibrator.features.verify", verify)
    rows = candidate_rows(
        index,
        index.vectors[0],
        OrbFeatures(b"", b"", 9),
        source_object_id="1",
        query_id="one",
        rng=np.random.default_rng(1),
    )
    flags = {row["candidateObjectId"]: row["referenceMatch"] for row in rows}
    assert flags == {"0": True, "1": False, "2": True, "3": False}


def test_committed_fixture_is_python_output():
    path = REPO_ROOT / "shared/calibrator/fixtures/calibrator-features.json"
    rows = json.loads(path.read_text())
    assert len(rows) == 12
    for row in rows:
        np.testing.assert_allclose(featurize(row["signals"]), row["expectedFeatures"], atol=1e-12)
        assert len(row["expectedFeatures"]) == len(FEATURE_NAMES)

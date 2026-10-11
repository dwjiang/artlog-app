import json

import numpy as np
import pytest
from PIL import Image

from .evaluation import FIXTURE, cases, evaluate, main, summarize


def test_glare_and_partial_crops_are_seeded_and_preserve_the_reference():
    with Image.open(FIXTURE) as image:
        original = image.convert("RGB")
    before = original.tobytes()
    first = cases(original, seed=7)
    second = cases(original, seed=7)
    assert [name for name, _, _ in first] == [name for name, _, _ in second]
    for (name, known, image), (_, other_known, other) in zip(first, second, strict=True):
        assert known == other_known
        assert image.tobytes() == other.tobytes()
        if name.startswith("crop-area-"):
            area = float(name.removeprefix("crop-area-"))
            assert image.width * image.height / (original.width * original.height) == pytest.approx(
                area, abs=0.002
            )
        if name.startswith("glare-"):
            assert np.asarray(image).mean() > np.asarray(original).mean()
    assert original.tobytes() == before


def test_report_counts_unknowns_and_known_misses_without_claiming_confident_accuracy():
    rows = [
        {"knownArtwork": True, "homographyValid": True, "orbInliers": 35},
        {"knownArtwork": True, "homographyValid": False, "orbInliers": 8},
        {"knownArtwork": False, "homographyValid": True, "orbInliers": 20},
        {"knownArtwork": False, "homographyValid": False, "orbInliers": 0},
    ]
    report = summarize(rows)
    assert report == {
        "queries": 4,
        "knownQueries": 2,
        "unknownQueries": 2,
        "verifiedKnown": 1,
        "missedKnown": 1,
        "falseVerifiedUnknown": 1,
        "knownVerificationRate": 0.5,
        "unknownFalseVerificationRate": 0.5,
    }
    assert summarize(rows, min_inliers=30)["falseVerifiedUnknown"] == 0
    assert summarize(rows, min_inliers=50)["missedKnown"] == 2
    assert summarize([])["knownVerificationRate"] is None


def test_committed_image_runs_offline_with_reproducible_results_and_separate_conditions(tmp_path):
    report = evaluate()
    assert report == evaluate()
    assert report["queries"] == 30
    assert report["knownQueries"] == 24
    assert report["unknownQueries"] == 6
    assert report["falseVerifiedUnknown"] == 0
    assert report["byCondition"]["clean"]["verifiedKnown"] == 3
    assert report["byCondition"]["glare-0.45"]["verifiedKnown"] == 3
    assert report["byCondition"]["crop-area-0.50"]["verifiedKnown"] == 3
    assert report["byCondition"]["unknown-blank"]["knownVerificationRate"] is None
    assert [row["verifiedKnown"] for row in report["inlierSweep"]] == sorted(
        [row["verifiedKnown"] for row in report["inlierSweep"]], reverse=True
    )
    assert len({row["queryId"] for row in report["rows"]}) == 30
    assert all(len(row["pixelSha256"]) == 64 for row in report["rows"])
    output = tmp_path / "report.json"
    main(["--out", str(output)])
    assert json.loads(output.read_text()) == report


@pytest.mark.parametrize("seeds", [(), (7, 7)])
def test_rejects_a_missing_or_repeated_seed_that_would_distort_query_counts(seeds):
    with pytest.raises(ValueError, match="seeds"):
        evaluate(seeds=seeds)

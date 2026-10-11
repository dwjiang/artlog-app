import json

import numpy as np
import pytest
from scipy.special import expit
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from .features import FEATURE_NAMES, featurize
from .features_test import signals
from .report import write_report
from .train import (
    RULES,
    VERSION,
    choose_confident,
    choose_soft,
    eligible,
    evaluate,
    fit_coefficients,
    train,
)


def separable_rows(objects=60):
    rng = np.random.default_rng(4)
    rows = []
    for obj in range(objects):
        for variant in range(4):
            for positive in [True, False]:
                s = signals(
                    similarity=float(
                        rng.uniform(0.94, 0.99) if positive else rng.uniform(0.2, 0.6)
                    ),
                    runnerUpSimilarity=0.7 if positive else 0.96,
                    atVenue=positive,
                    gallery="same" if positive else "unknown",
                    homographyValid=positive,
                    orbInliers=40 if positive else 0,
                )
                rows.append(
                    {
                        "sourceObjectId": str(obj),
                        "queryId": f"{obj}:{variant}",
                        "candidateObjectId": str(obj) if positive else f"negative-{obj}",
                        "label": int(positive),
                        "signals": s,
                        "features": featurize(s).tolist(),
                    }
                )
    return rows


def test_folded_weights_preserve_sklearn_probabilities_including_constant_features():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(100, 11))
    x[:, 3] = 1
    y = (x[:, 0] + x[:, 1] > 0).astype(int)
    weights, bias = fit_coefficients(x, y)
    scaler = StandardScaler().fit(x)
    model = LogisticRegression(class_weight="balanced", C=1, max_iter=1000).fit(
        scaler.transform(x), y
    )
    np.testing.assert_allclose(
        expit(x @ weights + bias),
        model.predict_proba(scaler.transform(x))[:, 1],
        rtol=1e-12,
        atol=1e-12,
    )


def test_training_holds_out_whole_objects_and_emits_the_typescript_contract(tmp_path):
    rows = separable_rows()
    result = train(rows, seed=7)
    assert not result.errors
    assert result.config["featureNames"] == FEATURE_NAMES
    assert result.config["version"] == VERSION
    assert len(result.config["weights"]) == len(FEATURE_NAMES)
    assert result.config["thresholds"]["soft"] <= result.config["thresholds"]["confident"]
    assert result.metrics["auc"] >= 0.99
    assert result.metrics["outcomes"]["confident"]["precision"] >= 0.99
    assert result.metrics["accepted"]["recall"] >= 0.9
    assert set(result.metrics["trainObjectIds"]).isdisjoint(result.metrics["heldOutObjectIds"])
    assert len(result.metrics["heldOutObjectIds"]) == 12
    assert len(result.metrics["ruleSweep"]) == 9
    assert len(result.metrics["calibration"]) == 10
    write_report(result, out=tmp_path)
    artifact = json.loads((tmp_path / f"calibrator-{VERSION}.json").read_text())
    assert artifact == result.config
    assert "pending" in (tmp_path / "calibrator-report.md").read_text()


def test_threshold_selection_counts_ties_and_only_eligible_top_one_predictions():
    probabilities = np.array([0.99, 0.95, 0.95, 0.2])
    truth = np.array([1, 1, 0, 0])
    assert choose_confident(probabilities, truth, np.ones(4, dtype=bool)) == 0.99
    assert choose_confident(probabilities, truth, np.zeros(4, dtype=bool)) is None
    assert choose_soft(probabilities, truth, target=0.9) is None
    assert choose_soft(probabilities, truth, target=0.5) == 0.95


def test_high_scoring_ineligible_winner_is_soft_and_never_replaced_by_an_eligible_runner_up():
    result = train(separable_rows(), seed=7)
    rows = separable_rows(1)[:2]
    rows[0]["signals"].update(homographyValid=False, keypointCount=None)
    rows[1]["signals"].update(homographyValid=True, orbInliers=40)
    probabilities = np.array([1.0, 0.999])
    metrics = evaluate(rows, probabilities, result.config)
    assert metrics["outcomes"]["confident"]["count"] == 0
    assert metrics["outcomes"]["soft"]["correct"] == 1


def test_unmerged_duplicates_are_set_aside_and_holdout_splits_by_venue_context():
    rows = separable_rows()
    for row in rows:
        if int(row["sourceObjectId"]) % 2:
            s = dict(row["signals"], venueKnown=False, atVenue=False, gallery="unknown")
            row["signals"], row["features"] = s, featurize(s).tolist()
    duplicates = [
        row
        | {
            "candidateObjectId": f"copy-{row['sourceObjectId']}",
            "label": 0,
            "referenceCosine": 0.97,
        }
        for row in rows
        if row["label"]
    ]
    result = train(rows + duplicates, seed=7)
    assert not result.errors
    assert result.metrics["duplicateRowsSetAside"] == len(duplicates)
    assert result.metrics["rows"] == len(rows)
    by_venue = result.metrics["byVenueContext"]
    assert set(by_venue) == {"venueKnown", "noVenue"}
    assert (
        by_venue["venueKnown"]["queries"] + by_venue["noVenue"]["queries"]
        == result.metrics["queries"]
    )


def test_withheld_artwork_queries_count_against_precision_but_not_recall():
    rows = separable_rows()
    withheld = [
        row | {"queryId": f"{row['queryId']}:withheld", "label": 0, "outOfIndex": True}
        for row in rows
        if not row["label"]
    ]
    result = train(rows + withheld, seed=7)
    assert not result.errors
    assert result.metrics["answerableQueries"] * 2 == result.metrics["queries"]
    assert result.metrics["accepted"]["recall"] >= 0.9
    assert result.metrics["outcomes"]["confident"]["incorrect"] == 0


def test_bad_separation_writes_diagnostics_but_removes_stale_v2_artifact(tmp_path):
    rows = separable_rows()
    constant = signals()
    for row in rows:
        row["signals"] = dict(constant)
        row["features"] = featurize(constant).tolist()
    result = train(rows)
    assert result.metrics["auc"] == 0.5
    assert any("AUC" in error for error in result.errors)
    stale = tmp_path / f"calibrator-{VERSION}.json"
    stale.write_text("{}")
    write_report(result, out=tmp_path)
    assert not stale.exists()
    assert "STOP" in (tmp_path / "calibrator-report.md").read_text()


def test_failed_retrieval_counts_against_recall_even_with_separable_candidates():
    rows = separable_rows()
    for row in rows:
        if row["label"] and int(row["sourceObjectId"]) % 2 == 0:
            row["label"] = 0
    result = train(rows)
    assert result.errors
    assert result.metrics["top1Accuracy"] < 0.9
    assert any("recall" in error for error in result.errors)


def test_rejects_feature_drift_before_fitting():
    rows = separable_rows()
    rows[0]["features"][0] = -42
    with pytest.raises(ValueError, match="features"):
        train(rows)


MIN_SIMILARITY = RULES["lowTexture"]["minSimilarity"]
MIN_MARGIN = RULES["lowTexture"]["minMargin"]


@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({"keypointCount": None}, False),
        ({"keypointCount": 80, "orbInliers": 14}, False),
        ({"keypointCount": 80, "orbInliers": 15}, True),
        ({"keypointCount": 80, "homographyValid": False}, False),
        ({"keypointCount": 79, "similarity": 0.95, "runnerUpSimilarity": 0.94 - MIN_MARGIN}, True),
        (
            {"keypointCount": 79, "similarity": MIN_SIMILARITY - 0.01, "runnerUpSimilarity": 0},
            False,
        ),
        ({"keypointCount": 79, "similarity": 0.95, "runnerUpSimilarity": 0.96 - MIN_MARGIN}, False),
        ({"keypointCount": 79, "similarity": 0.95, "atVenue": False}, False),
    ],
)
def test_hard_rules_match_typescript_at_the_texture_boundary(overrides, expected):
    assert eligible(signals(**overrides), RULES) == expected


def test_tied_probabilities_choose_the_more_similar_candidate():
    result = train(separable_rows(), seed=7)
    rows = list(reversed(separable_rows(1)[:2]))
    metrics = evaluate(rows, np.array([1.0, 1.0]), result.config)
    assert metrics["outcomes"]["confident"]["correct"] == 1


def test_report_keeps_manifest_provenance_without_the_sampled_object_list(tmp_path):
    from ..model import sha256_of
    from .train import main

    features = tmp_path / "features.jsonl"
    features.write_text("".join(json.dumps(row) + "\n" for row in separable_rows()))
    manifest = {
        "featuresSha256": sha256_of(features),
        "seed": 7,
        "sourceObjects": [{"objectId": str(i), "key": f"met:{i}"} for i in range(60)],
    }
    features.with_suffix(".manifest.json").write_text(json.dumps(manifest))
    assert main(["--features", str(features), "--out", str(tmp_path / "out")]) == 0
    report = (tmp_path / "out" / "calibrator-report.md").read_text()
    metrics = json.loads((tmp_path / "out" / "calibrator-metrics.json").read_text())
    assert "sourceObjects" not in report
    assert metrics["provenance"] == {"featuresSha256": manifest["featuresSha256"], "seed": 7}
    assert json.loads(features.with_suffix(".manifest.json").read_text()) == manifest


def test_stop_exit_removes_stale_artifacts_and_metrics(tmp_path):
    from .train import main

    features = tmp_path / "features.jsonl"
    rows = separable_rows()
    rows[0]["features"][0] = -42
    features.write_text("".join(json.dumps(row) + "\n" for row in rows))
    out = tmp_path / "out"
    out.mkdir()
    for stale in (f"calibrator-{VERSION}.json", "calibrator-metrics.json"):
        (out / stale).write_text("{}")
    assert main(["--features", str(features), "--out", str(out)]) == 1
    assert sorted(path.name for path in out.iterdir()) == ["calibrator-report.md"]
    assert "STOP" in (out / "calibrator-report.md").read_text()


def test_training_rejects_a_feature_manifest_from_another_model_before_emitting_weights(tmp_path):
    from ..model import sha256_of
    from .train import main

    features = tmp_path / "features.jsonl"
    features.write_text("".join(json.dumps(row) + "\n" for row in separable_rows()))
    features.with_suffix(".manifest.json").write_text(
        json.dumps({"featuresSha256": sha256_of(features), "modelVersion": "obsolete-model"})
    )
    out = tmp_path / "out"
    assert main(["--features", str(features), "--out", str(out)]) == 1
    assert not (out / f"calibrator-{VERSION}.json").exists()
    assert "modelVersion" in (out / "calibrator-report.md").read_text()


@pytest.mark.parametrize("same_artwork", [False, True])
def test_two_eligible_confident_artworks_require_review_but_views_of_one_artwork_do_not(
    same_artwork,
):
    rows = separable_rows(1)[:2]
    for row in rows:
        row["signals"].update(homographyValid=True, orbInliers=40)
    rows[0]["candidateArtworkId"] = "artwork-a"
    rows[1]["candidateArtworkId"] = "artwork-a" if same_artwork else "artwork-b"
    config = RULES | {"thresholds": {"confident": 0.9, "soft": 0.4}}
    metrics = evaluate(rows, np.array([0.99, 0.95]), config)
    assert metrics["outcomes"]["confident"]["count"] == int(same_artwork)
    assert metrics["outcomes"]["soft"]["count"] == int(not same_artwork)
    assert metrics["accepted"]["correct"] == 1


def test_confident_threshold_selection_excludes_ambiguous_winners_at_each_cutoff():
    probabilities = np.array([0.99, 0.95, 0.92])
    truth = np.array([1, 0, 1])
    competitors = np.array([0.1, 0.94, 0.1])
    assert (
        choose_confident(
            probabilities, truth, np.ones(3, dtype=bool), competitor_probabilities=competitors
        )
        == 0.92
    )


def test_competitor_cutoff_can_meet_precision_when_no_winner_cutoff_does():
    rows = separable_rows(1)[:4]
    for row in rows:
        row["signals"].update(homographyValid=True, orbInliers=40)
    probabilities = np.array([0.97, 0.99, 0.98, 0.90])
    cutoff = choose_confident(
        np.array([0.99, 0.98]),
        np.array([0, 1]),
        np.ones(2, dtype=bool),
        competitor_probabilities=np.array([0.97, 0.90]),
    )
    assert cutoff == 0.97
    metrics = evaluate(
        rows, probabilities, RULES | {"thresholds": {"confident": cutoff, "soft": 0.4}}
    )
    assert metrics["outcomes"]["confident"]["count"] == 1
    assert metrics["outcomes"]["confident"]["precision"] == 1.0
    assert metrics["ambiguousTop1"] == 1


@pytest.mark.parametrize("competitor_score,competitor_eligible", [(0.89, True), (0.95, False)])
def test_a_weak_or_ineligible_distinct_candidate_does_not_soften_the_winner(
    competitor_score, competitor_eligible
):
    rows = separable_rows(1)[:2]
    rows[1]["signals"].update(homographyValid=competitor_eligible, orbInliers=40)
    config = RULES | {"thresholds": {"confident": 0.9, "soft": 0.4}}
    metrics = evaluate(rows, np.array([0.99, competitor_score]), config)
    assert metrics["outcomes"]["confident"]["count"] == 1
    assert metrics["ambiguousTop1"] == 0


def test_threshold_selection_matches_direct_decisions_with_ties_and_ineligible_winners():
    rng = np.random.default_rng(19)
    for _ in range(20):
        probabilities = rng.choice([0.4, 0.7, 0.85, 0.9, 0.95], 40)
        competitors = np.minimum(probabilities, rng.choice([-np.inf, 0.2, 0.7, 0.8, 0.85, 0.9], 40))
        truth = rng.integers(0, 2, 40)
        allowed = rng.random(40) > 0.2
        expected = None
        cutoffs = set(probabilities[allowed]) | set(competitors[allowed & np.isfinite(competitors)])
        for cutoff in sorted(cutoffs, reverse=True):
            accepted = allowed & (probabilities >= cutoff) & (competitors < cutoff)
            if accepted.any() and truth[accepted].mean() >= 0.8:
                expected = cutoff
        assert (
            choose_confident(
                probabilities,
                truth,
                allowed,
                target=0.8,
                competitor_probabilities=competitors,
            )
            == expected
        )

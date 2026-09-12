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
    V1_RULES,
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
    assert result.config["version"] == "lr-v2"
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
    artifact = json.loads((tmp_path / "calibrator-lr-v2.json").read_text())
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


def test_bad_separation_writes_diagnostics_but_removes_stale_v2_artifact(tmp_path):
    rows = separable_rows()
    constant = signals()
    for row in rows:
        row["signals"] = dict(constant)
        row["features"] = featurize(constant).tolist()
    result = train(rows)
    assert result.metrics["auc"] == 0.5
    assert any("AUC" in error for error in result.errors)
    stale = tmp_path / "calibrator-lr-v2.json"
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


@pytest.mark.parametrize(
    "overrides,expected",
    [
        ({"keypointCount": None}, False),
        ({"keypointCount": 80, "orbInliers": 14}, False),
        ({"keypointCount": 80, "orbInliers": 15}, True),
        ({"keypointCount": 80, "homographyValid": False}, False),
        ({"keypointCount": 79, "similarity": 0.95, "runnerUpSimilarity": 0.9}, True),
        ({"keypointCount": 79, "similarity": 0.92}, False),
        ({"keypointCount": 79, "similarity": 0.95, "runnerUpSimilarity": 0.94}, False),
        ({"keypointCount": 79, "similarity": 0.95, "atVenue": False}, False),
    ],
)
def test_hard_rules_match_typescript_at_the_texture_boundary(overrides, expected):
    assert eligible(signals(**overrides), V1_RULES) == expected


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
    for stale in ("calibrator-lr-v2.json", "calibrator-metrics.json"):
        (out / stale).write_text("{}")
    assert main(["--features", str(features), "--out", str(out)]) == 1
    assert sorted(path.name for path in out.iterdir()) == ["calibrator-report.md"]
    assert "STOP" in (out / "calibrator-report.md").read_text()

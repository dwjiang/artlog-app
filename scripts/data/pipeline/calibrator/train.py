"""Fit a plain-dot-product calibrator and evaluate the app's top-one decision."""

import argparse
import copy
import json
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.special import expit
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

from ..model import sha256_of
from .features import FEATURE_NAMES, featurize

VERSION = "lr-v3"
# Similarity cutoffs follow the model's cosine scale: retune them with every modelVersion.
RULES = {
    "lowTextureKeypoints": 80,
    "textured": {"minInliers": 15},
    "lowTexture": {"minSimilarity": 0.80, "minMargin": 0.08, "requireVenueAgreement": True},
}


@dataclass
class TrainingResult:
    config: dict
    metrics: dict
    errors: list[str]


def fit_coefficients(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, float]:
    scaler = StandardScaler().fit(x)
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        model = LogisticRegression(class_weight="balanced", C=1.0, max_iter=1000).fit(
            scaler.transform(x), y
        )
    weights = model.coef_[0] / scaler.scale_
    bias = float(model.intercept_[0] - weights @ scaler.mean_)
    return weights, bias


def eligible(signals: dict, config: dict) -> bool:
    keypoints = signals["keypointCount"]
    if keypoints is None:
        return False
    if keypoints >= config["lowTextureKeypoints"]:
        return bool(
            signals["homographyValid"] and signals["orbInliers"] >= config["textured"]["minInliers"]
        )
    features = featurize(signals)
    rule = config["lowTexture"]
    return bool(
        features[0] >= rule["minSimilarity"]
        and features[1] >= rule["minMargin"]
        and (not rule["requireVenueAgreement"] or signals["atVenue"])
    )


def _thresholds(probabilities: np.ndarray, truth: np.ndarray):
    order = np.argsort(-probabilities, kind="stable")
    scores = probabilities[order]
    ends = np.r_[np.flatnonzero(np.diff(scores)), len(scores) - 1]
    true_positives = np.cumsum(truth[order])[ends]
    return scores[ends], true_positives, ends + 1


def choose_confident(
    probabilities: np.ndarray,
    truth: np.ndarray,
    allowed: np.ndarray,
    *,
    target: float = 0.99,
) -> float | None:
    if not allowed.any():
        return None
    thresholds, positives, totals = _thresholds(probabilities[allowed], truth[allowed])
    passing = np.flatnonzero(positives / totals >= target)
    return float(thresholds[passing[-1]]) if len(passing) else None


def choose_soft(
    probabilities: np.ndarray,
    truth: np.ndarray,
    *,
    target: float = 0.9,
) -> float | None:
    if not len(truth):
        return None
    thresholds, positives, _ = _thresholds(probabilities, truth)
    passing = np.flatnonzero(positives / len(truth) >= target)
    return float(thresholds[passing[0]]) if len(passing) else None


def _winners(rows: list[dict], probabilities: np.ndarray) -> np.ndarray:
    winners: dict[str, int] = {}
    for i, row in enumerate(rows):
        previous = winners.get(row["queryId"])
        similarity = min(1, max(0, row["signals"]["similarity"]))
        rank = (probabilities[i], similarity)
        if previous is None or rank > (
            probabilities[previous],
            min(1, max(0, rows[previous]["signals"]["similarity"])),
        ):
            winners[row["queryId"]] = i
    return np.array(list(winners.values()), dtype=int)


def evaluate(rows: list[dict], probabilities: np.ndarray, config: dict) -> dict:
    winners = _winners(rows, probabilities)
    truth = np.array([rows[i]["label"] for i in winners])
    allowed = np.array([eligible(rows[i]["signals"], config) for i in winners])
    scores = probabilities[winners]
    confident = (scores >= config["thresholds"]["confident"]) & allowed
    soft = ~confident & (scores >= config["thresholds"]["soft"])

    def counts(mask):
        count = int(mask.sum())
        correct = int(truth[mask].sum())
        return {
            "count": count,
            "correct": correct,
            "incorrect": count - correct,
            "precision": correct / count if count else None,
            "recall": correct / len(winners),
        }

    return {
        "queries": len(winners),
        "top1Accuracy": float(truth.mean()),
        "outcomes": {
            "confident": counts(confident),
            "soft": counts(soft),
            "miss": counts(~confident & ~soft),
        },
        "accepted": counts(confident | soft),
        "eligibleTop1": int(allowed.sum()),
    }


def _calibration(probabilities: np.ndarray, labels: np.ndarray) -> list[dict]:
    bins = np.minimum((probabilities * 10).astype(int), 9)
    curve = []
    for i in range(10):
        mask = bins == i
        curve.append(
            {
                "lower": i / 10,
                "upper": (i + 1) / 10,
                "count": int(mask.sum()),
                "meanProbability": float(probabilities[mask].mean()) if mask.any() else None,
                "positiveFraction": float(labels[mask].mean()) if mask.any() else None,
            }
        )
    return curve


def train(rows: list[dict], *, seed: int = 20260911) -> TrainingResult:
    if not rows:
        raise ValueError("training dataset is empty")
    features = []
    queries = {}
    candidates = set()
    for row in rows:
        feature = featurize(row["signals"])
        if "features" in row and not np.allclose(row["features"], feature, atol=1e-12, rtol=0):
            raise ValueError(
                "stored features differ from signals; regenerate with current featurize"
            )
        if row["label"] not in (0, 1):
            raise ValueError("labels must be 0 or 1")
        query_id, source = row["queryId"], row["sourceObjectId"]
        if query_id in queries and queries[query_id] != source:
            raise ValueError("one query cannot belong to multiple source objects")
        queries[query_id] = source
        identity = (query_id, row["candidateObjectId"])
        if identity in candidates:
            raise ValueError("duplicate candidate within a query")
        candidates.add(identity)
        features.append(feature)
    x = np.array(features)
    y = np.array([row["label"] for row in rows])
    groups = np.array([row["sourceObjectId"] for row in rows])
    if len(np.unique(groups)) < 5:
        raise ValueError("at least five source objects are needed for an object-level 20% holdout")
    train_ids, held_ids = next(
        GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed).split(x, y, groups)
    )
    if len(np.unique(y[train_ids])) != 2 or len(np.unique(y[held_ids])) != 2:
        raise ValueError("training and held-out sets must each contain positive and negative rows")
    weights, bias = fit_coefficients(x[train_ids], y[train_ids])
    probabilities = expit(x[held_ids] @ weights + bias)
    held_rows = [rows[i] for i in held_ids]
    winners = _winners(held_rows, probabilities)
    winner_truth = y[held_ids][winners]
    allowed = np.array([eligible(held_rows[i]["signals"], RULES) for i in winners])
    confident = choose_confident(probabilities[winners], winner_truth, allowed)
    soft = choose_soft(probabilities[winners], winner_truth)
    auc = float(roc_auc_score(y[held_ids], probabilities))
    errors = []
    if auc < 0.9:
        errors.append(f"STOP: held-out AUC {auc:.6f} < 0.9; do not ship v2")
    if confident is None:
        errors.append("No confident threshold reaches precision >= 0.99 with nonzero support")
    if soft is None:
        errors.append("No soft threshold reaches true-object top-1 recall >= 0.90")
    # Failed fits keep provisional v1 thresholds for diagnostic tables only; no JSON is emitted.
    confident_value = confident if confident is not None else 0.85
    config = {
        "version": VERSION,
        "featureNames": list(FEATURE_NAMES),
        "weights": weights.tolist(),
        "bias": bias,
        "thresholds": {
            "confident": confident_value,
            "soft": min(soft if soft is not None else 0.45, confident_value),
        },
        **copy.deepcopy(RULES),
    }
    metrics = evaluate(held_rows, probabilities, config)
    if not errors and (
        metrics["outcomes"]["confident"]["precision"] is None
        or metrics["outcomes"]["confident"]["precision"] < 0.99
        or metrics["accepted"]["recall"] < 0.9
    ):
        errors.append("Chosen thresholds fail the final decision-level precision/recall gates")
    sweep = []
    for keypoints in [60, 80, 100]:
        for inliers in [10, 15, 20]:
            variant = config | {
                "lowTextureKeypoints": keypoints,
                "textured": {"minInliers": inliers},
            }
            evaluation = evaluate(held_rows, probabilities, variant)
            sweep.append(
                {
                    "lowTextureKeypoints": keypoints,
                    "minInliers": inliers,
                    **evaluation["outcomes"]["confident"],
                }
            )
    metrics.update(
        auc=auc,
        seed=seed,
        rows=len(rows),
        trainRows=len(train_ids),
        heldOutRows=len(held_ids),
        positiveRows=int(y.sum()),
        heldOutPositiveRows=int(y[held_ids].sum()),
        trainObjectIds=sorted(set(groups[train_ids].tolist())),
        heldOutObjectIds=sorted(set(groups[held_ids].tolist())),
        calibration=_calibration(probabilities, y[held_ids]),
        ruleSweep=sweep,
        thresholdSelection={"confident": confident, "soft": soft},
    )
    return TrainingResult(config, metrics, errors)


def main(argv: list[str] | None = None) -> int:
    from .report import write_report

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", type=Path, default=Path("out/calibrator-features.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--seed", type=int, default=20260911)
    args = parser.parse_args(argv)
    try:
        with args.features.open() as body:
            rows = [json.loads(line) for line in body if line.strip()]
        provenance = {"featuresSha256": sha256_of(args.features)}
        manifest = args.features.with_suffix(".manifest.json")
        if manifest.exists():
            provenance = json.loads(manifest.read_text())
            if provenance["featuresSha256"] != sha256_of(args.features):
                raise ValueError("feature file does not match its sampling manifest")
            # The per-object id lists stay in the manifest; the report is for reading.
            for key in ("sourceObjects", "skippedObjects"):
                provenance.pop(key, None)
        result = train(rows, seed=args.seed)
        write_report(result, out=args.out, provenance=provenance)
    except (ValueError, FileNotFoundError, ConvergenceWarning) as error:
        args.out.mkdir(parents=True, exist_ok=True)
        for stale in (f"calibrator-{VERSION}.json", "calibrator-metrics.json"):
            (args.out / stale).unlink(missing_ok=True)
        (args.out / "calibrator-report.md").write_text(f"# Calibrator training — STOP\n\n{error}\n")
        print(str(error))
        return 1
    print(
        json.dumps(
            {
                "auc": result.metrics["auc"],
                "outcomes": result.metrics["outcomes"],
                "accepted": result.metrics["accepted"],
                "errors": result.errors,
            },
            indent=2,
        )
    )
    return int(bool(result.errors))


if __name__ == "__main__":
    raise SystemExit(main())

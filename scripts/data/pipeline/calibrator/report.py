"""Human review artifacts; failed statistical gates never leave installable weights."""

import json
from pathlib import Path
from typing import TYPE_CHECKING

from .train import VERSION

if TYPE_CHECKING:
    from .train import TrainingResult


def _number(value) -> str:
    return "n/a" if value is None else f"{value:.6f}"


def write_report(result: "TrainingResult", *, out: Path, provenance: dict | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / f"calibrator-{VERSION}.json"
    config, metrics = result.config, result.metrics
    if result.errors:
        artifact.unlink(missing_ok=True)
    else:
        artifact.write_text(json.dumps(config, indent=2, allow_nan=False) + "\n")
    lines = [
        f"# Calibrator {VERSION} training report",
        "",
        f"Status: **STOP — no {VERSION} artifact**"
        if result.errors
        else "Status: **fit passed; human adoption into weights.ts is pending**",
        "",
        *result.errors,
        "",
        "## Dataset and split",
        "",
        f"- Rows: {metrics['rows']} ({metrics['positiveRows']} positive)",
        f"- Duplicate or same-composition rows set aside: {metrics['duplicateRowsSetAside']}",
        f"- Training: {metrics['trainRows']} rows / {len(metrics['trainObjectIds'])} source objects",
        f"- Held out: {metrics['heldOutRows']} rows / {len(metrics['heldOutObjectIds'])} source objects",
        (
            f"- Held-out queries: {metrics['queries']} ({metrics['answerableQueries']} with the "
            f"artwork in the index); seed: {metrics['seed']}"
        ),
        f"- Candidate-level ROC AUC: {_number(metrics['auc'])}",
        f"- True-object top-1 accuracy before thresholds: {_number(metrics['top1Accuracy'])}",
        "",
        "## Decisions on held-out queries",
        "",
        (
            "Only the highest-probability candidate is decided; ties use clamped similarity. "
            "A blocked winner is never replaced with an eligible runner-up. Recall uses every "
            "held-out query whose artwork is in the index, including queries where retrieval "
            "lost it; precision counts every query, so a confident answer to a withheld "
            "artwork counts as wrong."
        ),
        "",
        "| Outcome | Queries | Correct artwork | Wrong artwork | Precision | Correct / all queries |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, row in metrics["outcomes"].items():
        lines.append(
            f"| {name} | {row['count']} | {row['correct']} | {row['incorrect']} | "
            f"{_number(row['precision'])} | {_number(row['recall'])} |"
        )
    accepted = metrics["accepted"]
    lines.extend(
        [
            "",
            (
                f"Confident + soft: precision {_number(accepted['precision'])}, "
                f"recall {_number(accepted['recall'])}."
            ),
            "",
            "## By venue context",
            "",
            "| Context | Queries | Confident | Wrong confident | Accepted precision | Accepted recall |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
            *(
                f"| {name} | {part['queries']} | {part['outcomes']['confident']['count']} | "
                f"{part['outcomes']['confident']['incorrect']} | "
                f"{_number(part['accepted']['precision'])} | {_number(part['accepted']['recall'])} |"
                for name, part in metrics["byVenueContext"].items()
            ),
            "",
            "## Threshold rationale",
            "",
            (
                "Confident: the lowest observed eligible top-1 probability with precision ≥ 0.99, "
                "counting ties together and requiring nonzero predictions. Soft: the highest observed "
                "top-1 probability retaining ≥ 0.90 correct-object recall, capped at confident. "
                "These thresholds are selected on this holdout; this is a tuning estimate, not an "
                "independent museum-photo evaluation. All rule constants remain at v1."
            ),
            "",
            (
                f"Selected before ordering: {json.dumps(metrics['thresholdSelection'])}. "
                f"Final thresholds: {json.dumps(config['thresholds'])}."
            ),
            "If a target is unattainable, tables use provisional thresholds and no artifact is emitted.",
            "",
            "## Calibration curve (all held-out candidate rows)",
            "",
            "| Probability bin | Rows | Mean predicted | Positive fraction |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for row in metrics["calibration"]:
        lines.append(
            f"| {row['lower']:.1f}–{row['upper']:.1f} | {row['count']} | "
            f"{_number(row['meanProbability'])} | {_number(row['positiveFraction'])} |"
        )
    lines.extend(["", "## Folded feature weights", "", "| Feature | Weight |", "| --- | ---: |"])
    for name, weight in zip(config["featureNames"], config["weights"], strict=True):
        lines.append(f"| {name} | {weight:.12g} |")
    lines.extend(
        [
            "",
            (
                f"Bias: {config['bias']:.12g}. StandardScaler is fitted on training objects only; "
                "its scale and mean are folded into these coefficients."
            ),
            "",
            "## Low-texture rule sweep",
            "",
            (
                "Diagnostic only, at the selected thresholds; retains the v1 80-keypoint / 15-inlier "
                "rules. The verifier itself requires 15 inliers for a valid homography, so a 10-inlier "
                "rule cannot relax that requirement."
            ),
            "",
            "| Texture cutoff | Min inliers | Confident | Correct | Precision | Recall |",
            "| --- | --- | ---: | ---: | ---: | ---: |",
        ]
    )
    for row in metrics["ruleSweep"]:
        lines.append(
            f"| {row['lowTextureKeypoints']} | {row['minInliers']} | {row['count']} | "
            f"{row['correct']} | {_number(row['precision'])} | {_number(row['recall'])} |"
        )
    if provenance:
        lines.extend(
            [
                "",
                "## Provenance",
                "",
                "```json",
                json.dumps(provenance, indent=2, allow_nan=False),
                "```",
            ]
        )
    if not result.errors:
        lines.extend(
            [
                "",
                "## Artifact (adoption pending)",
                "",
                "```json",
                json.dumps(config, indent=2, allow_nan=False),
                "```",
            ]
        )
    (out / "calibrator-report.md").write_text("\n".join(lines) + "\n")
    (out / "calibrator-metrics.json").write_text(
        json.dumps(
            {
                **metrics,
                "errors": result.errors,
                "provenance": provenance,
            },
            indent=2,
            allow_nan=False,
        )
        + "\n"
    )

"""Scores predictions.jsonl against truth.jsonl for photos that show the whole painting.

uv run python score.py --out <eval dir>
"""

import argparse
import json
import statistics
from collections import Counter
from pathlib import Path

from geometry import score

VERDICTS = ["accurate", "too loose", "too tight", "off"]


def summarize(label: str, results: list[dict]) -> str:
    counts = Counter(result["verdict"] for result in results)
    shares = " | ".join(f"{counts[v] / len(results):6.1%}" for v in VERDICTS)
    return f"| {label} | {len(results)} | {shares} | {statistics.median(r['iou'] for r in results):.3f} |"


def report(predictions: list[dict], truth: dict[str, dict]) -> str:
    table = [
        "| Crop | Photos | " + " | ".join(VERDICTS) + " | Median IoU |",
        "|---|---:|" + "---:|" * len(VERDICTS) + "---:|",
    ]
    notes = []
    for method in sorted({p["method"] for p in predictions}, reverse=True):
        rows = [p for p in predictions if p["method"] == method and p["quad"]]
        snapped = [p for p in rows if p["snapped"]]
        table.append(summarize(f"{method}: app", [score(p["quad"], truth[p["photo"]]["quad"]) for p in rows]))
        table.append(summarize(
            f"{method}: app + snap", [score(p["snapped"] or p["quad"], truth[p["photo"]]["quad"]) for p in rows]
        ))
        if snapped:
            table.append(summarize(
                f"{method}: snapped only, before", [score(p["quad"], truth[p["photo"]]["quad"]) for p in snapped]
            ))
            table.append(summarize(
                f"{method}: snapped only, after", [score(p["snapped"], truth[p["photo"]]["quad"]) for p in snapped]
            ))
        verified = sum(p["verified"] for p in rows)
        notes.append(f"{method}: {verified}/{len(rows)} crops verified against their reference, {len(snapped)} snapped.")
    return "\n".join([*table, "", *notes])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True, help="eval directory with truth.jsonl and predictions.jsonl")
    args = parser.parse_args()
    truth = {row["photo"]: row for row in map(json.loads, (args.out / "truth.jsonl").open()) if row.get("whole")}
    predictions = [p for p in map(json.loads, (args.out / "predictions.jsonl").open()) if p["photo"] in truth]
    print(report(predictions, truth))


if __name__ == "__main__":
    main()

import argparse
import json
from pathlib import Path

from benchmark import percentiles


def during_insert(samples, inserts):
    commits = [event for event in inserts if event["kind"] == "insert"]
    if not commits:
        return []
    start = commits[0]["at"] - commits[0]["rpcSeconds"]
    end = commits[-1]["at"]
    # Require the entire client call to lie inside the observed insert interval.
    return [sample for sample in samples
            if sample["at"] - sample["rpcMs"] / 1000 >= start and sample["at"] <= end]


def summarize(samples):
    result = {}
    for name in sorted({s["configuration"] for s in samples}):
        group = [s for s in samples if s["configuration"] == name]
        result[name] = {
            "samples": len(group),
            "searchMs": percentiles([s["searchMs"] for s in group]),
            "rpcMs": percentiles([s["rpcMs"] for s in group]),
            "uniqueObjects": percentiles([s["uniqueObjects"] for s in group]),
            "minUniqueObjects": min(s["uniqueObjects"] for s in group),
            "maxUniqueObjects": max(s["uniqueObjects"] for s in group),
            "missingDocuments": sum(s["missingDocuments"] for s in group),
            "wrongVersions": sum(s["wrongVersions"] for s in group),
            "missedExpectedObjects": sum(s["expectedObjectFound"] is False for s in group),
            "multiviewQueries": sum(s["queryKind"] == "multiview" for s in group),
        }
    return result


def read_events(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def main():
    parser = argparse.ArgumentParser(description="Recompute summaries from preserved raw search samples.")
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    result = {}
    for path in sorted(args.directory.glob("*.jsonl")):
        samples = [event for event in read_events(path) if event.get("kind") == "search"]
        if not samples:
            continue
        result[path.name] = summarize(samples)
        inserts_path = path.with_name(path.name + ".inserts.jsonl")
        if inserts_path.exists():
            result[path.name + ":during-insert"] = summarize(during_insert(samples, read_events(inserts_path)))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

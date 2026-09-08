import json
import statistics

from common import RESULTS, charged_total, write_json


def main():
    reviews = json.loads((RESULTS / "reviews.json").read_text())["cases"]
    records = {
        path.stem: json.loads(path.read_text())
        for path in RESULTS.glob("*.json")
        if path.stem.startswith(("right-now-", "empty-", "verify-", "map-", "crawl-"))
    }
    assert all(record["status"] == "complete" for record in records.values())
    groups = {}
    for mode in ("filter", "boost", "none"):
        rows = {
            name: record
            for name, record in records.items()
            if name.startswith("right-now-") and record["context"]["mode"] == mode
        }
        groups[mode] = {
            "calls": len(rows),
            "nonempty_answers": sum(r["metrics"]["answer_present"] for r in rows.values()),
            "on_topic": sum(reviews[name]["on_topic"] for name in rows),
            "answer_chars_min_median_max": [
                min(r["metrics"]["answer_chars"] for r in rows.values()),
                statistics.median(r["metrics"]["answer_chars"] for r in rows.values()),
                max(r["metrics"]["answer_chars"] for r in rows.values()),
            ],
            "top_date_in_window": sum(r["metrics"]["top_in_window"] is True for r in rows.values()),
            "outside_domain_results": sum(
                r["metrics"]["outside_domains"] or 0 for r in rows.values()
            )
            if mode != "none"
            else None,
            "results": sum(r["metrics"]["result_count"] for r in rows.values()),
        }
    summary = {
        "request_count": len(records),
        "search_count": sum(r["endpoint"] == "search" for r in records.values()),
        "map_count": sum(r["endpoint"] == "map" for r in records.values()),
        "crawl_count": sum(r["endpoint"] == "crawl" for r in records.values()),
        "reported_credits": sum(r["reported_credits"] for r in records.values()),
        "budget_charge": charged_total(RESULTS),
        "right_now": groups,
    }
    write_json(RESULTS / "summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

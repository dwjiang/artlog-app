import argparse
from concurrent.futures import ThreadPoolExecutor

from benchmark import client, delete_version, log, run_searches, seed_rows, stats


def main():
    parser = argparse.ArgumentParser(description="Time vectorSearch inside Convex actions, preserving raw samples.")
    parser.add_argument("--rows", type=int, required=True, help="Number of v1 rows already inserted")
    parser.add_argument("--runs", type=int, default=200, help="Calls per configuration, excluding warmup")
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20260908)
    parser.add_argument("--output", required=True)
    parser.add_argument("--migration", action="store_true", help="Concurrently insert equally sized v2, then delete it")
    args = parser.parse_args()
    connection = client()
    state = stats(connection)
    v1 = next(s for s in state if s["modelVersion"] == "v1")
    if v1["count"] != args.rows or v1["seed"] != args.seed or v1["deleting"]:
        raise ValueError("v1 dataset does not match --rows and --seed")
    if args.migration:
        v2 = next(s for s in state if s["modelVersion"] == "v2")
        if v2["nextRow"] != 0 or v2["deleting"]:
            raise ValueError("Migration requires a fresh v2")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(seed_rows, client(), args.rows, "v2", args.seed, 250, args.output + ".inserts.jsonl")
            run_searches(connection, args.rows, args.seed, args.runs, args.warmup, args.output)
            future.result()
        run_searches(connection, args.rows, args.seed, args.runs, args.warmup, args.output + ".doubled.jsonl")
        delete_version(connection, "v2", args.output + ".deletes.jsonl")
        # Query only the deleted version to distinguish search consistency from hydration races.
        from benchmark import row
        result = connection.action("bench:search", {"vector": row(args.seed, 98, "v1")["vector"],
                                                      "versions": ["v2"], "limit": 32})
        log(args.output + ".deletes.jsonl", {"kind": "deleted_version_search", "results": result["results"]})
        if result["results"]:
            raise RuntimeError("Deleted version still returned search results")
        run_searches(connection, args.rows, args.seed, args.runs, args.warmup, args.output + ".after-delete.jsonl")
    else:
        run_searches(connection, args.rows, args.seed, args.runs, args.warmup, args.output)


if __name__ == "__main__":
    main()

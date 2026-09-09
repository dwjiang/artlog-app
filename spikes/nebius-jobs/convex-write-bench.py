import argparse
import json
import os
import sys
import time
from uuid import uuid4


ROW_BYTES = 12 * 1024
BATCH_SIZES = (200, 500, 1000)
TOTAL_ROWS = 10_000


def benchmark(client, batch_size, total_rows=TOTAL_ROWS, clock=time.perf_counter):
    if batch_size not in BATCH_SIZES or total_rows < 1:
        raise ValueError("Expected batch size 200, 500, or 1000 and a positive row count")
    run_id = str(uuid4())
    payload = b"x" * ROW_BYTES
    committed = 0
    started = clock()
    try:
        for offset in range(0, total_rows, batch_size):
            rows = [
                {"ordinal": i, "payload": payload}
                for i in range(offset, min(offset + batch_size, total_rows))
            ]
            # No retries: an ambiguous transport failure must not inflate the count.
            inserted = client.mutation("spikeJobs:insertBatch", {"runId": run_id, "rows": rows})
            if inserted != len(rows):
                raise RuntimeError("Mutation did not acknowledge the whole batch")
            committed += inserted
    except Exception as error:
        elapsed = clock() - started
        # Client errors can contain request data; never log their raw text.
        message = str(error).lower()
        size_error = any(s in message for s in ("too large", "exceeds the size", "bytes limit"))
        return {
            "run_id": run_id, "batch_size": batch_size, "payload_bytes_per_row": ROW_BYTES,
            "requested_rows": total_rows, "acknowledged_rows": committed,
            "seconds": elapsed, "status": "failed",
            "error_kind": "size_limit" if size_error else "mutation_failure",
        }
    elapsed = clock() - started
    return {
        "run_id": run_id, "batch_size": batch_size, "payload_bytes_per_row": ROW_BYTES,
        "requested_rows": total_rows, "acknowledged_rows": committed,
        "seconds": elapsed, "rows_per_second": committed / elapsed if elapsed > 0 else None,
        "status": "completed",
    }


def main():
    parser = argparse.ArgumentParser(description="Write 10,000 scratch rows per batch size")
    parser.add_argument("--dry-run", action="store_true", help="Print workload sizes without connecting")
    args = parser.parse_args()
    if args.dry_run:
        for size in BATCH_SIZES:
            print(json.dumps({"batch_size": size, "rows": TOTAL_ROWS,
                              "payload_bytes_per_row": ROW_BYTES,
                              "payload_bytes_per_mutation": size * ROW_BYTES}))
        return 0

    url = os.environ.get("CONVEX_URL")
    key = os.environ.get("CONVEX_DEPLOY_KEY", "")
    if not url or not key.startswith("dev:"):
        parser.error("Set CONVEX_URL and a personal dev CONVEX_DEPLOY_KEY (dev: prefix required)")

    from convex import ConvexClient

    client = ConvexClient(url)
    client.set_admin_auth(key)
    failed = False
    for size in BATCH_SIZES:
        result = benchmark(client, size)
        print(json.dumps(result), flush=True)
        failed |= result["status"] != "completed"
        if result.get("error_kind") == "mutation_failure":
            break
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())

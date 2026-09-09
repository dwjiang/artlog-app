import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest


script = Path(__file__).with_name("convex-write-bench.py")
spec = importlib.util.spec_from_file_location("bench", script)
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


class ScratchTable:
    def __init__(self, fail_after=None, error="too large"):
        self.rows = []
        self.batch_lengths = []
        self.fail_after = fail_after
        self.error = error

    def mutation(self, name, args):
        if self.fail_after is not None and len(self.rows) >= self.fail_after:
            raise RuntimeError(self.error)
        self.batch_lengths.append(len(args["rows"]))
        self.rows.extend((args["runId"], row) for row in args["rows"])
        return len(args["rows"])


class BenchmarkTest(unittest.TestCase):
    def test_each_size_inserts_exactly_ten_thousand_twelve_kib_payloads(self):
        for size in bench.BATCH_SIZES:
            with self.subTest(size=size):
                table = ScratchTable()
                times = iter((10, 15))
                result = bench.benchmark(table, size, clock=lambda: next(times))
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["acknowledged_rows"], 10_000)
                self.assertEqual(result["rows_per_second"], 2000)
                self.assertEqual(len(table.batch_lengths), 10_000 // size)
                self.assertEqual([row["ordinal"] for _, row in table.rows], list(range(10_000)))
                self.assertEqual({len(row["payload"]) for _, row in table.rows}, {12 * 1024})

    def test_partial_final_batch_and_distinct_run_ids(self):
        table = ScratchTable()
        first = bench.benchmark(table, 200, total_rows=201)
        second = bench.benchmark(table, 200, total_rows=1)
        self.assertEqual(table.batch_lengths, [200, 1, 1])
        self.assertNotEqual(first["run_id"], second["run_id"])

    def test_failed_batch_is_not_counted_or_retried(self):
        table = ScratchTable(fail_after=200)
        result = bench.benchmark(table, 200, total_rows=500)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_kind"], "size_limit")
        self.assertEqual(result["acknowledged_rows"], 200)
        self.assertNotIn("rows_per_second", result)
        self.assertEqual(table.batch_lengths, [200])

    def test_error_details_cannot_leak_into_results(self):
        table = ScratchTable(fail_after=0, error="private request content")
        result = bench.benchmark(table, 200)
        self.assertEqual(result["error_kind"], "mutation_failure")
        self.assertNotIn("private request content", json.dumps(result))

    def test_dry_run_needs_no_credentials_or_python_client(self):
        result = subprocess.run([sys.executable, str(script), "--dry-run"],
                                capture_output=True, text=True, env={}, check=True)
        workloads = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([w["payload_bytes_per_mutation"] for w in workloads],
                         [2_457_600, 6_144_000, 12_288_000])

    def test_missing_or_production_credentials_refuse_writes(self):
        for key in ("", "prod:example|not-a-key"):
            result = subprocess.run([sys.executable, str(script)], capture_output=True,
                                    text=True, env={"CONVEX_URL": "https://example.invalid",
                                                    "CONVEX_DEPLOY_KEY": key})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("personal dev", result.stderr)
            if key:
                self.assertNotIn(key, result.stderr)


if __name__ == "__main__":
    unittest.main()

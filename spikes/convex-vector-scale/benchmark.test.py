import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from benchmark import percentiles, row, seed_rows, size_rejection
from summarize import during_insert


class BenchmarkTest(unittest.TestCase):
    def test_rows_are_normalized_deterministic_and_one_percent_multiview(self):
        rows = [row(7, i, "v1") for i in range(200)]
        self.assertEqual(rows[0], row(7, 0, "v1"))
        self.assertEqual(sum(r["source"] == "alternate" for r in rows), 2)
        self.assertEqual(len({r["objectId"] for r in rows}), 198)
        np.testing.assert_allclose([np.linalg.norm(r["vector"]) for r in rows], 1)
        self.assertGreater(np.dot(rows[98]["vector"], rows[99]["vector"]), 0.999)
        self.assertNotEqual(rows[0]["vector"], row(8, 0, "v1")["vector"])

    def test_percentiles_use_interpolation(self):
        self.assertEqual(percentiles([0, 10, 20, 30, 40]), {"p50": 20, "p95": 38, "p99": 39.6})
        self.assertIsNone(percentiles([]))

    def test_migration_summary_excludes_calls_crossing_insert_boundaries(self):
        samples = [{"at": at, "rpcMs": 1000} for at in [9, 10, 11, 19, 20, 21]]
        inserts = [{"kind": "insert", "at": 12, "rpcSeconds": 2},
                   {"kind": "insert", "at": 20, "rpcSeconds": 2}]
        self.assertEqual([s["at"] for s in during_insert(samples, inserts)], [11, 19, 20])
        self.assertEqual(during_insert(samples, []), [])

    def test_halves_only_size_failures_and_retries_same_range(self):
        class FakeClient:
            attempts = []

            def query(self, *_):
                return [{"modelVersion": "v1", "seed": 7, "nextRow": 2, "deleting": False}]

            def mutation(self, _, args):
                self.attempts.append((args["start"], len(args["rows"])))
                if len(args["rows"]) > 2:
                    raise RuntimeError("Request body too large")
                return {"inserted": len(args["rows"]), "nextRow": args["start"] + len(args["rows"])}

        connection = FakeClient()
        with tempfile.TemporaryDirectory() as directory, patch("builtins.print"):
            result = seed_rows(connection, 6, "v1", 7, 4, directory + "/insert.jsonl")
        self.assertEqual(connection.attempts, [(2, 4), (2, 2), (4, 2)])
        self.assertEqual(result["finalBatch"], 2)
        self.assertFalse(size_rejection(RuntimeError("Unauthorized")))
        self.assertFalse(size_rejection(RuntimeError("Connection reset")))
        self.assertTrue(size_rejection(RuntimeError("400 BadJsonBody: length limit exceeded")))


if __name__ == "__main__":
    unittest.main()

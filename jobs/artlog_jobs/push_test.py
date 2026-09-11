import json

import pytest

from artlog_jobs.features import file_hash, read_jsonl
from artlog_jobs.push import BATCH_SIZES, MUTATIONS, STAGES, BatchSizeReduced, Corpus, run
from artlog_jobs.sources.fetch import write_json


class Writer:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail
        self.stored = {stage: set() for stage in STAGES}
        self.after_commit = False

    def query(self, name, args=None):
        if name == "ingest:counts":
            return {"museums": 1, **{s: len(self.stored[s]) for s in STAGES[:-1]}}
        if name == "ingest:countExisting":
            return sum(
                json.dumps(row, sort_keys=True) in self.stored[args["table"]]
                for row in args["rows"]
            )
        if name == "ingest:auditThumbnails":
            return {
                "checked": len(self.stored["objects"]),
                "violations": 0,
                "isDone": True,
                "continueCursor": "",
            }
        raise AssertionError(name)

    def mutation(self, name, args):
        stage = next(s for s in STAGES if name == f"ingest:{MUTATIONS[s]}")
        self.calls.append((stage, args["rows"]))
        if self.fail == stage and not self.after_commit:
            self.fail = None
            raise RuntimeError("connection lost")
        ids = {
            json.dumps(Corpus.identity(stage, row), sort_keys=True): "id" for row in args["rows"]
        }
        self.stored[stage].update(ids)
        if self.fail == stage:
            self.fail = None
            raise RuntimeError("response lost after commit")
        return {"ids": ids}


def push(directory, writer, checkpoint=None):
    return run(
        Corpus(directory),
        writer,
        checkpoint=checkpoint or directory / "push.json",
        deployment_url="https://dev.test",
    )


def test_order_batches_metadata_without_vectors_and_multiview(merged_corpus):
    directory = merged_corpus(1002)
    writer = Writer()
    result = push(directory, writer)
    assert list(dict.fromkeys(s for s, _ in writer.calls)) == list(STAGES)
    assert all(len(rows) <= BATCH_SIZES[stage] for stage, rows in writer.calls)
    assert max(len(rows) for stage, rows in writer.calls if stage == "vectors") == 250
    assert result["countsMatch"]
    assert result["actual"] == {
        "museums": 1,
        "artworks": 1002,
        "objects": 1003,
        "placements": 1002,
        "vectors": 1002,
        "descriptors": 1001,
    }
    rows = [r for stage, rows in writer.calls if stage == "vectors" for r in rows]
    views = [r for r in rows if r["objectKey"] == "met:0"]
    assert {r["viewKey"] for r in views} == {"met:0", "wikidata:Q1"}
    assert {r["source"] for r in views} == {"corpus"}
    assert all(len(r["vector"]) == 1536 for r in rows)
    objects = [r for s, rows in writer.calls if s == "objects" for r in rows]
    assert any(r["key"] == "met:1001" for r in objects)
    assert objects[-1]["mergedIntoKey"] == "met:0"


@pytest.mark.parametrize("after_commit", [False, True])
def test_resume_after_failure_or_lost_response_is_idempotent(merged_corpus, after_commit):
    directory = merged_corpus()
    writer = Writer(fail="vectors")
    writer.after_commit = after_commit
    with pytest.raises(RuntimeError):
        push(directory, writer)
    before = len(writer.calls)
    report = push(directory, writer)
    assert report["countsMatch"]
    assert writer.calls[before][0] == "vectors"
    before = len(writer.calls)
    push(directory, writer)
    assert len(writer.calls) == before


def test_existing_rows_are_accounted_for_before_mutations(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    push(directory, writer)
    report = push(directory, writer, directory / "second-push.json")
    assert report["countsMatch"]
    assert report["expected"] == writer.query("ingest:counts")


def test_changed_inputs_or_destination_cannot_reuse_checkpoint(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    push(directory, writer)
    with pytest.raises(ValueError, match="different inputs or deployment"):
        run(
            Corpus(directory),
            writer,
            checkpoint=directory / "push.json",
            deployment_url="https://other.test",
        )
    with pytest.raises(ValueError, match="different inputs or deployment"):
        run(
            Corpus(directory, limit=1),
            writer,
            checkpoint=directory / "push.json",
            deployment_url="https://dev.test",
        )
    with (directory / "objects.jsonl").open("a") as body:
        body.write("{}\n")
    with pytest.raises(ValueError, match="Merged input changed"):
        Corpus(directory)


def test_rights_gate_runs_before_any_write(merged_corpus):
    directory = merged_corpus()
    path = directory / "artworks.jsonl"
    path.write_text(path.read_text().replace('"public_domain"', '"unknown"'))
    stats = json.loads((directory / "stats.json").read_text())
    stats["files"]["artworks.jsonl"] = file_hash(path)
    write_json(directory / "stats.json", stats)
    summary = json.loads((directory / "penalties.summary.json").read_text())
    summary["inputFiles"] = stats["files"]
    write_json(directory / "penalties.summary.json", summary)
    with pytest.raises(ValueError, match="Non-public-domain thumbnail"):
        Corpus(directory)


def test_size_error_halves_persisted_batch_and_stops(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    original = writer.mutation

    def mutation(name, args):
        if name == "ingest:upsertVectors":
            raise RuntimeError("BadJsonBody: length limit exceeded")
        return original(name, args)

    writer.mutation = mutation
    with pytest.raises(BatchSizeReduced, match="250 to 125"):
        push(directory, writer)
    state = json.loads((directory / "push.json").read_text())
    assert state["batchSizes"]["vectors"] == 125
    assert state["stages"]["vectors"]["offset"] == 0
    writer.mutation = original
    assert push(directory, writer)["countsMatch"]


def test_dedupe_rekeys_placements_keeps_audit_and_source_bytes(merged_corpus):
    directory = merged_corpus()
    assert read_jsonl(directory / "merges.jsonl") == [
        {"from": "wikidata:Q1", "into": "met:0", "rule": "accession"}
    ]
    assert all(r["objectKey"] != "wikidata:Q1" for r in read_jsonl(directory / "placements.jsonl"))
    corpus = Corpus(directory)
    descriptors = corpus.batch("descriptors", 0, 10)
    assert len(descriptors) == 2
    assert descriptors[0]["descriptors"] == bytes(32)
    assert descriptors[0]["keypoints"] == bytes(16)


def test_full_push_requires_completed_feature_build_but_smoke_can_proceed(merged_corpus):
    directory = merged_corpus()
    path = directory / "stats.json"
    stats = json.loads(path.read_text())
    stats["completeFeatures"] = False
    write_json(path, stats)
    with pytest.raises(ValueError, match="requires all feature shards"):
        Corpus(directory)
    assert Corpus(directory, limit=1).rows["vectors"]


def test_system_operation_timeout_reduces_batch_and_replays_without_skipping(merged_corpus):
    directory = merged_corpus(502)
    writer = Writer()
    original = writer.mutation
    attempts = []

    def mutation(name, args):
        if name == "ingest:upsertObjects":
            attempts.append(len(args["rows"]))
            if len(args["rows"]) > 250:
                raise RuntimeError("Your request timed out performing too many system operations.")
        return original(name, args)

    writer.mutation = mutation
    result = push(directory, writer)
    assert attempts == [500, 250, 250, 3]
    assert result["countsMatch"]
    assert result["stages"]["objects"]["batchSize"] == 250

import json

import pytest

from artlog_jobs.features import file_hash, read_jsonl, write_jsonl
from artlog_jobs.push import (
    BATCH_SIZES,
    DEFAULT_CORPUS_LIMIT,
    FUNCTIONS,
    STAGES,
    BatchSizeReduced,
    Corpus,
    main,
    run,
    select_objects,
)
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

    def action(self, name, args):
        assert name == "ingest:upsertDescriptors"
        return self._write(name, args)

    def mutation(self, name, args):
        assert name != "ingest:upsertDescriptors"
        return self._write(name, args)

    def _write(self, name, args):
        stage = next(s for s in STAGES if name == f"ingest:{FUNCTIONS[s]}")
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


def test_small_selection_is_stable_balanced_and_has_no_duplicate_survivors():
    keys = [f"{source}:{i}" for source in ("aic", "met", "wikidata") for i in range(100)]
    selected = select_objects(keys + keys[:5], 30)
    assert selected == select_objects(list(reversed(keys)), 30)
    assert len(selected) == 30
    assert all(
        sum(key.startswith(source + ":") for key in selected) == 10
        for source in ("aic", "met", "wikidata")
    )
    assert select_objects(keys, 15) <= selected
    assert select_objects(["met:1", "wikidata:1", "wikidata:2"], 10) == {
        "met:1",
        "wikidata:1",
        "wikidata:2",
    }


def test_small_corpus_keeps_views_merge_targets_and_all_references(merged_corpus):
    corpus = Corpus(merged_corpus(), limit=2)
    assert {row["key"] for row in corpus.rows["objects"]} == {"met:0", "met:1", "wikidata:Q1"}
    assert {row["viewKey"] for row in corpus.rows["vectors"]} == {"met:0", "met:1", "wikidata:Q1"}
    assert {row["key"] for row in corpus.rows["artworks"]} == {"art:0", "art:1"}
    for stage in ("placements", "descriptors", "penalties"):
        assert all(row["objectKey"] in corpus.objects for row in corpus.rows[stage])
    plan = corpus.plan()
    assert plan["selectedSurvivors"] == ["met:0", "met:1"]
    assert plan["requiredVenueKeys"] == ["museum:1"]
    assert plan["featureBytes"] == {
        "embeddingsFloat32": 3 * 1536 * 4,
        "embeddingsFloat64": 3 * 1536 * 8,
        "orb": 2 * 48,
    }


def test_dry_run_defaults_to_small_corpus_without_credentials_or_network(
    merged_corpus, monkeypatch, capsys
):
    from artlog_jobs import push as module

    directory = merged_corpus(1002)
    (directory / "penalties.jsonl").unlink()
    (directory / "penalties.summary.json").unlink()
    monkeypatch.setattr(module, "get_settings", lambda: pytest.fail("dry run read settings"))
    monkeypatch.setattr(module, "ConvexWriter", lambda *_: pytest.fail("dry run connected"))
    main(["--in", str(directory), "--dry-run"])
    plan = json.loads(capsys.readouterr().out)
    assert plan["limit"] == DEFAULT_CORPUS_LIMIT == 1000
    assert len(plan["selectedSurvivors"]) == 1000
    assert plan["hubPenalty"] == 0
    assert plan["inputCounts"]["penalties"] == plan["inputCounts"]["objects"]
    assert not list(directory.glob("push*.json"))
    main(["--in", str(directory), "--full", "--dry-run"])
    assert json.loads(capsys.readouterr().out)["inputCounts"]["objects"] == 1003


def test_export_is_self_contained_preserves_bytes_and_uploads_through_existing_contract(
    merged_corpus, tmp_path, monkeypatch, capsys
):
    from artlog_jobs import push as module

    directory = merged_corpus()
    (directory / "penalties.jsonl").unlink()
    (directory / "penalties.summary.json").unlink()
    source = Corpus(directory, limit=2)
    expected = {stage: source.batch(stage, 0, 100) for stage in STAGES}
    source_hashes = {p.name: file_hash(p) for p in directory.iterdir() if p.is_file()}
    out = tmp_path / "small-corpus"
    monkeypatch.setattr(module, "get_settings", lambda: pytest.fail("export read settings"))
    monkeypatch.setattr(module, "ConvexWriter", lambda *_: pytest.fail("export connected"))
    main(["--in", str(directory), "--limit", "2", "--export", str(out)])
    report = json.loads(capsys.readouterr().out)
    assert report["inputCounts"]["vectors"] == 3
    assert source_hashes == {p.name: file_hash(p) for p in directory.iterdir() if p.is_file()}
    # The exported artifact must remain usable when the large source is unavailable.
    directory.rename(tmp_path / "source-unavailable")
    restored = Corpus(out, limit=DEFAULT_CORPUS_LIMIT)
    assert {stage: restored.batch(stage, 0, 100) for stage in STAGES} == expected
    assert restored.rows["penalties"] == [
        {"objectKey": row["key"], "calibratorPenalty": 0} for row in restored.rows["objects"]
    ]
    assert not list(out.glob("penalties*"))
    assert all(not p.is_symlink() for p in out.iterdir())
    writer = Writer()
    report = run(
        restored, writer, checkpoint=out / "test-push.json", deployment_url="https://dev.test"
    )
    assert report["countsMatch"]
    assert report["actual"]["objects"] == 3
    assert report["actual"]["descriptors"] == 2
    assert [row for stage, rows in writer.calls if stage == "penalties" for row in rows] == (
        restored.rows["penalties"]
    )
    with pytest.raises(ValueError, match="requires all feature shards"):
        Corpus(out)
    (out / "descriptors-0.bin").write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="Merged input changed"):
        Corpus(out, limit=DEFAULT_CORPUS_LIMIT)


def test_deferred_hubs_ignore_old_penalty_artifacts(merged_corpus):
    directory = merged_corpus()
    original = Corpus(directory)
    write_jsonl(
        directory / "penalties.jsonl",
        [{"objectKey": "met:0", "calibratorPenalty": 0.5}],
    )
    (directory / "penalties.summary.json").write_text("stale summary")
    corpus = Corpus(directory)
    assert corpus.fingerprint == original.fingerprint
    assert corpus.rows["penalties"] == [
        {"objectKey": row["key"], "calibratorPenalty": 0} for row in corpus.rows["objects"]
    ]


def test_export_refuses_to_overwrite_an_existing_directory(merged_corpus, tmp_path):
    from artlog_jobs.subset import export

    directory = merged_corpus()
    corpus = Corpus(directory, limit=2)
    for out in (directory, tmp_path / "existing"):
        out.mkdir(exist_ok=True)
        with pytest.raises(FileExistsError):
            export(corpus, out)


@pytest.mark.parametrize(
    "flags",
    [
        ["--limit", "0"],
        ["--limit", "-1"],
        ["--limit", "5", "--full"],
        ["--full", "--export", "sample"],
    ],
)
def test_invalid_corpus_options_fail_before_loading_any_data(flags):
    with pytest.raises(SystemExit) as error:
        main(["--in", "not-a-corpus", *flags])
    assert error.value.code == 2


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
@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_resume_after_failure_or_lost_response_is_idempotent(merged_corpus, after_commit, stage):
    directory = merged_corpus()
    writer = Writer(fail=stage)
    writer.after_commit = after_commit
    with pytest.raises(RuntimeError):
        push(directory, writer)
    before = len(writer.calls)
    report = push(directory, writer)
    assert report["countsMatch"]
    assert writer.calls[before][0] == stage
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

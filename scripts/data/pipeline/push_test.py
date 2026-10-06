import json

import pytest

from pipeline.features import file_hash, read_jsonl, write_jsonl
from pipeline.model_version import EMBEDDING_DIM
from pipeline.push import (
    BATCH_SIZES,
    DEFAULT_CORPUS_LIMIT,
    FUNCTIONS,
    STAGES,
    BatchSizeReduced,
    Corpus,
    main,
    run,
    sample_indices,
    select_objects,
)
from pipeline.sources.fetch import write_json


class Writer:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail
        self.stored = {stage: set() for stage in STAGES}
        self.values = {stage: {} for stage in STAGES}
        self.readbacks = []
        self.after_commit = False

    def query(self, name, args=None):
        if name == "vectorSync:status":
            return {"ready": True, "failed": False}
        if name == "ingest:counts":
            return {"museums": 1, **{s: len(self.stored[s]) for s in STAGES[:-1]}}
        if name == "ingest:countExisting":
            return sum(
                json.dumps(row, sort_keys=True) in self.stored[args["table"]]
                for row in args["rows"]
            )
        if name == "ingest:auditThumbnails":
            return {
                "checked": len(args["objectKeys"]),
                "violations": 0,
                "isDone": True,
                "continueCursor": "",
            }
        raise AssertionError(name)

    def action(self, name, args):
        if name == "vectorSync:configuration":
            return {"host": "test.pinecone.io", "namespace": "recognition"}
        if name == "vectorSync:verifyCorpus":
            return True
        if name == "ingest:readSample":
            self.readbacks.append(args)
            return [
                self.values[args["table"]].get(json.dumps(row, sort_keys=True))
                for row in args["rows"]
            ]
        assert name in {"ingest:upsertDescriptors", "ingest:upsertVectors"}
        return self._write(name, args)

    def mutation(self, name, args):
        assert name not in {"ingest:upsertDescriptors", "ingest:upsertVectors"}
        return self._write(name, args)

    def ingest_features(self, name, args):
        return self.action(name, args)

    def ingest_feature_batches(self, name, batches):
        for batch in batches:
            yield len(batch), self.action(name, {"rows": batch})

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
        self.values[stage].update(
            {json.dumps(Corpus.identity(stage, row), sort_keys=True): row for row in args["rows"]}
        )
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
        "embeddingsFloat32": 3 * EMBEDDING_DIM * 4,
        "embeddingsFloat64": 3 * EMBEDDING_DIM * 8,
        "orb": 2 * 48,
    }


def test_dry_run_defaults_to_small_corpus_without_credentials_or_network(
    merged_corpus, monkeypatch, capsys
):
    from pipeline import push as module

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
    from pipeline import push as module

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
    from pipeline.subset import export

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
        ["--verify-fraction", "0"],
        ["--verify-fraction", "nan"],
        ["--verify-fraction", "1.1"],
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
    assert max(len(rows) for stage, rows in writer.calls if stage == "vectors") == 100
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
    assert all(len(r["vector"]) == EMBEDDING_DIM for r in rows)
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
    with pytest.raises(ValueError, match="different inputs, deployment, or Pinecone index"):
        run(
            Corpus(directory),
            writer,
            checkpoint=directory / "push.json",
            deployment_url="https://other.test",
        )
    with pytest.raises(ValueError, match="different inputs, deployment, or Pinecone index"):
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
    original = writer.action

    def action(name, args):
        if name == "ingest:upsertVectors":
            raise RuntimeError("BadJsonBody: length limit exceeded")
        return original(name, args)

    writer.action = action
    with pytest.raises(BatchSizeReduced, match="100 to 50"):
        push(directory, writer)
    state = json.loads((directory / "push.json").read_text())
    assert state["batchSizes"]["vectors"] == 50
    assert state["stages"]["vectors"]["offset"] == 0
    writer.action = original
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


@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_stream_checkpoints_each_commit_and_resumes_at_the_first_unacknowledged_row(
    merged_corpus, stage
):
    directory = merged_corpus(502)
    writer = Writer()
    original = writer.action
    batches = 0

    def action(name, args):
        nonlocal batches
        if name == f"ingest:{FUNCTIONS[stage]}":
            batches += 1
            if batches == 3:
                raise RuntimeError("connection lost")
        return original(name, args)

    writer.action = action
    with pytest.raises(RuntimeError, match="connection lost"):
        push(directory, writer)
    state = json.loads((directory / "push.json").read_text())
    assert state["stages"][stage]["offset"] == len(writer.stored[stage]) == 200
    before = len(writer.calls)
    writer.action = original
    assert push(directory, writer)["countsMatch"]
    assert writer.calls[before] == (stage, Corpus(directory).batch(stage, 200, 100))


def test_readback_samples_each_source_and_does_not_repeat_on_resume(merged_corpus):
    directory = merged_corpus(1002)
    corpus = Corpus(directory)
    writer = Writer()
    report = push(directory, writer)
    assert report["readback"]["matches"]
    assert report["readback"]["stages"]["vectors"]["checked"] < 30
    assert {
        corpus.rows["vectors"][i]["viewKey"].split(":")[0]
        for i in sample_indices(corpus, "vectors", 0.02)
    } == {"met", "wikidata"}
    assert all(len(call["rows"]) <= 32 for call in writer.readbacks)
    before = len(writer.readbacks)
    push(directory, writer)
    assert len(writer.readbacks) == before
    full = run(
        corpus,
        writer,
        checkpoint=directory / "push.json",
        deployment_url="https://dev.test",
        verify_fraction=1,
    )
    assert full["readback"]["stages"]["vectors"]["checked"] == len(corpus.rows["vectors"])


@pytest.mark.parametrize("stage", STAGES)
def test_readback_detects_corruption_without_rewriting_on_resume(merged_corpus, stage):
    directory = merged_corpus()
    writer = Writer()
    push(directory, writer)
    state = json.loads((directory / "push.json").read_text())
    state.pop("verification")
    write_json(directory / "push.json", state)
    writer.values[stage].clear()
    before = len(writer.calls)
    with pytest.raises(RuntimeError, match="Import audit failed"):
        push(directory, writer)
    assert len(writer.calls) == before
    assert not json.loads((directory / "push.report.json").read_text())["readback"]["matches"]
    assert "verification" not in json.loads((directory / "push.json").read_text())


def test_pinecone_destination_cannot_reuse_checkpoint(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    push(directory, writer)
    original = writer.action
    writer.action = lambda name, args: (
        {"host": "another.pinecone.io", "namespace": "recognition"}
        if name == "vectorSync:configuration"
        else original(name, args)
    )
    with pytest.raises(ValueError, match="Pinecone index"):
        push(directory, writer)


def test_pinecone_sync_failure_does_not_complete_import(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    original = writer.query
    writer.query = lambda name, args=None: (
        {"ready": False, "failed": True} if name == "vectorSync:status" else original(name, args)
    )
    with pytest.raises(RuntimeError, match="failed jobs"):
        push(directory, writer)


def test_preflight_overlaps_reads_and_finishes_before_first_write(merged_corpus):
    from threading import Barrier, Lock

    directory = merged_corpus(2002)
    writer = Writer()
    original = writer.query
    ready = Barrier(4, timeout=3)
    lock = Lock()
    queries = []

    def query(name, args=None):
        if name == "ingest:countExisting" and args["table"] == "artworks":
            with lock:
                queries.append(args["rows"])
                first_window = len(queries) <= 4
            if first_window:
                ready.wait()
            assert writer.calls == [], "Import started before preflight completed"
        return original(name, args)

    writer.query = query
    assert push(directory, writer)["countsMatch"]
    assert len(queries) == 5


def test_preflight_failure_checkpoints_only_contiguous_success_and_resumes(merged_corpus):
    directory = merged_corpus(2002)
    corpus = Corpus(directory)
    writer = Writer()
    original = writer.query
    failed_key = corpus.rows["artworks"][500]["key"]

    def fail(name, args=None):
        if (
            name == "ingest:countExisting"
            and args["table"] == "artworks"
            and args["rows"][0]["key"] == failed_key
        ):
            raise RuntimeError("preflight interrupted")
        return original(name, args)

    writer.query = fail
    with pytest.raises(RuntimeError, match="preflight interrupted"):
        push(directory, writer)
    assert writer.calls == []
    state = json.loads((directory / "push.json").read_text())
    assert state["preflight"]["artworks"] == {"offset": 500, "existing": 0}
    resumed = []

    def query(name, args=None):
        if name == "ingest:countExisting" and args["table"] == "artworks":
            resumed.extend(row["key"] for row in args["rows"])
        return original(name, args)

    writer.query = query
    assert push(directory, writer)["countsMatch"]
    assert set(resumed) == {row["key"] for row in corpus.rows["artworks"][500:]}
    assert "preflight" not in json.loads((directory / "push.json").read_text())


def test_preflight_resume_refuses_changed_baseline_before_any_write(merged_corpus):
    directory = merged_corpus()
    writer = Writer()
    original = writer.query

    def fail(name, args=None):
        if name == "ingest:countExisting":
            raise RuntimeError("preflight interrupted")
        return original(name, args)

    writer.query = fail
    with pytest.raises(RuntimeError, match="preflight interrupted"):
        push(directory, writer)
    writer.query = original
    writer.stored["artworks"].add("unrelated new row")
    with pytest.raises(ValueError, match="baseline changed"):
        push(directory, writer)
    assert writer.calls == []


def test_additions_import_after_checking_the_imported_rows_they_point_at(delta_package, tmp_path):
    out, _ = delta_package()
    corpus = Corpus(out)
    assert corpus.referenced_rows() == {"objects": ["met:0"], "artworks": []}

    with pytest.raises(ValueError, match="Imported objects these additions point at are missing"):
        run(
            corpus,
            Writer(),
            checkpoint=tmp_path / "missing.json",
            deployment_url="https://dev.test",
        )

    writer = Writer()
    writer.stored["objects"].add(json.dumps({"key": "met:0"}, sort_keys=True))
    run(corpus, writer, checkpoint=tmp_path / "push.json", deployment_url="https://dev.test")
    written = {
        stage: [row for _, rows in writer.calls if _ == stage for row in rows] for stage in STAGES
    }
    assert [row["key"] for row in written["objects"]] == ["fng:2", "cma:1"]
    assert {row["viewKey"]: row["objectKey"] for row in written["vectors"]} == {
        "cma:1": "met:0",
        "fng:2": "fng:2",
    }


def test_a_sample_of_additions_needs_no_imported_rows(delta_package):
    out, _ = delta_package()
    corpus = Corpus(out, limit=5)
    assert corpus.referenced_rows() == {"objects": [], "artworks": []}
    assert [row["key"] for row in corpus.rows["objects"]] == ["fng:2"]

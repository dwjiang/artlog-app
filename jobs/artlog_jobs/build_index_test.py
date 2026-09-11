import argparse
import json
import shutil

import httpx
import pytest

from artlog_jobs.build_index import DriftCheckFailed, parse_stages, projection, run
from artlog_jobs.checkpoint import Checkpoint
from artlog_jobs.config import Settings
from artlog_jobs.download import (
    DownloadIncomplete,
    ImageTask,
    ShardState,
    SourceReport,
    download_shard,
    image_filename,
    iter_tasks,
)
from artlog_jobs.polite_http import PoliteClient


def settings_with_objects(tmp_path, count=25) -> Settings:
    settings = Settings(_env_file=None, scratch_dir=tmp_path)
    metadata = tmp_path / "metadata"
    metadata.mkdir()
    with (metadata / "objects.jsonl").open("w") as body:
        for index in range(count):
            key = f"met:{index}" if index % 2 else f"wikidata:Q{index}"
            body.write(json.dumps({"key": key, "imageRef": f"https://img.example/{index}"}) + "\n")
    return settings


class Recorder:
    def __init__(self, tmp_path, drift_passes=True, dtype="float16"):
        self.calls: list[tuple] = []
        self.drift_passes = drift_passes
        self.dtype = dtype
        self.fakequant = tmp_path / "fakequant.pt"
        self.fakequant.write_bytes(b"test weights")

    def download(self, shard, tasks, *, images_dir, state_dir, client_factory, **_):
        directory = images_dir / f"shard-{shard}"
        directory.mkdir(parents=True, exist_ok=True)
        state = ShardState(state_dir, shard)
        state.bind_inputs(tasks, directory)
        for task in tasks:
            (directory / image_filename(task.key)).write_bytes(b"jpeg")
        self.calls.append(("download", shard, len(tasks)))
        report = SourceReport(attempted=len(tasks), done=len(tasks), seconds=float(len(tasks)))
        for source in {task.source for task in tasks}:
            state.save_source(source, report, complete=True)
        state.finish({task.source: [] for task in tasks})
        return {"met": report, "wikidata": report}

    def embed(self, images_dir, out_dir, shard, embedder, *, batch_size, workers):
        assert images_dir.exists() and embedder == "embedder"
        self.calls.append(("embed", shard, len(list(images_dir.iterdir()))))
        return {
            "shard": shard,
            "images": 3,
            "vectors": 3,
            "seconds": 1.0,
            "device": "cpu",
            "dtype": self.dtype,
        }

    def drift(self, load, settings, *, dtype):
        self.calls.append(("drift", dtype))
        return {
            "passed": self.drift_passes,
            "mean": 0.997,
            "min": 0.993,
            "count": 200,
            "minMean": 0.99,
            "minMin": 0.97,
            "device": "mps",
            "dtype": self.dtype,
            "worst": [],
        }

    def load(self, dtype):
        self.calls.append(("load", dtype))
        return "embedder"

    def kwargs(self):
        return {
            "download": self.download,
            "embed": self.embed,
            "drift": self.drift,
            "load": self.load,
            "fakequant": self.fakequant,
        }


def test_each_shard_is_downloaded_then_embedded_then_deleted(tmp_path):
    settings = settings_with_objects(tmp_path)
    recorder = Recorder(tmp_path)

    summary = run(
        ["download", "drift", "embed"], settings=settings, shard_size=10, **recorder.kwargs()
    )

    assert recorder.calls == [
        ("drift", "auto"),
        ("download", 0, 10),
        ("load", "float16"),
        ("embed", 0, 10),
        ("download", 1, 10),
        ("embed", 1, 10),
        ("download", 2, 5),
        ("embed", 2, 5),
    ]
    assert not (tmp_path / "images").exists()
    checkpoint = Checkpoint.for_job(settings, "build_index")
    assert checkpoint.done_keys("embed") == {"shard-0", "shard-1", "shard-2"}
    manifest = json.loads((tmp_path / "features" / "manifest.json").read_text())
    assert manifest["driftCheck"]["passed"] and manifest["counts"]["shards"] == 3
    assert summary["shards"] == 3 and summary["projection"]["sources"]["met"]["objects"] == 12


def test_a_finished_shard_is_not_repeated_and_lost_images_are_refetched(tmp_path):
    settings = settings_with_objects(tmp_path)
    first = Recorder(tmp_path)
    run(["download", "embed"], settings=settings, shard_size=10, limit=20, **first.kwargs())
    checkpoint = Checkpoint.for_job(settings, "build_index")
    checkpoint.unmark("embed", ["shard-1"])
    second = Recorder(tmp_path)

    run(["download", "embed"], settings=settings, shard_size=10, limit=20, **second.kwargs())

    assert second.calls == [
        ("drift", "auto"),
        ("download", 1, 10),
        ("load", "float16"),
        ("embed", 1, 10),
    ]


def test_a_pilot_and_a_full_run_cannot_share_the_feature_directory(tmp_path):
    settings = settings_with_objects(tmp_path)
    run(
        ["download", "embed"],
        settings=settings,
        shard_size=10,
        limit=5,
        **Recorder(tmp_path).kwargs(),
    )
    manifest = json.loads((tmp_path / "features" / "manifest.json").read_text())
    assert manifest["limit"] == 5

    with pytest.raises(RuntimeError, match="different --limit"):
        run(["download", "embed"], settings=settings, shard_size=10, **Recorder(tmp_path).kwargs())
    assert Checkpoint.for_job(settings, "build_index").done_keys("embed") == {"shard-0"}


@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("stages", [["download", "embed"], ["drift"]])
def test_resume_rejects_changed_weights_before_reusing_or_certifying_features(
    tmp_path, completed, stages
):
    settings = settings_with_objects(tmp_path, count=20)
    first = Recorder(tmp_path)

    def download(shard, tasks, **kwargs):
        if shard == 1 and not completed:
            raise DownloadIncomplete("interrupted")
        return first.download(shard, tasks, **kwargs)

    try:
        run(
            ["download", "embed"],
            settings=settings,
            shard_size=10,
            **{**first.kwargs(), "download": download},
        )
    except DownloadIncomplete:
        assert not completed
    manifest = tmp_path / "features" / "manifest.json"
    checkpoint = Checkpoint.for_job(settings, "build_index").path
    before = manifest.read_bytes(), checkpoint.read_bytes()
    resumed = Recorder(tmp_path)
    resumed.fakequant.write_bytes(b"replacement weights")

    with pytest.raises(RuntimeError, match="weights"):
        run(stages, settings=settings, shard_size=10, **resumed.kwargs())

    assert resumed.calls == []
    assert (manifest.read_bytes(), checkpoint.read_bytes()) == before


def test_completed_features_need_a_saved_weights_hash(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download", "embed"], settings=settings, **Recorder(tmp_path).kwargs())
    path = tmp_path / "features" / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest.pop("fakequantSha256")
    path.write_text(json.dumps(manifest))
    resumed = Recorder(tmp_path)

    with pytest.raises(RuntimeError, match="weights"):
        run(["download", "embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == []
    assert json.loads(path.read_text()) == manifest


def test_resume_accepts_identical_weights_at_a_different_path(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    first = Recorder(tmp_path)
    run(["download", "embed"], settings=settings, **first.kwargs())
    copied_weights = tmp_path / "copied-weights.pt"
    shutil.copyfile(first.fakequant, copied_weights)
    resumed = Recorder(tmp_path)

    run(
        ["download", "embed"],
        settings=settings,
        **{**resumed.kwargs(), "fakequant": copied_weights},
    )

    assert resumed.calls == [("drift", "auto")]


@pytest.mark.parametrize("change", ["add", "remove", "image_url"])
def test_resume_rejects_changed_download_inputs_before_reusing_progress(tmp_path, change):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download", "embed"], settings=settings, **Recorder(tmp_path).kwargs())
    manifest = tmp_path / "features" / "manifest.json"
    checkpoint = Checkpoint.for_job(settings, "build_index").path
    before = manifest.read_bytes(), checkpoint.read_bytes()
    metadata = tmp_path / "metadata" / "objects.jsonl"
    rows = [json.loads(line) for line in metadata.read_text().splitlines()]
    if change == "add":
        rows.append({"key": "met:999", "imageRef": "https://img.example/new"})
    elif change == "remove":
        rows.pop()
    else:
        rows[0]["imageRef"] = "https://img.example/replacement"
    metadata.write_text("".join(json.dumps(row) + "\n" for row in rows))
    resumed = Recorder(tmp_path)

    with pytest.raises(RuntimeError, match="download inputs"):
        run(["download", "embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == []
    assert (manifest.read_bytes(), checkpoint.read_bytes()) == before


def test_resume_accepts_reordered_metadata_and_changes_unrelated_to_images(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download", "embed"], settings=settings, **Recorder(tmp_path).kwargs())
    metadata = tmp_path / "metadata" / "objects.jsonl"
    rows = [json.loads(line) for line in metadata.read_text().splitlines()]
    rows.reverse()
    rows[0]["title"] = "Corrected title"
    rows.append({"key": "met:999"})
    metadata.write_text("".join(json.dumps(row) + "\n" for row in rows))
    resumed = Recorder(tmp_path)

    run(["download", "embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == [("drift", "auto")]


@pytest.mark.parametrize("missing", ["fingerprint", "manifest"])
def test_resume_refuses_progress_without_a_download_fingerprint(tmp_path, missing):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download", "embed"], settings=settings, **Recorder(tmp_path).kwargs())
    path = tmp_path / "features" / "manifest.json"
    if missing == "manifest":
        path.unlink()
    else:
        manifest = json.loads(path.read_text())
        manifest.pop("downloadInputsSha256", None)
        path.write_text(json.dumps(manifest))
    resumed = Recorder(tmp_path)

    with pytest.raises(RuntimeError, match="download inputs"):
        run(["download", "embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == []


@pytest.mark.parametrize("stages", [["download", "drift", "embed"], ["download", "embed"]])
def test_drift_failure_aborts_before_any_download(tmp_path, stages):
    settings = settings_with_objects(tmp_path)
    recorder = Recorder(tmp_path, drift_passes=False)

    with pytest.raises(DriftCheckFailed):
        run(stages, settings=settings, **recorder.kwargs())

    assert recorder.calls == [("drift", "auto")]
    assert not (tmp_path / "images").exists()


def test_keep_images_needs_a_limit_and_keeps_the_pilot_shard(tmp_path):
    settings = settings_with_objects(tmp_path)
    with pytest.raises(ValueError):
        run(
            ["download", "embed"],
            settings=settings,
            keep_images=True,
            **Recorder(tmp_path).kwargs(),
        )

    run(
        ["download", "embed"],
        settings=settings,
        keep_images=True,
        limit=5,
        **Recorder(tmp_path).kwargs(),
    )
    assert len(list((tmp_path / "images" / "shard-0").iterdir())) == 5

    run(["cleanup"], settings=settings, **Recorder(tmp_path).kwargs())
    assert not (tmp_path / "images").exists()


def test_resume_rejects_changed_shard_size_before_skipping_objects(tmp_path):
    settings = settings_with_objects(tmp_path)
    first = Recorder(tmp_path)

    def interrupted_download(shard, tasks, **kwargs):
        if shard == 1:
            raise RuntimeError("interrupted")
        return first.download(shard, tasks, **kwargs)

    with pytest.raises(RuntimeError, match="interrupted"):
        run(
            ["download", "embed"],
            settings=settings,
            shard_size=10,
            **{**first.kwargs(), "download": interrupted_download},
        )
    resumed = Recorder(tmp_path)
    with pytest.raises(RuntimeError, match="--shard-size"):
        run(["download", "embed"], settings=settings, shard_size=20, **resumed.kwargs())
    assert resumed.calls == []
    assert Checkpoint.for_job(settings, "build_index").done_keys("embed") == {"shard-0"}


def test_separate_embed_stage_is_gated_and_uses_the_passing_dtype(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    first = Recorder(tmp_path, dtype="float32")
    run(["download", "drift"], settings=settings, **first.kwargs())

    resumed = Recorder(tmp_path, dtype="float32")
    run(["embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == [("drift", "auto"), ("load", "float32"), ("embed", 0, 5)]
    manifest = json.loads((tmp_path / "features" / "manifest.json").read_text())
    assert manifest["dtype"] == manifest["driftCheck"]["dtype"] == "float32"


def test_separate_embed_stage_rechecks_a_previous_pass(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download", "drift"], settings=settings, **Recorder(tmp_path).kwargs())
    resumed = Recorder(tmp_path, drift_passes=False)

    with pytest.raises(DriftCheckFailed):
        run(["embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == [("drift", "auto")]
    assert not Checkpoint.for_job(settings, "build_index").done_keys("embed")


def test_interrupted_download_cannot_be_embedded_and_normal_resume_recovers(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    first = Recorder(tmp_path)

    def interrupted_download(shard, tasks, **kwargs):
        first.download(shard, tasks, **kwargs)
        for task in tasks[1:]:
            (kwargs["images_dir"] / f"shard-{shard}" / image_filename(task.key)).unlink()
        raise DownloadIncomplete("interrupted")

    with pytest.raises(DownloadIncomplete):
        run(["download"], settings=settings, **{**first.kwargs(), "download": interrupted_download})
    resumed = Recorder(tmp_path)
    with pytest.raises(DownloadIncomplete, match="incomplete"):
        run(["embed"], settings=settings, **resumed.kwargs())

    assert not Checkpoint.for_job(settings, "build_index").done_keys("embed")
    assert len(list((tmp_path / "images" / "shard-0").glob("*.jpg"))) == 1
    assert all(call[0] not in {"load", "embed"} for call in resumed.calls)
    run(["download", "embed"], settings=settings, **resumed.kwargs())
    assert ("embed", 0, 5) in resumed.calls


@pytest.mark.parametrize("changed_url", [False, True])
def test_build_validates_standalone_downloads_before_embedding(tmp_path, monkeypatch, changed_url):
    settings = settings_with_objects(tmp_path, count=5)
    first = Recorder(tmp_path)
    metadata = tmp_path / "metadata" / "objects.jsonl"
    tasks = list(iter_tasks(metadata))
    first.download(
        0,
        tasks,
        images_dir=tmp_path / "images",
        state_dir=tmp_path / "downloads",
        client_factory=None,
    )
    if changed_url:
        rows = [json.loads(line) for line in metadata.read_text().splitlines()]
        rows[0]["imageRef"] = "https://img.example/replacement"
        metadata.write_text("".join(json.dumps(row) + "\n" for row in rows))
    monkeypatch.setattr(
        "artlog_jobs.build_index.default_client_factory",
        lambda *_: (
            lambda _: PoliteClient(
                user_agent="test",
                robots=False,
                transport=httpx.MockTransport(
                    lambda _: pytest.fail("must not fetch cached inputs")
                ),
            )
        ),
    )
    resumed = Recorder(tmp_path)
    kwargs = {**resumed.kwargs(), "download": download_shard}

    if changed_url:
        with pytest.raises(ValueError, match="download inputs"):
            run(["download", "embed"], settings=settings, **kwargs)
        assert resumed.calls == [("drift", "auto")]
        assert not Checkpoint.for_job(settings, "build_index").done_keys("embed")
    else:
        run(["download", "embed"], settings=settings, **kwargs)
        assert ("embed", 0, 5) in resumed.calls


@pytest.mark.parametrize("missing_file", [False, True])
def test_embed_checks_completion_marker_and_all_downloaded_images(tmp_path, missing_file):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download"], settings=settings, **Recorder(tmp_path).kwargs())
    if missing_file:
        next((tmp_path / "images" / "shard-0").glob("*.jpg")).unlink()
    else:
        state = ShardState(tmp_path / "downloads", 0)
        state.save_source("met", SourceReport(), complete=False)
    with pytest.raises(DownloadIncomplete, match="incomplete"):
        run(["embed"], settings=settings, **Recorder(tmp_path).kwargs())
    assert not Checkpoint.for_job(settings, "build_index").done_keys("embed")
    resumed = Recorder(tmp_path)
    run(["download", "embed"], settings=settings, **resumed.kwargs())
    assert ("download", 0, 5) in resumed.calls
    assert ("embed", 0, 5) in resumed.calls


def test_terminal_download_failures_allow_the_remaining_images_to_embed(tmp_path):
    settings = settings_with_objects(tmp_path, count=5)
    run(["download"], settings=settings, **Recorder(tmp_path).kwargs())
    (tmp_path / "images" / "shard-0" / image_filename("met:1")).unlink()
    state = ShardState(tmp_path / "downloads", 0)
    state.record_failure(ImageTask("met:1", "https://img.example/1", "met"), "http_404", 404)
    resumed = Recorder(tmp_path)

    run(["embed"], settings=settings, **resumed.kwargs())

    assert ("embed", 0, 4) in resumed.calls


def test_resume_finishes_cleanup_of_an_already_embedded_shard(tmp_path, monkeypatch):
    settings = settings_with_objects(tmp_path, count=5)
    first = Recorder(tmp_path)

    def failed_cleanup(path):
        raise OSError("cleanup interrupted")

    with monkeypatch.context() as scoped:
        scoped.setattr(shutil, "rmtree", failed_cleanup)
        with pytest.raises(OSError, match="cleanup interrupted"):
            run(["download", "embed"], settings=settings, **first.kwargs())
    assert (tmp_path / "images" / "shard-0").exists()

    resumed = Recorder(tmp_path)
    run(["download", "embed"], settings=settings, **resumed.kwargs())

    assert resumed.calls == [("drift", "auto")]
    assert not (tmp_path / "images").exists()


def test_stage_parsing_and_projection():
    assert parse_stages("download,embed") == ["download", "embed"]
    for bad in ("", "download,download", "invalid-stage"):
        with pytest.raises(argparse.ArgumentTypeError):
            parse_stages(bad)

    reports = [
        {
            "met": SourceReport(done=90, failed=10, seconds=10.0),
            "wikidata": SourceReport(done=100, seconds=100.0),
        }
    ]
    embeds = [{"images": 200, "seconds": 20.0}]
    result = projection({"met": 36_000, "wikidata": 360_000}, reports, embeds)
    assert result["sources"]["met"] == {
        "objects": 36_000,
        "achievedReqPerSecond": 10.0,
        "hours": 1.0,
    }
    assert result["sources"]["wikidata"]["hours"] == 100.0
    assert result["embedImagesPerSecond"] == 10.0
    assert result["wallClockDays"] == pytest.approx((100 + 396_000 / 10 / 3600) / 24, abs=0.01)


def test_dedupe_hubs_push_run_in_dependency_order_without_model_loading(tmp_path, monkeypatch):
    from artlog_jobs import convex_writer, dedupe, hubs, push

    seen = []
    monkeypatch.setattr(dedupe, "run", lambda *args: seen.append("dedupe"))
    monkeypatch.setattr(hubs, "run", lambda *args: seen.append("hubs"))
    monkeypatch.setattr(push, "Corpus", lambda *args, **kwargs: object())
    monkeypatch.setattr(convex_writer, "ConvexWriter", lambda *args: object())
    monkeypatch.setattr(push, "run", lambda *args, **kwargs: seen.append("push"))
    settings = Settings(_env_file=None, scratch_dir=tmp_path)
    run(
        parse_stages("push,hubs,dedupe"),
        settings=settings,
        load=lambda *_: pytest.fail("postprocessing must not load the embedder"),
    )
    assert seen == ["dedupe", "hubs", "push"]


def test_downstream_stage_failure_prevents_writes(tmp_path, monkeypatch):
    from artlog_jobs import dedupe, push

    def fail(*args):
        raise ValueError("invalid features")

    monkeypatch.setattr(dedupe, "run", fail)
    monkeypatch.setattr(push, "run", lambda *args: pytest.fail("must stop before push"))
    with pytest.raises(ValueError, match="invalid features"):
        run(
            parse_stages("dedupe,hubs,push"),
            settings=Settings(_env_file=None, scratch_dir=tmp_path),
        )

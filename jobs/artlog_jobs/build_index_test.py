import argparse
import json
import shutil

import pytest

from artlog_jobs.build_index import DriftCheckFailed, parse_stages, projection, run
from artlog_jobs.checkpoint import Checkpoint
from artlog_jobs.config import Settings
from artlog_jobs.download import SourceReport, image_filename


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
        directory.mkdir(parents=True)
        for task in tasks:
            (directory / image_filename(task.key)).write_bytes(b"jpeg")
        self.calls.append(("download", shard, len(tasks)))
        report = SourceReport(attempted=len(tasks), done=len(tasks), seconds=float(len(tasks)))
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
    for bad in ("", "download,download", "push"):
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

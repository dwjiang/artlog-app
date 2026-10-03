import json

import numpy as np
import pytest

from ..download import DownloadIncomplete, SourceBlocked, image_filename
from ..model_version import EMBEDDING_DIM
from ..orb import OrbFeatures
from .sample import (
    DOWNLOAD_ATTEMPTS,
    Index,
    Reference,
    load_index,
    select_objects,
    write_samples,
)


def make_index(count=20):
    objects = {
        str(i): {
            "objectId": str(i),
            "key": f"{'met' if i < count // 2 else 'aic'}:{i}",
            "artworkKey": f"art:{i}",
            "source": "corpus",
            "imageRef": f"https://example.org/{i}.jpg",
            "rightsStatus": "public_domain",
            "objectPenalty": 0,
        }
        for i in range(count)
    }
    vectors = np.zeros((count, EMBEDDING_DIM), dtype=np.float32)
    vectors[:, 0] = 1
    return Index(
        vectors,
        list(objects),
        objects,
        {key: Reference(OrbFeatures(b"", b"", 0), 512) for key in objects},
        "test",
    )


def test_sampling_is_seeded_stratified_and_rejects_ineligible_images():
    index = make_index()
    index.objects["0"]["rightsStatus"] = "unknown"
    index.objects["10"]["rightsStatus"] = "in_copyright"
    del index.descriptors["1"]
    del index.descriptors["11"]
    first = select_objects(index, count=8, seed=7)
    assert first == select_objects(index, count=8, seed=7)
    assert {row["objectId"] for row in first}.isdisjoint({"0", "1", "10", "11"})
    assert sum(row["key"].startswith("met:") for row in first) == 4
    with pytest.raises(ValueError, match="eligible"):
        select_objects(index, count=5000, seed=7)


def test_local_package_keeps_every_view_one_reference_and_artwork_keys(merged_corpus):
    index = load_index(merged_corpus())
    assert index.vectors.shape == (3, EMBEDDING_DIM)
    assert index.vectors.dtype == np.float32
    # wikidata:Q1 merged into met:0 by accession, so its view searches as met:0.
    assert sorted(index.object_ids) == ["met:0", "met:0", "met:1"]
    assert index.object_rows["met:0"] == [i for i, o in enumerate(index.object_ids) if o == "met:0"]
    assert index.objects["met:0"]["artworkKey"] == "art:0"
    assert index.objects["met:1"]["rightsStatus"] == "public_domain"
    assert index.descriptors["met:1"].features.count == 1
    assert "met:2" not in index.descriptors
    assert len(index.fingerprint) == 64


def test_local_package_must_be_a_complete_build(merged_corpus):
    directory = merged_corpus()
    stats = json.loads((directory / "stats.json").read_text())
    (directory / "stats.json").write_text(json.dumps(stats | {"completeFeatures": False}))
    with pytest.raises(ValueError, match="complete features"):
        load_index(directory)


@pytest.mark.parametrize("fail", [False, True])
def test_feature_pipeline_uses_real_preprocessing_and_cleans_images_on_success_or_failure(
    tmp_path, fail, monkeypatch
):
    from PIL import Image

    # Every object shares one vector here, so a withheld artwork would hide them all.
    monkeypatch.setattr("pipeline.calibrator.sample.OUT_OF_INDEX_RATE", 0)

    index = make_index(2)

    def download(shard, tasks, *, images_dir, **kwargs):
        directory = images_dir / f"shard-{shard}"
        directory.mkdir(parents=True)
        for task in tasks:
            Image.new("RGB", (100, 80), "blue").save(directory / image_filename(task.key))
        return {}

    class Embedder:
        def embed(self, batch):
            assert tuple(batch.shape) == (7, 3, 512, 512)
            if fail:
                raise RuntimeError("embedding failed")
            return np.tile(index.vectors[0], (7, 1))

    output = tmp_path / "rows.jsonl"
    args = {
        "index": index,
        "selected": list(index.objects.values()),
        "embedder": Embedder(),
        "out": output,
        "scratch": tmp_path / "scratch",
        "seed": 4,
        "client_factory": lambda source: None,
        "downloader": download,
    }
    if fail:
        with pytest.raises(RuntimeError, match="embedding failed"):
            write_samples(**args)
        assert not output.exists()
    else:
        summary = write_samples(**args)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        assert len(rows) == 28
        assert sum(row["label"] for row in rows) == 14
        assert summary["queries"] == 14
        assert summary["queriesWithoutTrueCandidate"] == 0
        assert summary["outOfIndexQueries"] == 0
        assert {row["sourceObjectId"] for row in rows} == {"0", "1"}
    assert not list((tmp_path / "scratch").rglob("*.jpg"))


def sample_args(index, tmp_path, downloader):
    class Embedder:
        def embed(self, batch):
            return np.tile(index.vectors[0], (len(batch), 1))

    return {
        "index": index,
        "selected": list(index.objects.values()),
        "embedder": Embedder(),
        "out": tmp_path / "rows.jsonl",
        "scratch": tmp_path / "scratch",
        "seed": 4,
        "client_factory": lambda source: None,
        "downloader": downloader,
    }


def test_retryable_downloads_are_retried_and_permanently_missing_images_are_skipped(tmp_path):
    from PIL import Image

    index = make_index(3)
    attempts = []

    def download(shard, tasks, *, images_dir, **kwargs):
        attempts.append(shard)
        directory = images_dir / f"shard-{shard}"
        directory.mkdir(parents=True, exist_ok=True)
        # "1" is a 404-style permanent failure; "2" needs the resumed second attempt.
        for task in tasks:
            if task.key.endswith(":1") or (task.key.endswith(":2") and len(attempts) == 1):
                continue
            Image.new("RGB", (100, 80), "blue").save(directory / image_filename(task.key))
        if len(attempts) == 1:
            raise DownloadIncomplete("met: 1 retryable downloads; resume the run")
        return {}

    summary = write_samples(**sample_args(index, tmp_path, download))
    assert attempts == [0, 0]
    assert summary["objects"] == 2
    assert summary["skipped"] == 1
    assert summary["skippedObjects"] == [{"objectId": "1", "key": "aic:1"}]
    assert [row["objectId"] for row in summary["sourceObjects"]] == ["0", "2"]
    assert summary["queries"] == 14
    rows = [json.loads(line) for line in (tmp_path / "rows.jsonl").read_text().splitlines()]
    assert {row["sourceObjectId"] for row in rows} == {"0", "2"}


def test_downloads_give_up_after_bounded_attempts_and_publish_nothing_without_images(tmp_path):
    attempts = []

    def download(shard, tasks, *, images_dir, **kwargs):
        attempts.append(shard)
        (images_dir / f"shard-{shard}").mkdir(parents=True, exist_ok=True)
        raise DownloadIncomplete("wikidata: 25 retryable downloads; resume the run")

    with pytest.raises(ValueError, match="nothing was published"):
        write_samples(**sample_args(make_index(1), tmp_path, download))
    assert attempts == [0] * DOWNLOAD_ATTEMPTS
    assert not (tmp_path / "rows.jsonl").exists()


def test_blocked_source_stops_the_run(tmp_path):
    def download(shard, tasks, **kwargs):
        raise SourceBlocked("aic: 20 consecutive HTTP 429 responses")

    with pytest.raises(SourceBlocked):
        write_samples(**sample_args(make_index(1), tmp_path, download))

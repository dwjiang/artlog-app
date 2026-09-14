import json

from pipeline.checkpoint import Checkpoint
from pipeline.config import Settings


def test_missing_file_starts_empty(tmp_path):
    cp = Checkpoint(tmp_path / "nested" / "job.json")
    assert cp.done_keys("stage") == frozenset()
    assert cp.cursor("stage") is None
    assert not cp.is_done("stage", "a")


def test_progress_survives_a_restart(tmp_path):
    path = tmp_path / "job.json"
    cp = Checkpoint(path)
    cp.mark_done("museums", ["wikidata:Q1", "wikidata:Q2"])
    cp.set_cursor("venues", "cursor-1")

    resumed = Checkpoint(path)
    assert resumed.is_done("museums", "wikidata:Q1")
    assert resumed.done_keys("museums") == {"wikidata:Q1", "wikidata:Q2"}
    assert resumed.cursor("venues") == "cursor-1"
    assert not list(tmp_path.glob("*.tmp"))


def test_clearing_a_stage_and_unsetting_a_cursor(tmp_path):
    cp = Checkpoint(tmp_path / "job.json")
    cp.mark_done("s", ["k"])
    cp.set_cursor("s", "c")
    cp.set_cursor("s", None)
    assert cp.cursor("s") is None
    cp.clear("s")
    assert Checkpoint(cp.path).done_keys("s") == frozenset()
    assert json.loads(cp.path.read_text()) == {"stages": {}}


def test_for_job_lives_under_the_scratch_dir(tmp_path):
    settings = Settings(_env_file=None, scratch_dir=tmp_path)
    cp = Checkpoint.for_job(settings, "seed_venues")
    assert cp.path == tmp_path.resolve() / "checkpoints" / "seed_venues.json"

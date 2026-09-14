import json
from pathlib import Path

import pytest

from .build_metadata import build
from .owner_map import AIC_KEY, MET_KEY, OwnerMap

FIXTURES = Path(__file__).parents[1] / "fixtures"


def test_fixture_build_writes_linked_records_stats_and_is_repeatable(tmp_path):
    def run():
        return build(
            ["met", "aic", "wikidata"],
            out=tmp_path,
            dumps=tmp_path / "dumps",
            owners=OwnerMap({MET_KEY, AIC_KEY}),
            user_agent="test",
            fixtures=FIXTURES,
        )

    stats = run()
    first = {file.name: file.read_bytes() for file in tmp_path.glob("*.json*")}
    assert run() == stats
    assert {file.name: file.read_bytes() for file in tmp_path.glob("*.json*")} == first
    assert set(first) == {"artworks.jsonl", "objects.jsonl", "placements.jsonl", "stats.json"}
    artworks = {
        row["key"]: row
        for row in (
            json.loads(line) for line in (tmp_path / "artworks.jsonl").read_text().splitlines()
        )
    }
    objects = [json.loads(line) for line in (tmp_path / "objects.jsonl").read_text().splitlines()]
    assert len(artworks) == 14 and len(objects) == 15
    assert artworks["wikidata:Q1"]["multiplicity"] == "multiple"
    assert stats["sources"]["met"]["objects"] == 5
    assert stats["sources"]["aic"]["objects"] == 4
    assert stats["sources"]["wikidata"]["objects"] == 6
    assert stats["unmappedOwners"] == {"Q999": 1}
    assert all(obj["artworkKey"] in artworks for obj in objects)
    assert all(
        "thumbnailUrl" not in obj or artworks[obj["artworkKey"]]["rightsStatus"] == "public_domain"
        for obj in objects
    )
    assert stats["aicImageAccess"] == "blocked"


def test_complete_live_aic_snapshot_emits_current_placements_without_enabling_images(tmp_path):
    from .sources.fetch import write_json

    live = tmp_path / "dumps" / "aic" / "live"
    rows = json.loads((FIXTURES / "aic-sample.json").read_text())["data"]
    write_json(live / "paintings-after-0.json", {"data": rows[:3]})
    write_json(
        live / "stats.json",
        {
            "complete": True,
            "rows": 3,
            "files": ["paintings-after-0.json"],
        },
    )
    # Files outside the manifest cannot leak archived or partial records into a live build.
    write_json(live / "paintings-0001.json", {"data": rows[3:]})
    stats = build(
        ["aic"],
        out=tmp_path / "out",
        dumps=tmp_path / "dumps",
        owners=OwnerMap({AIC_KEY}),
        user_agent="test",
    )
    assert stats["objects"] == stats["placements"] == 3
    assert stats["sources"]["aic"]["onView"] == 1
    assert stats["sources"]["aic"]["imageRefs"] == 0
    assert stats["sources"]["aic"]["thumbnails"] == 0
    assert stats["coverage"]["aic"]["snapshot"] == "live"


def test_incomplete_live_aic_snapshot_cannot_replace_a_finished_metadata_build(tmp_path):
    from .sources.fetch import write_json

    out = tmp_path / "out"
    write_json(out / "stats.json", {"old": "complete build"})
    write_json(tmp_path / "dumps" / "aic" / "live" / "stats.json", {"complete": False})
    with pytest.raises(RuntimeError, match="incomplete"):
        build(
            ["aic"],
            out=out,
            dumps=tmp_path / "dumps",
            owners=OwnerMap({AIC_KEY}),
            user_agent="test",
            aic_snapshot="live",
        )
    assert json.loads((out / "stats.json").read_text()) == {"old": "complete build"}

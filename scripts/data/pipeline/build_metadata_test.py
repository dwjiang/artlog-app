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
    assert len(artworks) == 16 and len(objects) == 17
    assert artworks["wikidata:Q1"]["multiplicity"] == "multiple"
    assert stats["sources"]["met"]["objects"] == 6
    assert stats["sources"]["aic"]["objects"] == 4
    assert stats["sources"]["wikidata"]["objects"] == 7
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


def test_existing_objects_are_left_out_of_a_build_for_additions(tmp_path):
    stats = build(
        ["met", "wikidata"],
        out=tmp_path,
        dumps=tmp_path / "dumps",
        owners=OwnerMap({MET_KEY, AIC_KEY}),
        user_agent="test",
        fixtures=FIXTURES,
        existing=frozenset({"met:1", "wikidata:Q1"}),
    )
    keys = {
        json.loads(line)["key"] for line in (tmp_path / "objects.jsonl").read_text().splitlines()
    }
    assert not keys & {"met:1", "wikidata:Q1"}
    assert {"met:7", "wikidata:Q7"} <= keys
    assert stats["sources"]["met"]["existing"] == stats["sources"]["wikidata"]["existing"] == 1


def test_museum_open_access_sources_build_with_their_buildings_as_venues(tmp_path):
    from .owner_map import ATENEUM_KEY, CMA_KEY, FNG_KEY, KIASMA_KEY, SINEBRYCHOFF_KEY

    stats = build(
        ["cma", "fng"],
        out=tmp_path,
        dumps=tmp_path / "dumps",
        owners=OwnerMap({CMA_KEY, FNG_KEY, ATENEUM_KEY, SINEBRYCHOFF_KEY, KIASMA_KEY}),
        user_agent="test",
        fixtures=FIXTURES,
    )
    placements = [
        json.loads(line) for line in (tmp_path / "placements.jsonl").read_text().splitlines()
    ]
    assert stats["sources"]["cma"]["objects"] > 0 and stats["sources"]["fng"]["objects"] > 0
    assert {row["venueKey"] for row in placements} <= {
        CMA_KEY,
        ATENEUM_KEY,
        SINEBRYCHOFF_KEY,
        KIASMA_KEY,
    }


def test_on_view_feeds_alias_imported_objects_and_report_rows_they_could_not_place(tmp_path):
    from .sources import ng
    from .sources.onview import Imported, write_snapshot

    def row(number, *, on_view=True):
        return {
            "id": f"uid-{number}",
            "accession": number,
            "url": f"https://www.nationalgallery.org.uk/paintings/{number}",
            "onView": on_view,
            "gallery": "Room 34" if on_view else "Not on display",
        }

    write_snapshot(
        tmp_path / "dumps" / "ng",
        [row("NG1"), row("NG2", on_view=False), row("NG3")],
        minimum_on_view=1,
    )
    imported = Imported(
        {
            "key": f"wikidata:Q{n}",
            "artworkKey": f"wikidata:Q{n}",
            "ownerKey": ng.OWNER_KEY,
            "accession": f"NG{n}",
        }
        for n in (1, 2)
    )
    stats = build(
        ["ng"],
        out=tmp_path / "out",
        dumps=tmp_path / "dumps",
        owners=OwnerMap({ng.OWNER_KEY}),
        user_agent="test",
        imported=imported,
    )
    objects = [
        json.loads(line) for line in (tmp_path / "out/objects.jsonl").read_text().splitlines()
    ]
    placements = [
        json.loads(line) for line in (tmp_path / "out/placements.jsonl").read_text().splitlines()
    ]
    assert [(obj["key"], obj["aliasOf"], obj["artworkKey"]) for obj in objects] == [
        ("ng:uid-NG1", "wikidata:Q1", "wikidata:Q1"),
        ("ng:uid-NG2", "wikidata:Q2", "wikidata:Q2"),
    ]
    assert [(p["objectKey"], p.get("gallery"), p["onView"]) for p in placements] == [
        ("ng:uid-NG1", "Room 34", True),
        ("ng:uid-NG2", None, False),
    ]
    assert stats["sources"]["ng"]["unmatched"] == 1
    assert stats["coverage"]["ng"]["onView"] == 2
    with pytest.raises(ValueError, match="imported corpus"):
        build(
            ["ng"],
            out=tmp_path / "out",
            dumps=tmp_path / "dumps",
            owners=OwnerMap({ng.OWNER_KEY}),
            user_agent="test",
        )

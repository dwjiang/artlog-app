import json
import sqlite3
import sys
from dataclasses import replace
from unittest.mock import Mock

import pytest

from . import seed_venues
from .checkpoint import Checkpoint
from .config import Settings
from .regions import load_regions
from .wikidata import City, IncompleteCountry, VenueRow

VENUE = VenueRow("Q1", "Musée", 37.78, -122.4, "https://museum.example", "US")
EXPORT_ROW = {
    "_id": "museum-1",
    "key": "wikidata:Q1",
    "name": "Musée",
    "lat": 37.78,
    "lng": -122.4,
    "website": "https://museum.example",
    "region": "sf-bay-area",
}
DEPLOYMENT = "https://venues.convex.cloud"


def exporting(*pages, change_version=0):
    writer = Mock()
    remaining = list(pages)

    def query(name, *args):
        if name == "venueChanges:latestVersion":
            return change_version
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    writer.query.side_effect = query
    return writer


def exporting_live(stored):
    return lambda name, *args: (
        0
        if name == "venueChanges:latestVersion"
        else {"page": list(stored.values()), "isDone": True}
    )


@pytest.fixture(autouse=True)
def no_city_lookups(monkeypatch):
    monkeypatch.setattr(seed_venues, "resolve_cities", lambda qids, **kwargs: {})


def test_resume_does_not_repeat_completed_writes_or_downloads(tmp_path):
    writer, fetch = Mock(), Mock(return_value=iter([VENUE]))
    checkpoint = Checkpoint(tmp_path / "checkpoint.json")
    args = (writer, {"US": ["Q30"]}, load_regions(), checkpoint)
    assert seed_venues.seed_countries(*args, user_agent="test", fetch_venues=fetch) == 1
    assert seed_venues.seed_countries(*args, user_agent="test", fetch_venues=fetch) == 1
    writer.upsert.assert_called_once_with(
        "ingest:upsertMuseums",
        [
            {
                "key": "wikidata:Q1",
                "wikidataId": "Q1",
                "name": "Musée",
                "lat": 37.78,
                "lng": -122.4,
                "website": "https://museum.example",
                "seedSource": "wikidata",
                "region": "sf-bay-area",
                "country": "US",
            }
        ],
        batch_size=500,
    )
    assert fetch.call_count == 1


def test_failed_country_write_replays_cached_rows_without_marking_done(tmp_path):
    writer, fetch = Mock(), Mock(return_value=iter([VENUE]))
    writer.upsert.side_effect = [RuntimeError("network"), {}]
    checkpoint = Checkpoint(tmp_path / "checkpoint.json")
    args = (writer, {"US": ["Q30"]}, load_regions(), checkpoint)
    with pytest.raises(RuntimeError, match="network"):
        seed_venues.seed_countries(*args, user_agent="test", fetch_venues=fetch)
    assert not checkpoint.is_done("seed", "US")
    assert seed_venues.seed_countries(*args, user_agent="test", fetch_venues=fetch) == 1
    assert checkpoint.is_done("seed", "US")
    assert fetch.call_count == 1


def test_timeout_continues_remaining_countries_but_blocks_export(tmp_path):
    writer, fetch = Mock(), Mock(side_effect=[IncompleteCountry("GB timeout"), iter([VENUE])])
    checkpoint = Checkpoint(tmp_path / "checkpoint.json")
    with pytest.raises(IncompleteCountry, match="incomplete countries: GB"):
        seed_venues.seed_countries(
            writer,
            {"GB": ["Q145"], "US": ["Q30"]},
            load_regions(),
            checkpoint,
            user_agent="test",
            fetch_venues=fetch,
        )
    assert checkpoint.is_done("seed", "US")
    assert not checkpoint.is_done("seed", "GB")


def test_multiple_country_claims_are_seeded_only_once(tmp_path):
    writer = Mock()
    count = seed_venues.seed_countries(
        writer,
        {"CA": ["Q16"], "US": ["Q30"]},
        load_regions(),
        Checkpoint(tmp_path / "checkpoint.json"),
        user_agent="test",
        fetch_venues=Mock(side_effect=[[replace(VENUE, country_iso="CA")], [VENUE]]),
    )
    assert count == 1
    assert sum(len(call.args[1]) for call in writer.upsert.call_args_list) == 1


@pytest.mark.parametrize("interrupt_refresh", [False, True])
def test_full_census_restores_country_assignment_after_partial_refresh(
    tmp_path, monkeypatch, interrupt_refresh
):
    countries = {"BM": ["Q23635"], "GB": ["Q145"]}
    (tmp_path / "config").mkdir()
    (tmp_path / "config/countries.json").write_text(json.dumps(countries))
    settings = Settings(
        _env_file=None, convex_url="https://test.convex.cloud", scratch_dir=tmp_path
    )
    monkeypatch.setattr(seed_venues, "DATA_DIR", tmp_path)
    monkeypatch.setattr(seed_venues, "get_settings", lambda: settings)
    monkeypatch.setattr(seed_venues, "BASELINE_VENUES", 1)
    stored = {}
    writer = Mock()

    def upsert(_fn, rows, **kwargs):
        stored.update((row["key"], {**row, "_id": row["key"]}) for row in rows)

    writer.upsert.side_effect = upsert
    writer.query.side_effect = exporting_live(stored)
    monkeypatch.setattr(seed_venues, "ConvexWriter", lambda _settings: writer)
    fetch = Mock(
        side_effect=lambda selected, **kwargs: (
            [] if "unknown" in selected else [replace(VENUE, country_iso=next(iter(selected)))]
        )
    )
    seed = seed_venues.seed_countries
    monkeypatch.setattr(
        seed_venues,
        "seed_countries",
        lambda *args, **kwargs: seed(*args, **kwargs, fetch_venues=fetch),
    )

    def run(*args):
        monkeypatch.setattr(sys, "argv", ["seed_venues", *args, "--out", str(tmp_path / "out")])
        seed_venues.main()

    run("--all")

    if interrupt_refresh:

        def interrupted_upsert(*args, **kwargs):
            upsert(*args, **kwargs)
            raise RuntimeError("interrupted after a batch committed")

        writer.upsert.side_effect = interrupted_upsert
        with pytest.raises(RuntimeError, match="interrupted"):
            run("--countries", "GB", "--refresh")
        writer.upsert.side_effect = upsert
    else:
        run("--countries", "GB", "--refresh")
    assert stored["wikidata:Q1"]["region"] == "country:GB"

    run("--all")
    with sqlite3.connect(tmp_path / "out/venues.db") as db:
        assert db.execute("SELECT region FROM venues").fetchall() == [("country:BM",)]
    writes = writer.upsert.call_count
    run("--all")
    assert writer.upsert.call_count == writes
    assert fetch.call_count == 4


def test_export_pages_preserves_ids_and_starts_from_the_change_version_read_first(tmp_path):
    writer = exporting(
        {"page": [EXPORT_ROW], "continueCursor": "next", "isDone": False},
        {
            "page": [{**EXPORT_ROW, "_id": "museum-2", "key": "wikidata:Q2", "website": None}],
            "isDone": True,
        },
        change_version=123,
    )
    asset = seed_venues.export_asset(writer, tmp_path, deployment_url=DEPLOYMENT)
    assert (asset.change_version, asset.row_count) == (123, 2)
    assert asset.size_bytes == asset.path.stat().st_size
    assert writer.query.call_args_list[0].args == ("venueChanges:latestVersion",)
    with sqlite3.connect(asset.path) as db:
        assert db.execute("SELECT changeVersion, deployment FROM meta").fetchall() == [
            (123, DEPLOYMENT)
        ]
        assert db.execute("SELECT id, name FROM venues ORDER BY id").fetchall() == [
            ("museum-1", "Musée"),
            ("museum-2", "Musée"),
        ]
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert writer.query.call_args_list[2].args == ("ingest:exportVenues", {"cursor": "next"})


def test_failed_export_preserves_previous_asset(tmp_path):
    existing = tmp_path / "venues.db"
    existing.write_bytes(b"previous")
    writer = exporting({"page": [], "isDone": True})
    with pytest.raises(RuntimeError, match="empty"):
        seed_venues.export_asset(writer, tmp_path, deployment_url=DEPLOYMENT)
    assert existing.read_bytes() == b"previous"
    assert list(tmp_path.iterdir()) == [existing]


def test_oversized_export_omits_websites_then_enforces_hard_limit(tmp_path, monkeypatch):
    writer = exporting({"page": [{**EXPORT_ROW, "website": "x" * 100_000}], "isDone": True})
    monkeypatch.setattr(seed_venues, "MAX_ASSET_BYTES", 20_000)
    asset = seed_venues.export_asset(writer, tmp_path, deployment_url=DEPLOYMENT)
    assert asset.websites_omitted
    with sqlite3.connect(asset.path) as db:
        assert db.execute("SELECT website FROM venues").fetchone() == (None,)
    monkeypatch.setattr(seed_venues, "MAX_ASSET_BYTES", 1)
    with pytest.raises(RuntimeError, match="without websites"):
        seed_venues.export_asset(writer, tmp_path, deployment_url=DEPLOYMENT)


def test_census_over_limit_stops_before_writes(tmp_path, monkeypatch):
    monkeypatch.setattr(seed_venues, "MAX_VENUES", 0)
    writer = Mock()
    with pytest.raises(RuntimeError, match="exceeds"):
        seed_venues.seed_countries(
            writer,
            {"US": ["Q30"]},
            load_regions(),
            Checkpoint(tmp_path / "checkpoint.json"),
            user_agent="test",
            fetch_venues=lambda *args, **kwargs: [VENUE],
        )
    writer.upsert.assert_not_called()


def test_city_and_country_survive_export_without_filling_unknown_values(tmp_path):
    writer = exporting({"page": [
        {**EXPORT_ROW, "city": "San Francisco", "country": "US", "cityKey": "wikidata:Q62"},
        {**EXPORT_ROW, "_id": "unknown", "key": "unknown"},
    ], "isDone": True})
    asset = seed_venues.export_asset(writer, tmp_path, deployment_url=DEPLOYMENT)
    with sqlite3.connect(asset.path) as db:
        assert db.execute("SELECT city, country, cityKey FROM venues ORDER BY id").fetchall() == [
            ("San Francisco", "US", "wikidata:Q62"), (None, None, None),
        ]


def test_seeds_only_country_codes_the_server_accepts(tmp_path):
    kosovo, yugoslavia = replace(VENUE, qid="Q2", country_iso="XK"), replace(VENUE, qid="Q3", country_iso="YU")
    writer = Mock()
    fetch = Mock(side_effect=lambda selection, **_: iter([kosovo] if "XK" in selection else [yugoslavia]))
    checkpoint = Checkpoint(tmp_path / "checkpoint.json")
    seed_venues.seed_countries(writer, {"XK": ["Q1246"], "YU": ["Q36704"]}, load_regions(), checkpoint, user_agent="test", fetch_venues=fetch)
    rows = [row for call in writer.upsert.call_args_list for row in call.args[1]]
    assert [row.get("country") for row in rows] == ["XK", None]


def test_census_rows_carry_resolved_cities(tmp_path, monkeypatch):
    monkeypatch.setattr(
        seed_venues, "resolve_cities", lambda qids, **kwargs: {"Q1": City("Q62", "San Francisco")}
    )
    writer = Mock()
    seed_venues.seed_countries(
        writer,
        {"US": ["Q30"]},
        load_regions(),
        Checkpoint(tmp_path / "checkpoint.json"),
        user_agent="test",
        fetch_venues=Mock(return_value=[VENUE]),
    )
    [row] = writer.upsert.call_args.args[1]
    assert (row["city"], row["cityKey"]) == ("San Francisco", "wikidata:Q62")


def test_cities_only_fills_existing_venues_without_a_census(tmp_path, monkeypatch):
    stored = {
        "wikidata:Q1": {**EXPORT_ROW, "wikidataId": "Q1"},
        "wikidata:Q2": {**EXPORT_ROW, "_id": "museum-2", "key": "wikidata:Q2"}
        | {"region": "country:IS"},
        "poi:1": {**EXPORT_ROW, "_id": "museum-3", "key": "poi:1", "city": "Oakland"},
    }
    writer = Mock()
    writer.query.side_effect = exporting_live(stored)
    writer.upsert.side_effect = lambda _fn, rows, **kwargs: stored.update(
        (row["key"], {**stored[row["key"]], **row}) for row in rows
    )
    resolved = Mock(return_value={"Q1": City("Q62", "San Francisco")})
    monkeypatch.setattr(seed_venues, "resolve_cities", resolved)
    monkeypatch.setattr(seed_venues, "seed_countries", Mock(side_effect=AssertionError("census")))
    monkeypatch.setattr(seed_venues, "ConvexWriter", lambda _settings: writer)
    settings = Settings(
        _env_file=None, convex_url="https://test.convex.cloud", scratch_dir=tmp_path
    )
    monkeypatch.setattr(seed_venues, "get_settings", lambda: settings)

    def run():
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", ["seed_venues", "--cities-only", "--out", str(out)])
        seed_venues.main()

    run()
    assert sorted(resolved.call_args.args[0]) == ["Q1", "Q2"]
    with sqlite3.connect(tmp_path / "out/venues.db") as db:
        exported = db.execute("SELECT key, region, city, cityKey, country FROM venues ORDER BY id")
        assert exported.fetchall() == [
            ("wikidata:Q1", "sf-bay-area", "San Francisco", "wikidata:Q62", "US"),
            ("wikidata:Q2", "country:IS", None, None, "IS"),
            ("poi:1", "sf-bay-area", "Oakland", None, None),
        ]
    writes = writer.upsert.call_args_list[0].args[1]
    assert all(row["seedSource"] == "wikidata" and row["website"] for row in writes)
    run()
    assert writer.upsert.call_args_list[1].args[1] == []


def test_cities_only_refuses_refresh(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["seed_venues", "--cities-only", "--refresh"])
    with pytest.raises(SystemExit):
        seed_venues.main()

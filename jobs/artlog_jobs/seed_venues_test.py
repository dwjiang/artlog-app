import sqlite3
from dataclasses import replace
from unittest.mock import Mock

import httpx
import pytest

from . import seed_venues
from .checkpoint import Checkpoint
from .regions import load_regions
from .wikidata import IncompleteCountry, VenueRow

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


def test_export_pages_preserves_ids_and_writes_matching_metadata(tmp_path):
    writer = Mock()
    writer.query.side_effect = [
        {"page": [EXPORT_ROW], "continueCursor": "next", "isDone": False},
        {
            "page": [{**EXPORT_ROW, "_id": "museum-2", "key": "wikidata:Q2", "website": None}],
            "isDone": True,
        },
    ]
    asset = seed_venues.export_asset(writer, tmp_path, version=123)
    assert asset.row_count == 2
    assert asset.size_bytes == asset.path.stat().st_size
    with sqlite3.connect(asset.path) as db:
        assert db.execute("SELECT version, rowCount FROM meta").fetchall() == [(123, 2)]
        assert db.execute("SELECT id, name FROM venues ORDER BY id").fetchall() == [
            ("museum-1", "Musée"),
            ("museum-2", "Musée"),
        ]
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert writer.query.call_args_list[1].args == ("ingest:exportVenues", {"cursor": "next"})


def test_failed_export_preserves_previous_asset(tmp_path):
    existing = tmp_path / "venues.db"
    existing.write_bytes(b"previous")
    writer = Mock()
    writer.query.return_value = {"page": [], "isDone": True}
    with pytest.raises(RuntimeError, match="empty"):
        seed_venues.export_asset(writer, tmp_path, version=1)
    assert existing.read_bytes() == b"previous"
    assert list(tmp_path.iterdir()) == [existing]


def test_oversized_export_omits_websites_then_enforces_hard_limit(tmp_path, monkeypatch):
    writer = Mock()
    writer.query.return_value = {"page": [{**EXPORT_ROW, "website": "x" * 100_000}], "isDone": True}
    monkeypatch.setattr(seed_venues, "MAX_ASSET_BYTES", 20_000)
    asset = seed_venues.export_asset(writer, tmp_path, version=1)
    assert asset.websites_omitted
    with sqlite3.connect(asset.path) as db:
        assert db.execute("SELECT website FROM venues").fetchone() == (None,)
    monkeypatch.setattr(seed_venues, "MAX_ASSET_BYTES", 1)
    with pytest.raises(RuntimeError, match="without websites"):
        seed_venues.export_asset(writer, tmp_path, version=2)


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


def test_publication_uploads_exact_asset_and_matching_metadata(tmp_path, monkeypatch):
    writer = Mock()
    writer.query.return_value = {"page": [EXPORT_ROW], "isDone": True}
    asset = seed_venues.export_asset(writer, tmp_path, version=123)
    writer.mutation.side_effect = ["https://upload.example/", "table-1"]
    uploaded = []

    def post(url, *, content, headers, timeout):
        uploaded.append(content.read())
        assert headers["Content-Type"] == "application/octet-stream"
        return httpx.Response(
            200, json={"storageId": "storage-1"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(seed_venues.httpx, "post", post)
    assert seed_venues.publish_asset(writer, asset) == "table-1"
    assert uploaded == [asset.path.read_bytes()]
    writer.mutation.assert_called_with(
        "venueTable:publish",
        {
            "storageId": "storage-1",
            "rowCount": 1,
            "version": 123,
        },
    )


def test_failed_upload_does_not_publish(tmp_path, monkeypatch):
    writer = Mock()
    writer.query.return_value = {"page": [EXPORT_ROW], "isDone": True}
    asset = seed_venues.export_asset(writer, tmp_path, version=123)
    writer.mutation.return_value = "https://upload.example/"
    monkeypatch.setattr(
        seed_venues.httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            503, request=httpx.Request("POST", "https://upload.example/")
        ),
    )
    with pytest.raises(httpx.HTTPStatusError):
        seed_venues.publish_asset(writer, asset)
    writer.mutation.assert_called_once_with("venueTable:requestUpload")

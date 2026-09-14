import json
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from . import ingest_checklist
from .model_version import REPO_ROOT

EXAMPLE = REPO_ROOT / "shared/sources/fixtures/checklist-example.json"


def test_shared_json_shape_and_provenance_survive_conversion():
    assert ingest_checklist.load_payload(EXAMPLE) == json.loads(EXAMPLE.read_text())


def test_csv_selects_one_identity_mode_and_omits_empty_cells(tmp_path):
    path = tmp_path / "works.csv"
    path.write_text(
        "\ufefftitle,artist,owner,accession,wikidata\n"
        '"Water Lilies, study",Monet,example:lender,001,\n'
        "Water Lilies,Monet,example:lender,002,Q123\n"
        "Uncatalogued,Unknown,,,\n",
        encoding="utf-8",
    )
    example = json.loads(EXAMPLE.read_text())
    payload = ingest_checklist.load_payload(
        path, metadata={k: v for k, v in example.items() if k != "works"}
    )
    assert payload["works"] == [
        {
            "title": "Water Lilies, study",
            "artist": "Monet",
            "ownerKey": "example:lender",
            "accession": "001",
        },
        {"wikidataId": "Q123", "ownerKey": "example:lender", "accession": "002"},
        {"title": "Uncatalogued", "artist": "Unknown"},
    ]
    assert payload["exhibition"] == example["exhibition"]


def test_batches_use_writer_and_report_every_unresolved_input():
    payload = json.loads(EXAMPLE.read_text())
    payload["works"] = [{"objectKey": f"work:{i}"} for i in range(201)]
    writer = Mock()
    unresolved = {"input": {"objectKey": "work:200"}, "reason": "object_not_found"}
    writer.mutation.side_effect = [
        {"placed": 100, "unresolved": []},
        {"placed": 100, "unresolved": []},
        {"placed": 0, "unresolved": [unresolved]},
    ]
    assert ingest_checklist.ingest(writer, payload) == {"placed": 200, "unresolved": [unresolved]}
    calls = writer.mutation.call_args_list
    assert [len(call.args[1]["works"]) for call in calls] == [100, 100, 1]
    assert all(call.args[0] == "checklists:ingestChecklist" for call in calls)
    assert all(call.args[1]["exhibition"] == payload["exhibition"] for call in calls)


@pytest.mark.parametrize(
    "dates",
    [
        {"from": "2026-02-30", "to": "2026-03-01"},
        {"from": "2026-11-01", "to": "2026-10-30"},
        {"from": "2026-1-01", "to": "2026-10-30"},
        {"from": "unknown", "to": "2026-10-30"},
    ],
)
def test_rejects_invalid_calendar_windows_before_any_write(dates):
    payload = json.loads(EXAMPLE.read_text())
    payload["exhibition"].update(dates)
    writer = Mock()
    with pytest.raises(ValidationError):
        ingest_checklist.ingest(writer, payload)
    writer.mutation.assert_not_called()


@pytest.mark.parametrize(
    "work",
    [
        {"objectKey": "work", "wikidataId": "Q123"},
        {},
        {"objectKey": " "},
        {"wikidataId": "Q123", "accession": "001"},
        {"title": "Only a title"},
    ],
)
def test_rejects_malformed_identity_modes(work):
    payload = json.loads(EXAMPLE.read_text())
    payload["works"] = [{"objectKey": "valid"}] * 100 + [work]
    writer = Mock()
    with pytest.raises(ValidationError):
        ingest_checklist.ingest(writer, payload)
    writer.mutation.assert_not_called()


def test_csv_requires_exhibition_metadata(tmp_path):
    path = tmp_path / "works.csv"
    path.write_text("title,artist,owner,accession,wikidata\nWork,Artist,,,\n")
    with pytest.raises(ValueError, match="metadata"):
        ingest_checklist.load_payload(path)


def test_dry_run_needs_no_credentials_and_prints_payload(monkeypatch, capsys):
    writer = Mock()
    monkeypatch.setattr(ingest_checklist, "ConvexWriter", writer)
    ingest_checklist.main([str(EXAMPLE), "--dry-run"])
    assert json.loads(capsys.readouterr().out) == json.loads(EXAMPLE.read_text())
    writer.assert_not_called()


def test_cli_prints_placed_count_and_unresolved_list(monkeypatch, capsys):
    writer = Mock()
    result = {
        "placed": 0,
        "unresolved": [{"input": {"objectKey": "missing"}, "reason": "object_not_found"}],
    }
    writer.mutation.return_value = result
    monkeypatch.setattr(ingest_checklist, "ConvexWriter", lambda _settings: writer)
    ingest_checklist.main([str(EXAMPLE)])
    assert json.loads(capsys.readouterr().out) == result

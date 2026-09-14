import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import evaluation
import pytest
from evaluation import (
    FIELDS,
    decode,
    field_matches,
    request_reservation,
    reserve,
    score_docent,
    score_factsheet,
    summarize,
    token_cost,
)


def test_missing_and_invented_label_fields_are_incorrect():
    assert field_matches(None, [None])
    assert not field_matches("unknown", [None])
    assert not field_matches(None, ["River and Farms"])
    assert not field_matches("Rivers and Farms", ["River and Farms"])
    assert field_matches("  WAYNE\nTHIEBAUD ", ["Wayne Thiebaud"])
    assert field_matches("1797–1858", ["1797-1858"])


def test_json_must_parse_without_repair_and_satisfy_the_contract():
    schema = {
        "type": "object",
        "properties": {"flagged": {"type": "boolean"}},
        "required": ["flagged"],
        "additionalProperties": False,
    }
    assert decode('{"flagged":true}', schema)[1] is None
    assert decode('```json\n{"flagged":true}\n```', schema)[1] == "parse"
    assert decode('{"flagged":"yes"}', schema)[1] == "schema"
    assert decode('{"flagged":true,"extra":1}', schema)[1] == "schema"
    assert decode('{"flagged":NaN}', schema)[1] == "parse"


def test_docent_validator_drops_empty_or_partially_unknown_citations():
    sentences = [
        {"sentence": "Kept.", "fact_ids": ["f1"]},
        {"sentence": "Missing.", "fact_ids": []},
        {"sentence": "Mixed.", "fact_ids": ["f1", "made-up"]},
    ]
    assert score_docent(sentences, {"facts": [{"id": "f1"}]}) == {
        "sentences": 3,
        "dropped": 2,
    }


def test_fact_urls_must_be_exact_supplied_urls():
    fixture = {"sources": [{"url": "https://museum.example/work/1"}]}
    facts = [
        {"sourceUrl": "https://museum.example/work/1"},
        {"sourceUrl": "https://museum.example/work/2"},
    ]
    assert score_factsheet(facts, fixture) == {"facts": 2, "unknown_urls": 1}


def test_budget_reserves_before_a_request_and_refuses_an_overrun():
    assert reserve(3.0, 1.0, 4.5) == 4.0
    with pytest.raises(ValueError, match="budget"):
        reserve(4.0, 1.0, 4.5)
    assert token_cost(
        {"prompt_tokens": 1000, "completion_tokens": 100},
        {"input_per_million": 0.3, "output_per_million": 0.9},
    ) == pytest.approx(0.00039)


def test_model_bound_fits_remaining_budget_without_releasing_failed_calls():
    model = {
        "input_per_million": 0.95,
        "output_per_million": 4,
        "max_model_len": 262144,
        "reservation_usd": 0.30,
    }
    amount = request_reservation(model, 2048, 1.0)
    assert reserve(4.041965018, amount, 4.5) == pytest.approx(4.341965018)
    with pytest.raises(ValueError, match="budget"):
        reserve(4.041965018, request_reservation({}, 2048, 1.0), 4.5)


def test_model_reservation_must_cover_full_context_and_output_ceiling():
    model = {
        "input_per_million": 0.95,
        "output_per_million": 4,
        "max_model_len": 262144,
        "reservation_usd": 0.25,
    }
    with pytest.raises(ValueError, match="maximum token cost"):
        request_reservation(model, 2048, 1.0)


def test_invalid_output_does_not_get_credit_for_null_fields():
    fixture = {"id": "missing", "expected": {field: [None] for field in FIELDS}}
    records = [
        {
            "fixture_id": "missing",
            "failure": "parse",
            "estimated_usd": 0.01,
            "latency_seconds": 1,
        }
    ]
    result = summarize("label", records, [fixture], 1)
    assert result["valid_outputs"] == 0
    assert result["fields"]["accession"]["correct"] == 0
    assert result["title_artist_field_accuracy"] == 0


def test_missing_repeats_cannot_be_called_deterministic():
    fixture = {"id": "one", "facts": [{"id": "f1"}]}
    record = {
        "fixture_id": "one",
        "failure": None,
        "estimated_usd": 0.01,
        "latency_seconds": 1,
        "parsed": [{"sentence": "A fact.", "fact_ids": ["f1"]}],
    }
    result = summarize("docent", [record, record], [fixture], 3)
    assert result["complete_repeat_groups"] == 0
    assert result["identical_repeat_groups"] == 0
    assert result["sentence_count_violations"] == 2


def test_named_run_resumes_without_duplicate_calls_and_rescores_without_a_key(
    tmp_path, monkeypatch
):
    response = {
        "choices": [
            {"message": {"content": '{"flagged":false}'}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 10},
    }
    api = Mock()
    api.chat.completions.create.return_value = SimpleNamespace(
        model_dump=lambda **_: response
    )
    monkeypatch.setattr(evaluation, "client", lambda: api)
    monkeypatch.setattr(evaluation.time, "sleep", lambda _: None)
    argv = [
        "moderation-eval.py",
        "--results-dir",
        str(tmp_path / "run"),
        "--model",
        "lightning",
        "--limit",
        "1",
    ]
    monkeypatch.setattr(sys, "argv", argv)

    evaluation.run("moderation")
    report_path = tmp_path / "run/moderation-lightning-json_schema-main.json"
    report = json.loads(report_path.read_text())
    budget = json.loads((tmp_path / "run/budget.json").read_text())
    assert budget["estimated_spend_usd"] == report["records"][0]["estimated_usd"]
    evaluation.run("moderation")
    assert api.chat.completions.create.call_count == 1
    assert json.loads((tmp_path / "run/budget.json").read_text()) == budget

    def no_client():
        pytest.fail("Rescoring must not construct a provider client")

    monkeypatch.setattr(evaluation, "client", no_client)
    monkeypatch.setattr(sys, "argv", argv + ["--score-only"])
    evaluation.run("moderation")
    assert json.loads(report_path.read_text()) == report

    report["protocol"]["manifest_sha256"] = "different-fixture-set"
    report_path.write_text(json.dumps(report))
    with pytest.raises(SystemExit, match="Protocol changed"):
        evaluation.run("moderation")
    assert json.loads(report_path.read_text()) == report


def test_rescoring_missing_reports_fails_without_creating_an_empty_result(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "label-eval.py",
            "--results-dir",
            str(tmp_path),
            "--model",
            "kimi",
            "--score-only",
        ],
    )
    with pytest.raises(SystemExit, match="No saved evaluation"):
        evaluation.run("label")
    assert not list(tmp_path.glob("*.json"))


def test_unknown_api_spend_remains_reserved_across_retry_tags(tmp_path, monkeypatch):
    import httpx
    from openai import APIConnectionError

    api = Mock(api_key="fake-test-key")
    api.chat.completions.create.side_effect = APIConnectionError(
        request=httpx.Request("POST", "https://example.test")
    )
    monkeypatch.setattr(evaluation, "client", lambda: api)
    argv = [
        "moderation-eval.py",
        "--results-dir",
        str(tmp_path),
        "--model",
        "lightning",
        "--limit",
        "1",
    ]
    for tag, expected in (("main", 1.0), ("retry", 2.0)):
        monkeypatch.setattr(sys, "argv", argv + ["--tag", tag])
        with pytest.raises(SystemExit, match="API failure recorded"):
            evaluation.run("moderation")
        assert (
            json.loads((tmp_path / "budget.json").read_text())["estimated_spend_usd"]
            == expected
        )


def test_all_retained_label_photos_match_their_manifest():
    manifest = evaluation.read_json(evaluation.ROOT / "labels/manifest.json")
    assert len(manifest["cases"]) == 25
    for fixture in manifest["cases"]:
        messages = evaluation.messages_for("label", fixture, {}, "Read the label")
        assert messages[1]["content"][1]["image_url"]["url"].startswith(
            "data:image/jpeg;base64,"
        )

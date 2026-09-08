import json
from datetime import UTC, datetime

import pytest

from common import (
    Evaluation,
    charged_total,
    credit_bound,
    domain_allowed,
    first_sentence,
    map_metrics,
    publication_in_window,
    sentences,
)


def test_snippet_preserves_initials_and_only_one_sentence():
    assert sentences("Rupy C. Tut has an exhibition. It opens Friday!") == [
        "Rupy C. Tut has an exhibition.",
        "It opens Friday!",
    ]
    assert (
        first_sentence("Dr. Smith visits the U.S. exhibition. Another sentence.")
        == "Dr. Smith visits the U.S. exhibition."
    )
    long = "An exhibition " + "of paintings " * 30 + ". More."
    assert len(first_sentence(long)) <= 200
    assert first_sentence(long).endswith("…")
    assert first_sentence(" \n ") == ""


def test_publication_requires_valid_recent_nonfuture_date():
    now = datetime(2026, 9, 8, 12, tzinfo=UTC)
    assert publication_in_window("2026-08-08T12:00:00Z", now) is True
    assert publication_in_window("Tue, 08 Sep 2026 11:00:00 GMT", now) is True
    assert publication_in_window("2026-08-08T11:59:59Z", now) is False
    assert publication_in_window("2026-09-09", now) is False
    assert publication_in_window("garbage", now) is False
    assert publication_in_window(None, now) is None


def test_domain_filter_uses_hostname_boundaries():
    assert domain_allowed("https://www.moma.org/art/1", ["moma.org"])
    assert not domain_allowed("https://moma.org.evil.example/art", ["moma.org"])


def test_cost_limits_include_mapping_and_extraction():
    assert credit_bound("map", {"limit": 2000}) == 200
    assert credit_bound("crawl", {"limit": 20, "extract_depth": "basic"}) == 6
    with pytest.raises(ValueError):
        credit_bound("crawl", {"limit": 21})
    with pytest.raises(ValueError):
        credit_bound("search", {"search_depth": "advanced"})


class FakeClient:
    def __init__(self, fail=False, response=None):
        self.calls = 0
        self.fail = fail
        self.response = (
            response if response is not None else {"results": [], "usage": {"credits": 1}}
        )

    def search(self, **params):
        self.calls += 1
        if self.fail:
            raise TimeoutError("Sensitive exception text must not be recorded")
        return self.response


PARAMS = {"query": "test", "search_depth": "basic", "auto_parameters": False}


def test_saved_calls_are_not_charged_twice_and_changed_requests_are_refused(tmp_path):
    client = FakeClient()
    evaluation = Evaluation(tmp_path / "results", client)
    try:
        evaluation.run("one", "search", PARAMS, {})
        evaluation.run("one", "search", PARAMS, {})
        assert client.calls == 1
        with pytest.raises(RuntimeError, match="saved request differs"):
            evaluation.run("one", "search", {**PARAMS, "query": "different"}, {})
    finally:
        evaluation.close()


def test_budget_prevents_network_request(tmp_path):
    client = FakeClient()
    directory = tmp_path / "results"
    directory.mkdir()
    (directory / "spent.json").write_text(json.dumps({"endpoint": "search", "budget_charge": 300}))
    evaluation = Evaluation(directory, client)
    try:
        with pytest.raises(RuntimeError, match="Budget exceeded"):
            evaluation.run("blocked", "search", PARAMS, {})
        assert client.calls == 0
    finally:
        evaluation.close()


def test_timeout_preserves_reservation_and_prevents_automatic_retry(tmp_path):
    client = FakeClient(fail=True)
    directory = tmp_path / "results"
    evaluation = Evaluation(directory, client)
    try:
        with pytest.raises(RuntimeError, match="no automatic retry"):
            evaluation.run("timeout", "search", PARAMS, {})
        with pytest.raises(RuntimeError, match="unresolved request"):
            evaluation.run("timeout", "search", PARAMS, {})
        record = json.loads((directory / "timeout.json").read_text())
        assert record["budget_charge"] == 1
        assert record["error_type"] == "TimeoutError"
        assert "Sensitive" not in json.dumps(record)
        assert client.calls == 1
    finally:
        evaluation.close()


@pytest.mark.parametrize(
    ("response", "expected_charge"),
    [
        pytest.param({}, 1, id="missing-usage"),
        pytest.param({"usage": {"credits": None}}, 1, id="missing-credits"),
        pytest.param({"usage": {"credits": "unknown"}}, 1, id="invalid-credits"),
        pytest.param({"usage": {"credits": -1}}, 1, id="negative-credits"),
        pytest.param({"usage": {"credits": 2}}, 2, id="exceeds-reservation"),
    ],
)
def test_unexpected_credit_report_blocks_restarted_run(tmp_path, response, expected_charge):
    directory = tmp_path / "results"
    client = FakeClient(response=response)
    evaluation = Evaluation(directory, client)
    try:
        with pytest.raises(RuntimeError, match="Unexpected credit report"):
            evaluation.run("one", "search", PARAMS, {})
        assert client.calls == 1
    finally:
        evaluation.close()

    saved = (directory / "one.json").read_text()
    record = json.loads(saved)
    assert record["response"] == response
    assert charged_total(directory) == expected_charge

    restarted_client = FakeClient()
    restarted = Evaluation(directory, restarted_client)
    try:
        with pytest.raises(RuntimeError, match="unresolved request"):
            for name in ("one", "two"):
                restarted.run(name, "search", PARAMS, {})
        assert restarted_client.calls == 0
        assert (directory / "one.json").read_text() == saved
        assert not (directory / "two.json").exists()
        assert charged_total(directory) == expected_charge
    finally:
        restarted.close()


def test_budget_ignores_derived_summaries_and_image_probe_lists(tmp_path):
    (tmp_path / "request.json").write_text(json.dumps({"endpoint": "search", "budget_charge": 1}))
    (tmp_path / "summary.json").write_text(json.dumps({"budget_charge": 1}))
    (tmp_path / "images.json").write_text("[]")
    assert charged_total(tmp_path) == 1


def test_mapping_enforces_exact_host_and_object_path_after_tavily_filters():
    metrics = map_metrics(
        {
            "results": [
                "https://www.clevelandart.org/art/1927.393",
                "https://shop.clevelandart.org/",
            ]
        },
        {"url": "https://www.clevelandart.org/", "select_paths": [r"^/art/[0-9]{4}\.[^/]+$"]},
    )
    assert metrics["external_urls"] == ["https://shop.clevelandart.org/"]
    assert metrics["unexpected_paths"] == ["https://shop.clevelandart.org/"]
    assert metrics["matching_fraction"] == 0.5

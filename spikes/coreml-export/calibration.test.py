import json
from unittest.mock import Mock

import pytest
import requests

import calibration


def response(status, content=b"ok", headers=None):
    value = requests.Response()
    value.status_code = status
    value.url = "https://collectionapi.metmuseum.org/example"
    value._content = content
    value._content_consumed = True
    value.headers.update(headers or {})
    return value


@pytest.fixture
def network(monkeypatch):
    now = [0.0]
    calls = []
    replies = []

    def sleep(seconds):
        now[0] += seconds

    def get(*args, **kwargs):
        calls.append(now[0])
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(calibration.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(calibration.time, "sleep", sleep)
    monkeypatch.setattr(calibration.requests, "Session", lambda: Mock(get=get))
    return calls, replies


def test_successful_requests_are_spaced_one_second_apart(network):
    calls, replies = network
    replies.extend([response(200), response(200), response(200)])
    downloader = calibration.Downloader()
    for _ in range(3):
        assert downloader.get("https://example.com/image") == b"ok"
    assert calls == [0, 1, 2]


def test_intermittent_forbidden_response_recovers_after_cooldown(network):
    calls, replies = network
    replies.extend([response(403), response(200)])
    assert calibration.Downloader().get("https://example.com/image") == b"ok"
    assert calls == [0, 15]


def test_persistent_access_refusal_stops_after_four_attempts(network):
    calls, replies = network
    replies.extend(response(403) for _ in range(4))
    with pytest.raises(PermissionError):
        calibration.Downloader().get("https://example.com/image")
    assert calls == [0, 15, 45, 105]


def test_retry_after_takes_precedence_over_shorter_cooldown(network):
    calls, replies = network
    replies.extend([response(429, headers={"Retry-After": "40"}), response(200)])
    calibration.Downloader().get("https://example.com/image")
    assert calls == [0, 40]


def test_retry_after_http_date_is_honored(network, monkeypatch):
    calls, replies = network
    monkeypatch.setattr(calibration.time, "time", lambda: 0)
    replies.extend([response(503, headers={"Retry-After": "Thu, 01 Jan 1970 00:00:40 GMT"}), response(200)])
    calibration.Downloader().get("https://example.com/image")
    assert calls == [0, 40]


def test_long_server_cooldown_stops_without_retrying_early(network):
    calls, replies = network
    replies.append(response(429, headers={"Retry-After": "600"}))
    with pytest.raises(RuntimeError, match="resume later"):
        calibration.Downloader().get("https://example.com/image")
    assert calls == [0]


def test_connection_failure_and_server_error_are_retried(network):
    calls, replies = network
    replies.extend([requests.ConnectionError("connection reset"), response(503), response(200)])
    calibration.Downloader().get("https://example.com/image")
    assert calls == [0, 15, 45]


@pytest.mark.parametrize("status", [401, 404])
def test_permanent_client_errors_are_not_retried(network, status):
    calls, replies = network
    replies.append(response(status))
    with pytest.raises((PermissionError, requests.HTTPError)):
        calibration.Downloader().get("https://example.com/image")
    assert calls == [0]


def test_collection_resumes_at_failed_object_and_keeps_published_lists_intact(tmp_path, monkeypatch):
    artifacts = tmp_path / "artifacts"
    published = tmp_path / "calibration"
    published.mkdir()
    (published / "urls.txt").write_text("old-calibration\n")
    monkeypatch.setattr(calibration, "ARTIFACTS", artifacts)
    monkeypatch.setattr(calibration, "CALIBRATION", published)
    monkeypatch.setattr(calibration, "CALIBRATION_COUNT", 2)
    monkeypatch.setattr(calibration, "INDEX_COUNT", 2)
    monkeypatch.setattr(calibration, "search_ids", lambda downloader: [1, 2, 3, 4, 5])
    visited = []

    def fetch(object_id, downloader):
        visited.append(object_id)
        if object_id == 3 and visited.count(3) == 1:
            raise PermissionError("temporary outage exhausted retries")
        # Object 2 is a duplicate of object 1 and must not enter the index.
        digest = "1" if object_id == 2 else str(object_id)
        return {"objectID": object_id, "url": f"https://example.com/{object_id}", "sha256": digest}

    monkeypatch.setattr(calibration, "fetch_record", fetch)
    with pytest.raises(PermissionError):
        calibration.collect()
    assert (published / "urls.txt").read_text() == "old-calibration\n"
    assert not (published / "index-urls.txt").exists()
    state = json.loads((artifacts / "collection-state.json").read_text())
    assert state["next_index"] == 2
    assert [r["objectID"] for r in state["selected"]] == [1]
    calibration.collect()
    assert visited == [1, 2, 3, 3, 4, 5]
    queries = (published / "urls.txt").read_text().splitlines()
    index = (published / "index-urls.txt").read_text().splitlines()
    assert len(queries) == len(index) == 2
    assert not set(queries) & set(index)

import json
from hashlib import sha256
from io import BytesIO
from unittest.mock import Mock

import calibration
import pytest
import requests
from PIL import Image


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
    replies.extend(
        [
            response(503, headers={"Retry-After": "Thu, 01 Jan 1970 00:00:40 GMT"}),
            response(200),
        ]
    )
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
    replies.extend(
        [requests.ConnectionError("connection reset"), response(503), response(200)]
    )
    calibration.Downloader().get("https://example.com/image")
    assert calls == [0, 15, 45]


@pytest.mark.parametrize("status", [401, 404])
def test_permanent_client_errors_are_not_retried(network, status):
    calls, replies = network
    replies.append(response(status))
    with pytest.raises((PermissionError, requests.HTTPError)):
        calibration.Downloader().get("https://example.com/image")
    assert calls == [0]


def test_prepare_uses_shared_calibration_images_and_rejects_changed_cached_bytes(
    tmp_path, monkeypatch
):
    artifacts = tmp_path / "artifacts"
    published = tmp_path / "calibration"
    published.mkdir()
    monkeypatch.setattr(calibration, "ARTIFACTS", artifacts)
    monkeypatch.setattr(calibration, "URLS", published / "urls.txt")
    monkeypatch.setattr(calibration, "HASHES", published / "image-hashes.json")
    image = BytesIO()
    Image.new("RGB", (4, 2), (255, 12, 7)).save(image, format="PNG")
    data = image.getvalue()
    urls = ["https://example.com/query", "https://example.com/index"]
    (published / "urls.txt").write_text("\n".join(urls) + "\n")
    (published / "image-hashes.json").write_text(
        json.dumps({url: sha256(data).hexdigest() for url in urls})
    )
    downloader = Mock(get=Mock(return_value=data))
    monkeypatch.setattr(calibration, "Downloader", lambda: downloader)
    calibration.prepare(448)
    assert [call.args[0] for call in downloader.get.call_args_list] == urls
    assert all(calibration.image_path(url).read_bytes() == data for url in urls)
    prepared = json.loads((artifacts / "calibration-448/manifest.json").read_text())
    assert [record["url"] for record in prepared] == urls
    pixels = (artifacts / "calibration-448" / prepared[0]["file"]).read_bytes()
    assert len(pixels) == 448 * 448 * 3
    assert sha256(pixels).hexdigest() == prepared[0]["pixel_sha256"]
    assert pixels[:3] == bytes(3)  # Calibration reference pixels use centered black padding.
    calibration.prepare(512)
    assert downloader.get.call_count == 2
    calibration.image_path(urls[1]).write_bytes(b"changed cached bytes")
    with pytest.raises(ValueError, match="Image hash mismatch"):
        calibration.prepare(512)

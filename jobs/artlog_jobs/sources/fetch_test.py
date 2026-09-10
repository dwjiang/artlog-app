import json

import httpx
import pytest

from ..polite_http import PoliteClient
from .fetch import download, fetch_aic_live, validate_met_header


def client(handler):
    return PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )


def test_met_requires_object_number_and_reports_the_actual_header():
    with pytest.raises(RuntimeError, match="STOP.*Object Number.*Actual header"):
        validate_met_header(["Object ID", "Accession Number"])


def test_download_resumes_ranges_and_reuses_a_completed_file(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.headers["Range"])
        start = int(request.headers["Range"].split("=")[1].split("-")[0])
        return httpx.Response(
            206,
            content=b"abcdef"[start : start + 3],
            headers={"Content-Range": f"bytes {start}-{start + 2}/6", "ETag": '"v1"'},
        )

    out = tmp_path / "dump"
    with client(handler) as http:
        download(http, "https://example.org/dump", out, chunk_bytes=3)
        download(http, "https://example.org/dump", out, chunk_bytes=3)
    assert out.read_bytes() == b"abcdef"
    assert calls == ["bytes=0-2", "bytes=3-5"]


def test_interrupted_download_keeps_bytes_and_resumes_with_validator(tmp_path):
    out = tmp_path / "dump"

    def interrupted(request):
        if request.headers["Range"] == "bytes=0-2":
            return httpx.Response(
                206, content=b"abc", headers={"Content-Range": "bytes 0-2/6", "ETag": '"v1"'}
            )
        raise httpx.ReadTimeout("interrupted")

    with client(interrupted) as http, pytest.raises(httpx.ReadTimeout):
        download(http, "https://example.org/dump", out, chunk_bytes=3)

    def resumed(request):
        assert request.headers["Range"] == "bytes=3-5"
        assert request.headers["If-Range"] == '"v1"'
        return httpx.Response(
            206, content=b"def", headers={"Content-Range": "bytes 3-5/6", "ETag": '"v1"'}
        )

    with client(resumed) as http:
        download(http, "https://example.org/dump", out, chunk_bytes=3)
    assert out.read_bytes() == b"abcdef"


def test_download_replaces_partial_when_server_returns_full_representation(tmp_path):
    out = tmp_path / "dump"
    out.with_suffix(".part").write_bytes(b"old")
    out.with_suffix(".download.json").write_text(
        json.dumps({"url": "https://example.org/dump", "validator": '"old"'})
    )
    with client(lambda _: httpx.Response(200, content=b"new version")) as http:
        download(http, "https://example.org/dump", out)
    assert out.read_bytes() == b"new version"


def test_download_rejects_wrong_range_without_appending(tmp_path):
    with (
        client(
            lambda _: httpx.Response(206, content=b"abc", headers={"Content-Range": "bytes 3-5/6"})
        ) as http,
        pytest.raises(ValueError, match="range"),
    ):
        download(http, "https://example.org/dump", tmp_path / "dump")
    assert not (tmp_path / "dump").exists()


def test_live_aic_fetch_preserves_response_licenses_and_resumes_pages(tmp_path):
    calls = []

    def handler(request):
        params = json.loads(request.url.params["params"])
        after = params["query"]["bool"]["filter"][1]["range"]["id"]["gt"]
        calls.append(after)
        assert params["page"] == 1
        assert request.headers["AIC-User-Agent"] == "test"
        return httpx.Response(
            200,
            json={
                "data": [{"id": after + 1, "artwork_type_title": "Painting"}],
                "pagination": {"total": 2 - after},
                "info": {"license_text": "CC0 metadata"},
            },
        )

    with client(handler) as http:
        result = fetch_aic_live(http, tmp_path)
        assert fetch_aic_live(http, tmp_path) == result
    assert calls == [0, 1]
    assert result["complete"] is True and result["rows"] == 2
    assert result["files"] == ["paintings-after-0.json", "paintings-after-1.json"]
    assert (
        json.loads((tmp_path / result["files"][0]).read_text())["info"]["license_text"]
        == "CC0 metadata"
    )


def test_resumed_download_rejects_a_different_etag(tmp_path):
    out = tmp_path / "dump"
    out.with_suffix(".part").write_bytes(b"abc")
    out.with_suffix(".download.json").write_text(
        json.dumps({"url": "https://example.org/dump", "validator": '"v1"', "bytes": 6})
    )
    with (
        client(
            lambda _: httpx.Response(
                206, content=b"def", headers={"Content-Range": "bytes 3-5/6", "ETag": '"v2"'}
            )
        ) as http,
        pytest.raises(ValueError, match="revision"),
    ):
        download(http, "https://example.org/dump", out)
    assert out.with_suffix(".part").read_bytes() == b"abc"


def test_resume_after_final_chunk_finishes_without_an_out_of_range_request(tmp_path):
    out = tmp_path / "dump"
    out.with_suffix(".part").write_bytes(b"abcdef")
    out.with_suffix(".download.json").write_text(
        json.dumps({"url": "https://example.org/dump", "validator": '"v1"', "bytes": 6})
    )

    def unexpected(_):
        raise AssertionError("complete bytes must not request another range")

    with client(unexpected) as http:
        download(http, "https://example.org/dump", out)
    assert out.read_bytes() == b"abcdef"


def test_blocked_aic_refresh_records_coverage_and_stops_requests(tmp_path):
    with (
        client(lambda _: httpx.Response(403, json={"error": "Invalid number of results"})) as http,
        pytest.raises(httpx.HTTPStatusError),
    ):
        fetch_aic_live(http, tmp_path)
    stats = json.loads((tmp_path / "stats.json").read_text())
    assert stats["complete"] is False
    assert stats["afterId"] == 0
    assert stats["httpStatus"] == 403
    assert "Invalid number of results" in stats["error"]


def test_aic_continues_past_the_servers_result_window_and_resumes_after_failure(tmp_path):
    calls = []

    def handler(request):
        params = json.loads(request.url.params["params"])
        after = params["query"]["bool"]["filter"][1]["range"]["id"]["gt"]
        calls.append(after)
        assert params["page"] == 1
        if after == 1000 and calls.count(after) == 1:
            return httpx.Response(403, json={"error": "blocked"})
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": id, "artwork_type_title": "Painting"}
                    for id in range(after + 1, min(after + 100, 1105) + 1)
                ],
                "pagination": {"total": 1105 - after},
            },
        )

    with client(handler) as http:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_aic_live(http, tmp_path)
        result = fetch_aic_live(http, tmp_path)
    assert calls == [*range(0, 1001, 100), 1000, 1100]
    assert result["rows"] == 1105 and result["complete"] is True
    assert len(result["files"]) == 12


@pytest.mark.parametrize(
    ("ids", "total", "message"),
    [
        ([1, 1], 3, "increasing"),
        ([2, 1], 3, "increasing"),
        ([0], 3, "increasing"),
        ([], 3, "stalled"),
        ([1, 2], 1, "total"),
    ],
)
def test_aic_rejects_invalid_pages_without_publishing_a_complete_snapshot(
    tmp_path, ids, total, message
):
    with (
        client(
            lambda _: httpx.Response(
                200,
                json={
                    "data": [{"id": id, "artwork_type_title": "Painting"} for id in ids],
                    "pagination": {"total": total},
                },
            )
        ) as http,
        pytest.raises(RuntimeError, match=message),
    ):
        fetch_aic_live(http, tmp_path)
    assert json.loads((tmp_path / "stats.json").read_text())["complete"] is False


def test_aic_rejects_a_census_that_changes_during_a_resumed_run(tmp_path):
    def handler(request):
        params = json.loads(request.url.params["params"])
        after = params["query"]["bool"]["filter"][1]["range"]["id"]["gt"]
        return httpx.Response(
            200,
            json={
                "data": [{"id": after + 1, "artwork_type_title": "Painting"}],
                "pagination": {"total": 3},
            },
        )

    with client(handler) as http, pytest.raises(RuntimeError, match="census changed"):
        fetch_aic_live(http, tmp_path)
    stats = json.loads((tmp_path / "stats.json").read_text())
    assert stats["complete"] is False and stats["rows"] == 1

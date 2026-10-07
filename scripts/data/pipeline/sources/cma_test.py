import json
from pathlib import Path

import httpx
import pytest

from ..polite_http import PoliteClient
from .cma import FLAT_TYPES, fetch_cma, iter_records

FIXTURES = Path(__file__).parents[2] / "fixtures"
TYPES = sorted(FLAT_TYPES)


def records():
    rows = json.loads((FIXTURES / "cma-sample.json").read_text())["data"]
    return {triple[0].key: triple for triple in iter_records(rows)}


def client(handler):
    return PoliteClient(
        user_agent="test",
        robots=False,
        per_host_rps=1000,
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )


def page(total, ids):
    return {"info": {"total": total}, "data": [{"id": id} for id in ids]}


def two_per_type_one_per_page(request):
    artwork_type, skip = request.url.params["type"], int(request.url.params["skip"])
    return httpx.Response(200, json=page(2, [TYPES.index(artwork_type) * 10 + skip + 1]))


def test_cleveland_painting_matches_the_ingest_contract():
    assert [record.row() for record in records()["cma:1001"]] == [
        {
            "key": "cma:1001",
            "title": "Harbor at Dusk",
            "artist": "Ada Painter",
            "date": "c. 1900",
            "yearStart": 1895,
            "yearEnd": 1905,
            "rightsStatus": "public_domain",
            "multiplicity": "unknown",
        },
        {
            "key": "cma:1001",
            "artworkKey": "cma:1001",
            "ownerKey": "wikidata:Q657415",
            "accession": "1900.1",
            "medium": "oil on canvas",
            "dimensions": "Framed: 90 x 78 cm; Unframed: 76 x 64 cm",
            "source": "corpus",
            "sourceId": "1001",
            "imageRef": "https://openaccess-cdn.clevelandart.org/1900.1/1900.1_web.jpg",
            "pageUrl": "https://clevelandart.org/art/1900.1",
            "thumbnailUrl": "https://openaccess-cdn.clevelandart.org/1900.1/1900.1_web.jpg",
        },
        {
            "objectKey": "cma:1001",
            "venueKey": "wikidata:Q657415",
            "gallery": "204 Colonial American",
            "onView": True,
            "source": "feed",
            "confidence": 0.9,
        },
    ]


def test_cleveland_keeps_only_flat_cc0_works_with_an_image():
    assert list(records()) == ["cma:1001", "cma:1002", "cma:1003", "cma:1004", "cma:1005"]


def test_cleveland_prints_and_photographs_are_multiples_with_fallback_labels():
    print_, photograph = records()["cma:1002"], records()["cma:1003"]
    assert print_[0].artist == "Workshop of Ben Printer"
    assert (photograph[0].title, photograph[0].artist) == ("Untitled", "Unknown artist")
    assert {print_[0].multiplicity, photograph[0].multiplicity} == {"multiple"}
    assert photograph[1].pageUrl == "https://www.clevelandart.org/art/1900.3"


def test_cleveland_works_outside_the_building_are_not_on_view():
    assert {key: (triple[2].onView, triple[2].gallery) for key, triple in records().items()} == {
        "cma:1001": (True, "204 Colonial American"),
        "cma:1002": (False, None),
        "cma:1003": (False, None),
        "cma:1004": (True, "ATRM Atrium"),
        "cma:1005": (False, None),
    }


def test_cleveland_fetch_pages_each_flat_type_and_resumes_after_a_failure(tmp_path):
    calls = []

    def handler(request):
        params = request.url.params
        calls.append((params["type"], int(params["skip"])))
        assert params["has_image"] == "1" and "cc0" in params
        assert "images" in params["fields"].split(",")
        if calls.count(("Print", 1)) == 1 and calls[-1] == ("Print", 1):
            return httpx.Response(404, text="missing page")
        return two_per_type_one_per_page(request)

    with client(handler) as http:
        with pytest.raises(httpx.HTTPStatusError):
            fetch_cma(http, tmp_path)
        interrupted = json.loads((tmp_path / "stats.json").read_text())
        result = fetch_cma(http, tmp_path)
        assert fetch_cma(http, tmp_path) == result
    pages = [(artwork_type, skip) for artwork_type in TYPES for skip in (0, 1)]
    failed = pages.index(("Print", 1))
    assert calls == pages[: failed + 1] + pages[failed:]
    assert interrupted["complete"] is False and interrupted["httpStatus"] == 404
    assert result["complete"] is True and result["rows"] == result["total"] == len(pages)
    assert result["files"][:2] == ["calligraphy-skip-0.json", "calligraphy-skip-1.json"]
    assert "portrait-miniature-skip-1.json" in result["files"]
    assert "fetchedAt" in result


def test_cleveland_fetch_rejects_a_census_that_changes_mid_run(tmp_path):
    def handler(request):
        skip = int(request.url.params["skip"])
        return httpx.Response(200, json=page(3 + skip, [skip + 1]))

    with client(handler) as http, pytest.raises(RuntimeError, match="census changed"):
        fetch_cma(http, tmp_path)
    stats = json.loads((tmp_path / "stats.json").read_text())
    assert stats["complete"] is False and stats["rows"] == 1


@pytest.mark.parametrize(
    ("ids", "total", "message"),
    [([], 3, "stalled"), ([], 0, "stalled"), ([1], 3, "repeated"), ([1, 2], 1, "total")],
)
def test_cleveland_fetch_rejects_invalid_pages_without_completing(tmp_path, ids, total, message):
    with (
        client(lambda _: httpx.Response(200, json=page(total, ids))) as http,
        pytest.raises(RuntimeError, match=message),
    ):
        fetch_cma(http, tmp_path)
    assert json.loads((tmp_path / "stats.json").read_text())["complete"] is False

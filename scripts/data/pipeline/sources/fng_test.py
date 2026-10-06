import gzip
import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from ..owner_map import ATENEUM_KEY, KIASMA_KEY, SINEBRYCHOFF_KEY
from ..polite_http import PoliteClient
from .fng import MIN_ROWS, fetch_fng, iter_records

FIXTURES = Path(__file__).parents[2] / "fixtures"
TODAY = date(2026, 10, 6)
COLLECTION_DISPLAY = (
    "Ajan kysymys, kokoelmanäyttely / En tidsfråga, samlingsutställning / "
    "A Question of Time, collection exhibition"
)


def records(today=TODAY):
    rows = json.loads((FIXTURES / "fng-sample.json").read_text())
    return {triple[0].key: triple for triple in iter_records(rows, today=today)}


def client(handler):
    return PoliteClient(
        user_agent="test",
        robots=False,
        per_host_rps=1000,
        transport=httpx.MockTransport(handler),
        sleep=lambda _: None,
    )


def dump(count):
    return json.dumps([{"objectId": id} for id in range(count)]).encode()


def test_fng_painting_matches_the_ingest_contract():
    assert [record.row() for record in records()["fng:101"]] == [
        {
            "key": "fng:101",
            "title": "Lake View",
            "artist": "Ada Maalari",
            "date": "circa 1890–1895",
            "yearStart": 1890,
            "yearEnd": 1895,
            "rightsStatus": "public_domain",
            "multiplicity": "unknown",
        },
        {
            "key": "fng:101",
            "artworkKey": "fng:101",
            "ownerKey": "wikidata:Q2983474",
            "accession": "A I 101",
            "medium": "oil, pohjustamaton kangas",
            "source": "corpus",
            "sourceId": "101",
            "imageRef": "https://kokoelma.kansallisgalleria.fi/media-assets/1/jpg/1000/9012.jpg",
            "pageUrl": "https://www.kansallisgalleria.fi/en/object/101",
            "thumbnailUrl": "https://kokoelma.kansallisgalleria.fi/media-assets/1/jpg/500/9012.jpg",
        },
        {
            "objectKey": "fng:101",
            "venueKey": "wikidata:Q754507",
            "gallery": COLLECTION_DISPLAY,
            "onView": True,
            "source": "feed",
            "confidence": 0.9,
        },
    ]


def test_fng_keeps_only_flat_cc0_artworks_of_its_three_museums():
    assert list(records()) == ["fng:101", "fng:102", "fng:103", "fng:104", "fng:105"]


def test_fng_prints_and_photographs_are_multiples_with_fallback_labels():
    works = {key: triple[0] for key, triple in records().items()}
    assert (works["fng:102"].title, works["fng:102"].artist) == ("Katu", "Ben Kaivertaja")
    assert (works["fng:102"].date, works["fng:102"].yearEnd) == ("1700", None)
    assert (works["fng:104"].title, works["fng:104"].artist) == ("Untitled", "Unknown artist")
    assert works["fng:105"].date == "1920"
    assert {key for key, work in works.items() if work.multiplicity == "multiple"} == {
        "fng:102",
        "fng:105",
    }


def test_fng_works_are_on_view_in_a_current_exhibition_at_one_of_its_museums():
    assert {
        key: (triple[2].venueKey, triple[2].onView, triple[2].gallery)
        for key, triple in records().items()
    } == {
        "fng:101": (ATENEUM_KEY, True, COLLECTION_DISPLAY),
        "fng:102": (SINEBRYCHOFF_KEY, False, None),
        "fng:103": (SINEBRYCHOFF_KEY, True, "Riikinkukko puutarhassa - Mathias Withoosin Rooma"),
        "fng:104": (ATENEUM_KEY, False, None),
        "fng:105": (KIASMA_KEY, True, "Nelivärinen uni Kiasman kokoelmanäyttely 2026"),
    }


@pytest.mark.parametrize(
    ("today", "on_view"),
    [
        (date(2026, 2, 26), False),
        (date(2026, 2, 27), True),
        (date(2027, 1, 10), True),
        (date(2027, 1, 11), False),
    ],
)
def test_fng_exhibition_dates_include_the_opening_and_closing_days(today, on_view):
    assert records(today)["fng:105"][2].onView is on_view


def test_fng_collection_display_stays_open_until_a_newer_exhibition_takes_the_work():
    before_opening = records(date(2026, 9, 23))["fng:103"][2]
    assert (before_opening.venueKey, before_opening.gallery) == (ATENEUM_KEY, COLLECTION_DISPLAY)
    assert records(date(2040, 1, 1))["fng:101"][2].onView is True


@pytest.mark.parametrize("served_as", ["content-encoding", "gzip-file"])
def test_fng_fetch_decompresses_the_dump_once_and_writes_a_manifest(tmp_path, served_as):
    headers = {"Last-Modified": "Tue, 06 Oct 2026 12:07:12 GMT"}
    headers.update(
        {"Content-Encoding": "gzip"}
        if served_as == "content-encoding"
        else {"Content-Type": "application/gzip"}
    )
    body = gzip.compress(dump(MIN_ROWS + 1))
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, content=body, headers=headers)

    with client(handler) as http:
        result = fetch_fng(http, tmp_path)
        assert fetch_fng(http, tmp_path) == result
    assert calls == ["https://www.kansallisgalleria.fi/api/v1/objects"]
    assert result["complete"] is True and result["rows"] == MIN_ROWS + 1
    assert result["files"] == ["objects.json"]
    assert result["lastModified"] == "Tue, 06 Oct 2026 12:07:12 GMT"
    assert len(json.loads((tmp_path / "objects.json").read_text())) == MIN_ROWS + 1


def test_fng_fetch_rejects_an_implausibly_small_dump_and_retries_next_run(tmp_path):
    with (
        client(lambda _: httpx.Response(200, content=dump(10))) as http,
        pytest.raises(RuntimeError, match="more than 50,000"),
    ):
        fetch_fng(http, tmp_path)
    stats = json.loads((tmp_path / "stats.json").read_text())
    assert stats["complete"] is False and "50,000" in stats["error"]
    assert not (tmp_path / "objects.json").exists()
    with client(lambda _: httpx.Response(200, content=dump(MIN_ROWS + 1))) as http:
        assert fetch_fng(http, tmp_path)["complete"] is True

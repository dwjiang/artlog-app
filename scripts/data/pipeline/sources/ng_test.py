import json

import httpx
import pytest

from ..polite_http import PoliteClient
from . import ng


def picture(number, room, custodian=ng.CUSTODIAN):
    return {
        "@admin": {"uid": f"uid-{number}"},
        "identifier": [
            {"type": "PID", "value": f"uid-{number}"},
            {"type": "object number", "value": number},
        ],
        "summary": {"title": "The Arnolfini Portrait"},
        "creation": [{"maker": [{"summary": {"title": "Jan van Eyck"}}]}],
        "location": {
            "current": {
                "summary": {"title": room},
                "@link": {"custodian": {"@admin": {"uid": custodian}}},
            }
        },
    }


def client(hits, total):
    def handler(request):
        query = json.loads(request.url.params["source"])
        assert query["query"]["bool"]["filter"][1] == {"match": {"classification.value": "Picture"}}
        body = {"hits": {"total": {"value": total}, "hits": [{"_source": hit} for hit in hits]}}
        return httpx.Response(200, json=body)

    return PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(handler),
        per_host_rps=1000,
        sleep=lambda _: None,
    )


def test_a_picture_is_on_view_in_its_room_only_while_the_gallery_holds_it():
    assert ng.row(picture("NG186", "Room 52")) == {
        "id": "uid-NG186",
        "accession": "NG186",
        "title": "The Arnolfini Portrait",
        "artist": "Jan van Eyck",
        "url": "https://www.nationalgallery.org.uk/paintings/NG186",
        "onView": True,
        "gallery": "Room 52",
    }
    assert not ng.row(picture("NG1", "Not on display"))["onView"]
    assert not ng.row(picture("NG928", "Room 9", custodian="borghese"))["onView"]


def test_fetch_keeps_every_picture_and_refuses_a_partial_answer(tmp_path, monkeypatch):
    monkeypatch.setattr(ng, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    hits = [picture("NG1", "Room 1"), picture("NG2", "Not on display")]
    assert [row["accession"] for row in ng.fetch(client(hits, 2), tmp_path)] == ["NG1", "NG2"]
    with pytest.raises(RuntimeError, match="partial"):
        ng.fetch(client(hits, 3), tmp_path)

import httpx
import pytest

from ..polite_http import PoliteClient
from . import vgm


def item(path, title):
    return f"""<div class="collection-art-object-list-item">
<a class="collection-art-object-wrapper" href="/en/{path}">
<p class="collection-art-object-item-title">{title}</p>
<p class="collection-art-object-item-creator">Vincent van Gogh, 1889</p></a></div>"""


def client(pages, total):
    def handler(request):
        assert request.url.params["OnView"] == "true"
        assert request.headers["Accept"] == "application/json"
        index = int(request.url.params["from"]) // 2
        body = {
            "resultsHtml": "".join(item(*work) for work in pages[index]),
            "hasMoreResults": index + 1 < len(pages),
            "totalResults": total,
        }
        return httpx.Response(200, json=body)

    return PoliteClient(
        user_agent="test",
        transport=httpx.MockTransport(
            lambda r: httpx.Response(404) if r.url.path == "/robots.txt" else handler(r)
        ),
        per_host_rps=1000,
        sleep=lambda _: None,
    )


def test_pages_through_every_work_listed_as_on_view(tmp_path, monkeypatch):
    monkeypatch.setattr(vgm, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    pages = [
        [("collection/s0031V1962", "Sunflowers"), ("collection/s0047V1962", "The Bedroom")],
        # Letters and Japanese prints live in their own sections.
        [("letters/collection/b0652aV1962", "Letter to Theo")],
    ]
    rows = vgm.fetch(client(pages, 3), tmp_path)
    assert rows[0] == {
        "id": "s0031V1962",
        "accession": "s0031V1962",
        "title": "Sunflowers",
        "artist": "Vincent van Gogh",
        "url": "https://www.vangoghmuseum.nl/en/collection/s0031V1962",
        "onView": True,
    }
    assert [row["accession"] for row in rows] == ["s0031V1962", "s0047V1962", "b0652aV1962"]
    assert rows[2]["url"] == "https://www.vangoghmuseum.nl/en/letters/collection/b0652aV1962"
    with pytest.raises(RuntimeError, match="count changed"):
        vgm.fetch(client(pages, 4), tmp_path)

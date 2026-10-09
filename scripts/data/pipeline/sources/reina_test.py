import httpx

from ..polite_http import PoliteClient
from . import reina


def work(id, path, registry):
    return {
        "id": id,
        "url": {"path": path},
        "title": {"value": "<p>Guitarra y periódico</p>"},
        "author": [{"entity": {"name": {"value": "<p>Gris, Juan</p>"}}}],
        "registryID": registry,
        "artworkStatus": "exposed",
        "year": "1925",
    }


def page_data(content):
    return {"result": {"pageContext": {"node": {"data": {"content": content}}}}}


def handler(request):
    if request.url.path == "/robots.txt":
        return httpx.Response(404)
    if request.url.host == "buscador.museoreinasofia.es":
        results = [
            work("1", "/colecciones/obra/guitarra", "AS01234"),
            work("2", "/colecciones/obra/otra", "DE00001"),
        ]
        return httpx.Response(
            200, json={"results": results, "metadata": {"totalPages": 1, "totalResults": 2}}
        )
    if request.url.path.endswith("/colecciones/territorios-vanguardia/page-data.json"):
        return httpx.Response(
            200, json=page_data({"paragraphs": [{"link": "/colecciones/sala-20506"}]})
        )
    if request.url.path.endswith("/colecciones/sala-20506/page-data.json"):
        content = {
            "title": "Sala 205.06",
            "translations": [{"title": "Room 205.06", "language": {"id": "en"}}],
            "artworks": {"data": [{"url": {"path": "/colecciones/obra/guitarra"}}]},
        }
        return httpx.Response(200, json=page_data(content))
    return httpx.Response(200, json=page_data({}))


def test_exposed_works_take_their_room_from_the_room_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(reina, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    client = PoliteClient(
        user_agent="test",
        transport=httpx.MockTransport(handler),
        per_host_rps=1000,
        sleep=lambda _: None,
    )
    first, second = reina.fetch(client, tmp_path)
    assert first == {
        "id": "1",
        "accession": "AS01234",
        "title": "Guitarra y periódico",
        "artist": "Gris, Juan",
        "url": "https://www.museoreinasofia.es/colecciones/obra/guitarra",
        "onView": True,
        "gallery": "Room 205.06",
    }
    assert second["onView"] and second["gallery"] is None

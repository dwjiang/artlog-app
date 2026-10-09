import httpx

from ..polite_http import PoliteClient
from . import louvre


def handler(request):
    if request.url.path == "/robots.txt":
        return httpx.Response(200, text="User-agent: *\nDisallow: /search/export\n")
    level = request.url.path.rsplit("_", 1)[1].removesuffix(".json")
    rooms = {
        "1": {
            "711": {
                "nom": "Salle 711 - Salle de la Joconde",
                "aile": "Denon",
                "etage": "Niveau 1",
                "oeuvres": [
                    {
                        "alias": "/en/ark:/53355/cl010062370",
                        "titre": "La Joconde",
                        "auteur": "Léonard de Vinci",
                    }
                ],
            }
        }
    }
    return httpx.Response(200, json=rooms.get(level, {}))


def test_works_in_a_room_are_on_view_and_name_their_wikidata_item(tmp_path, monkeypatch):
    queries = []

    def sparql(query, *, user_agent):
        queries.append(query)
        return [
            {"item": {"value": f"http://www.wikidata.org/entity/{item}"}, "ark": {"value": ark}}
            for item, ark in (
                ("Q12418", "010062370"),
                ("Q1", "010066967"),
                ("Q2", "010000001"),
                ("Q3", "010000001"),
            )
        ]

    monkeypatch.setattr(louvre, "sparql", sparql)
    monkeypatch.setattr(louvre, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    client = PoliteClient(
        user_agent="test",
        transport=httpx.MockTransport(handler),
        per_host_rps=1000,
        sleep=lambda _: None,
    )
    rows = louvre.fetch(client, tmp_path)
    assert rows == [
        {
            "id": "cl010062370",
            "wikidataId": "Q12418",
            "title": "La Joconde",
            "artist": "Léonard de Vinci",
            "url": "https://collections.louvre.fr/en/ark:/53355/cl010062370",
            "onView": True,
            "gallery": "Salle 711 - Salle de la Joconde (Denon, Niveau 1)",
        },
        {
            "id": "cl010066967",
            "wikidataId": "Q1",
            "title": None,
            "artist": None,
            "url": "https://collections.louvre.fr/en/ark:/53355/cl010066967",
            "onView": False,
            "gallery": None,
        },
    ]
    # Works its departments hold count, not only those filed under the museum itself.
    assert "wd:Q19675" in queries[0] and "wd:Q3044768" in queries[0]

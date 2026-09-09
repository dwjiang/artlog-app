import json
from pathlib import Path

import httpx
import pytest

from . import wikidata


def binding(qid="Q1", **values):
    return {
        key: {"value": value}
        for key, value in {
            "m": f"http://www.wikidata.org/entity/{qid}",
            "coord": "Point(-21.94 64.14)",
            "website": "https://museum.example/",
            "nameAny": "Safn",
            **values,
        }.items()
    }


def test_saved_iceland_response_has_real_named_geolocated_venues():
    data = json.loads((Path(__file__).parents[1] / "fixtures/wikidata-iceland.json").read_text())
    venues = wikidata.parse_venues(data["results"]["bindings"], "IS")
    assert len(venues) > 20
    assert len({row.qid for row in venues}) == len(venues)
    assert all(row.website and row.name and row.country_iso == "IS" for row in venues)
    assert any("National Museum" in row.name for row in venues)


def test_parser_prefers_english_collapses_websites_and_preserves_ancestry():
    rows = wikidata.parse_venues(
        [
            binding(admin="http://www.wikidata.org/entity/Q2"),
            binding(nameEn="Museum", website="https://second.example/", metroAdmin="Q62"),
        ],
        "IS",
    )
    assert rows == [
        wikidata.VenueRow(
            "Q1", "Museum", 64.14, -21.94, "https://museum.example/", "IS", ("Q2", "Q62")
        )
    ]


@pytest.mark.parametrize("coord", ["", "Point(1 91)", "Point(181 1)", "Point(1 1e999)"])
def test_invalid_coordinates_are_excluded(coord):
    assert wikidata.parse_venues([binding(coord=coord)], "IS") == []


def test_missing_website_is_excluded():
    assert wikidata.parse_venues([binding(website="")], "IS") == []


def test_unknown_value_nodes_are_neither_websites_nor_administrative_ids():
    unknown = "http://www.wikidata.org/.well-known/genid/unknown"
    rows = wikidata.parse_venues([binding(website=unknown, admin=unknown)], "IS")
    assert len(rows) == 1
    assert rows[0].website is None
    assert rows[0].admin_qids == ()
    assert wikidata.parse_venues([binding(coord=unknown)], "IS") == []


def test_unmapped_country_includes_both_classes_without_duplicate_venues():
    queries = []
    responses = iter(
        [
            [binding("Q1"), binding("Q2")],
            [binding("Q2"), binding("Q3")],
            [binding("Q2"), binding("Q3")],
        ]
    )

    def fetch(query, **kwargs):
        queries.append(query)
        return next(responses)

    rows = list(
        wikidata.iter_museums({"unknown": []}, user_agent="test", fetch=fetch, known_qids={"Q1"})
    )
    assert [row.qid for row in rows] == ["Q2", "Q3"]
    assert all(row.country_iso == "unknown" for row in rows)
    assert len(queries) == 3
    assert "wd:Q1 " not in queries[2]


def test_global_census_over_limit_stops_before_metadata(monkeypatch):
    monkeypatch.setattr(wikidata, "MAX_VENUES", 1)
    with pytest.raises(RuntimeError, match="STOP: Wikidata exceeds"):
        list(
            wikidata.iter_museums(
                {"unknown": []},
                user_agent="test",
                known_qids=set(),
                fetch=lambda *args, **kwargs: [binding("Q1"), binding("Q2")],
            )
        )


def test_country_at_limit_slices_all_admins_and_missing_admin(monkeypatch):
    monkeypatch.setattr(wikidata, "SLICE_LIMIT", 2)
    queries = []
    responses = iter(
        [
            [binding("Q1"), binding("Q2")],
            [
                {"admin": {"value": "http://www.wikidata.org/entity/Q10"}},
                {"admin": {"value": "http://www.wikidata.org/.well-known/genid/unknown"}},
            ],
            [binding("Q1")],
            [binding("Q2")],
            [binding("Q2")],
        ]
    )

    def fetch(query, **kwargs):
        queries.append(query)
        return next(responses)

    venues = list(
        wikidata.iter_museums({"IS": ["Q189"], "GB": ["Q145"]}, user_agent="test", fetch=fetch)
    )
    assert [row.qid for row in venues] == ["Q1", "Q2"]
    assert "?m wdt:P131 wd:Q10" in queries[2]
    assert "?m wdt:P131 ?area" in queries[3]
    assert 'REGEX(STR(?area), "/Q[1-9][0-9]*$")' in queries[3]
    assert all("OFFSET" not in query for query in queries)
    assert "wd:Q1007870" in queries[0]


def test_truncated_admin_slice_is_never_accepted(monkeypatch):
    monkeypatch.setattr(wikidata, "SLICE_LIMIT", 1)
    with pytest.raises(wikidata.IncompleteCountry, match="IS"):
        list(
            wikidata.iter_museums(
                {"IS": ["Q189"]},
                user_agent="test",
                fetch=lambda query, **kwargs: (
                    [] if "SELECT DISTINCT ?admin" in query else [binding()]
                ),
            )
        )


def test_timeout_after_admin_slicing_reports_country():
    def fetch(query, **kwargs):
        raise httpx.ReadTimeout("deadline")

    with pytest.raises(wikidata.IncompleteCountry, match="IS"):
        list(wikidata.iter_museums({"IS": ["Q189"]}, user_agent="test", fetch=fetch))


def test_sparql_posts_json_accept_and_retries_retry_after(monkeypatch):
    requests = []
    waits = []

    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": "7"})
        return httpx.Response(200, json={"results": {"bindings": [binding()]}})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    real_client = httpx.Client

    def factory(**kwargs):
        client.headers.update(kwargs["headers"])
        return client

    monkeypatch.setattr(wikidata.httpx, "Client", factory)
    monkeypatch.setattr(wikidata.time, "sleep", waits.append)
    monkeypatch.setattr(wikidata, "_next_request", 0)
    assert wikidata.sparql("SELECT * WHERE {}", user_agent="artlog-test/1") == [binding()]
    assert 7 in waits
    assert requests[0].method == "POST"
    assert requests[0].headers["User-Agent"] == "artlog-test/1"
    assert requests[0].headers["Accept"] == "application/sparql-results+json"
    assert b"query=" in requests[0].content
    monkeypatch.setattr(wikidata.httpx, "Client", real_client)


def test_rejects_invalid_country_ids_before_network():
    with pytest.raises(ValueError, match="Invalid Wikidata"):
        list(wikidata.iter_museums({"IS": ["Q189 } UNION { ?x ?y ?z"]}, user_agent="test"))

import json
from itertools import pairwise
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


def places(*chain):
    """Build a P131 chain from (qid, kinds) pairs, nearest first."""
    parents = {qid: [parent] for (qid, _), (parent, _) in pairwise(chain)}
    kinds = {qid: frozenset(kinds.split()) for qid, kinds in chain}
    return parents, kinds


def test_city_is_the_nearest_locality_below_larger_areas():
    village = places(("Q1", "settlement"), ("Q2", ""), ("Q3", "municipality settlement"))
    assert wikidata.pick_city(["Q1"], *village) == "Q1"
    comune = places(("Q10", "municipality"), ("Q11", "settlement"), ("Q12", ""))
    assert wikidata.pick_city(["Q10"], *comune) == "Q10"


def test_places_inside_a_city_resolve_to_the_city():
    arrondissement = places(("Q1", "settlement neighborhood"), ("Q2", ""), ("Q90", "city"))
    assert wikidata.pick_city(["Q1"], *arrondissement) == "Q90"
    marseille = places(("Q1", "settlement neighborhood"), ("Q23482", "municipality"))
    assert wikidata.pick_city(["Q1"], *marseille) == "Q23482"
    manhattan = places(("Q11299", "city"), ("Q60", "city"), ("Q1384", ""))
    assert wikidata.pick_city(["Q11299"], *manhattan) == "Q60"


def test_venues_outside_any_locality_have_no_city():
    assert wikidata.pick_city(["Q99"], *places(("Q99", ""), ("Q30", ""))) is None
    greater_london = places(("Q1", ""), ("Q23306", "settlement region"), ("Q21", ""))
    assert wikidata.pick_city(["Q1"], *greater_london) is None
    county = places(("Q108403", "municipality region"), ("Q1223", ""))
    assert wikidata.pick_city(["Q108403"], *county) is None


def test_a_city_listed_beside_its_county_wins():
    parents = {"Q23556": ["Q1428"], "Q1000": ["Q1428"]}
    kinds = {
        "Q23556": frozenset({"city"}),
        "Q1000": frozenset({"municipality", "settlement"}),
        "Q1428": frozenset(),
    }
    assert wikidata.pick_city(["Q1000", "Q23556"], parents, kinds) == "Q23556"
    assert wikidata.pick_city([], {}, {}) is None


ENTITY = "http://www.wikidata.org/entity/{}".format


def stub_wikidata(*, admins=(), venues=(), labels=(), places=None, classes=None):
    """Answer resolve_cities' queries from small tables, filtered by the IDs each query names."""

    def named(query, qid):
        return f"wd:{qid} " in f"{query} "

    def fetch(query, **kwargs):
        if "?m wdt:P131 ?admin" in query:
            return [
                {"m": {"value": ENTITY(m)}, "admin": {"value": a if "/" in a else ENTITY(a)}}
                for m, a in admins
                if named(query, m)
            ]
        if "?m wdt:P625 ?coord" in query:
            return [
                {"m": {"value": ENTITY(m)}, "coord": {"value": f"Point({lng} {lat})"}}
                | ({"address": {"value": address, "xml:lang": "de"}} if address else {})
                | ({"location": {"value": ENTITY(location)}} if location else {})
                for m, lat, lng, address, location in venues
                if named(query, m)
            ]
        if "?place rdfs:label ?label" in query:
            return [
                {
                    "label": {"value": name, "xml:lang": lang},
                    "place": {"value": ENTITY(place)},
                    "coord": {"value": f"Point({lng} {lat})"},
                }
                for name, lang, place, lat, lng in labels
                if f'"{name}"@{lang}' in query
            ]
        if "wdt:P279* ?class" in query:
            return [
                {"type": {"value": ENTITY(t)}, "class": {"value": ENTITY(c)}}
                for t, c in (classes or {}).items()
                if named(query, t)
            ]
        return [
            {"a": {"value": ENTITY(qid)}}
            | {key: {"value": ENTITY(node[key])} for key in ("type", "parent") if key in node}
            | {lang: {"value": node[lang]} for lang in ("en", "mul") if lang in node}
            for qid, node in (places or {}).items()
            if named(query, qid)
        ]

    return fetch


def test_resolve_cities_prefers_english_labels_and_names_municipalities_plainly():
    fetch = stub_wikidata(
        admins=[
            ("Q1", "Q10"),
            ("Q2", "Q20"),
            ("Q3", "http://www.wikidata.org/.well-known/genid/unknown"),
        ],
        places={
            "Q10": {"type": "Q408804", "parent": "Q60", "en": "Manhattan"},
            "Q60": {"type": "Q1549591", "en": "New York City"},
            "Q20": {"type": "Q755707", "mul": "Bergen Municipality"},
        },
        classes={"Q408804": "Q515", "Q1549591": "Q1549591", "Q755707": "Q15284"},
    )
    cities = wikidata.resolve_cities(["Q1", "Q2", "Q3"], user_agent="test", fetch=fetch)
    assert cities == {
        "Q1": wikidata.City("Q60", "New York City"),
        "Q2": wikidata.City("Q20", "Bergen"),
    }


def test_venues_without_admin_areas_use_their_location_or_a_nearby_town_in_their_address():
    fetch = stub_wikidata(
        venues=[
            ("Q1", 47.98, 8.80, "Donaustraße 50, 78532 Tuttlingen", None),
            ("Q2", 40.78, -73.96, None, "Q30"),
            ("Q3", 52.52, 13.40, "Unter den Linden 1", None),
            ("Q4", 51.54, -0.10, "39A Canonbury Square, London N1 2AN", None),
        ],
        labels=[
            ("Tuttlingen", "de", "Q100", 47.98, 8.82),
            ("Tuttlingen", "de", "Q200", 40.0, -100.0),
            ("Unter", "de", "Q300", 52.52, 13.40),
            ("Canonbury", "en", "Q400", 51.54, -0.10),
            ("London", "en", "Q84", 51.51, -0.13),
        ],
        places={
            "Q100": {"type": "Q3957", "en": "Tuttlingen"},
            "Q200": {"type": "Q3957", "en": "Far Tuttlingen"},
            "Q30": {"type": "Q33506", "parent": "Q60"},
            "Q60": {"type": "Q515", "en": "New York City"},
            "Q300": {"type": "Q4022", "en": "Unter"},
            "Q400": {"type": "Q3957", "en": "Canonbury"},
            "Q84": {"type": "Q515", "en": "London"},
        },
        classes={"Q3957": "Q486972", "Q515": "Q515"},
    )
    cities = wikidata.resolve_cities(["Q1", "Q2", "Q3", "Q4"], user_agent="test", fetch=fetch)
    assert cities == {
        "Q1": wikidata.City("Q100", "Tuttlingen"),
        "Q2": wikidata.City("Q60", "New York City"),
        "Q4": wikidata.City("Q84", "London"),
    }


def test_address_names_skip_numbers_postcodes_and_lowercase_street_words():
    assert "Suisun City" in wikidata.address_names("5848 State Highway 12 Suisun City, CA 94585")
    freiburg = wikidata.address_names("Hauptstr. 5, 79100 Freiburg im Breisgau")
    assert "Freiburg im Breisgau" in freiburg
    montreal = wikidata.address_names("5826, rue St-Hubert, Montréal (Québec), Canada, H2S 2L7")
    assert {"Montréal", "Québec", "Canada"} <= montreal
    assert not {name for name in montreal if name[0].islower() or any(c.isdigit() for c in name)}

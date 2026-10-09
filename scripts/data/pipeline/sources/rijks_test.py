import xml.etree.ElementTree as ET

import httpx
import pytest

from ..polite_http import PoliteClient
from . import rijks
from .rijks import parse_records, room_name

AAT = "http://vocab.getty.edu/aat/"


def record(id, number, *, on_view=False, credit=None, deleted=False):
    if deleted:
        return f'<record><header status="deleted"><identifier>https://id.rijksmuseum.nl/{id}</identifier></header></record>'
    return f"""<record><header><identifier>https://id.rijksmuseum.nl/{id}</identifier></header>
<metadata><rdf:RDF>
<edm:ProvidedCHO rdf:about="https://id.rijksmuseum.nl/{id}">
<dc:identifier>{number}</dc:identifier>
<dc:title xml:lang="nl">Het melkmeisje</dc:title><dc:title xml:lang="en">The Milkmaid</dc:title>
<dcterms:created xml:lang="en">c. 1660</dcterms:created>
<dc:creator rdf:resource="https://id.rijksmuseum.nl/2103"/>
{'<edm:currentLocation rdf:resource="https://id.rijksmuseum.nl/2301886"/>' if on_view else ""}
{f'<mrel:spn xml:lang="en">{credit}</mrel:spn>' if credit else ""}
</edm:ProvidedCHO>
<edm:Agent rdf:about="https://id.rijksmuseum.nl/2103"><skos:prefLabel xml:lang="en">Johannes Vermeer</skos:prefLabel></edm:Agent>
</rdf:RDF></metadata></record>"""


def page(*records):
    return ET.fromstring(
        '<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:edm="http://www.europeana.eu/schemas/edm/" '
        'xmlns:mrel="http://id.loc.gov/vocabulary/relators/" '
        'xmlns:skos="http://www.w3.org/2004/02/skos/core#">'
        f"<ListRecords>{''.join(records)}</ListRecords></OAI-PMH>"
    )


def test_paintings_are_on_view_when_they_have_a_current_location_and_loans_are_left_out():
    rows = parse_records(
        page(
            record(
                "1",
                "SK-A-2344",
                on_view=True,
                credit="Purchased with the support of the Rembrandt Association",
            ),
            record("2", "SK-A-1", credit=None),
            record(
                "3",
                "SK-C-1726",
                on_view=True,
                credit="On loan from the Triton Collection Foundation",
            ),
            record("4", "SK-A-9", deleted=True),
        )
    )
    assert rows == [
        {
            "id": "1",
            "accession": "SK-A-2344",
            "title": "The Milkmaid",
            "artist": "Johannes Vermeer",
            "url": "https://www.rijksmuseum.nl/en/collection/SK-A-2344",
            "onView": True,
        },
        {
            "id": "2",
            "accession": "SK-A-1",
            "title": "The Milkmaid",
            "artist": "Johannes Vermeer",
            "url": "https://www.rijksmuseum.nl/en/collection/SK-A-1",
            "onView": False,
        },
    ]


def location(*entries):
    return {"current_location": {"identified_by": list(entries)}}


def part(content, *, english=False):
    return {
        "content": content,
        "classified_as": [{"id": AAT + "300260522"}],
        "language": [{"id": AAT + ("300388277" if english else "300388256")}],
    }


def test_room_names_combine_the_english_name_with_the_gallery_number():
    names = {
        "type": "Name",
        "part": [part("Nachtwachtzaal"), part("Night Watch Gallery", english=True)],
    }
    number = {"type": "Identifier", "content": "HG-2.31", "part": [part("2.31")]}
    assert room_name(location(names, number)) == "Night Watch Gallery (2.31)"
    assert room_name(location(number)) == "Gallery 2.31"
    assert room_name({}) is None


def oai(*records, token="", size=3):
    root = page(*records)
    ET.SubElement(
        root.find("{http://www.openarchives.org/OAI/2.0/}ListRecords"),
        "{http://www.openarchives.org/OAI/2.0/}resumptionToken",
        completeListSize=str(size),
    ).text = token
    return ET.tostring(root)


def test_fetch_pages_the_feed_and_reads_rooms_for_works_on_view(tmp_path, monkeypatch):
    def client(size):
        def handler(request):
            if request.url.host == "id.rijksmuseum.nl":
                number = {"type": "Identifier", "part": [part("2.31")]}
                return httpx.Response(200, json=location(number))
            if "resumptionToken" in request.url.params:
                return httpx.Response(
                    200,
                    content=oai(
                        record("3", "SK-C-1726", credit="On loan from a private collector"),
                        size=size,
                    ),
                )
            return httpx.Response(
                200,
                content=oai(
                    record("1", "SK-A-2344", on_view=True),
                    record("2", "SK-A-1"),
                    token="next",
                    size=size,
                ),
            )

        return PoliteClient(
            user_agent="test",
            robots=False,
            transport=httpx.MockTransport(handler),
            per_host_rps=1000,
            sleep=lambda _: None,
        )

    monkeypatch.setattr(rijks, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    rows = rijks.fetch(client(3), tmp_path / "complete")
    assert [(row["accession"], row.get("gallery")) for row in rows] == [
        ("SK-A-2344", "Gallery 2.31"),
        ("SK-A-1", None),
    ]
    with pytest.raises(RuntimeError, match="listed 3 of 4"):
        rijks.fetch(client(4), tmp_path / "short")

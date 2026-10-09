"""Rijksmuseum, Amsterdam: its paintings from the museum's OAI-PMH feed, rooms from its Linked Art.

A painting on display carries `edm:currentLocation`; its Linked Art record names the room.
"""

import json
import logging
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode

from ..polite_http import PoliteClient
from .onview import FeedRow, write_snapshot

log = logging.getLogger(__name__)

OWNER_KEY = "wikidata:Q190804"
ROBOTS = False
OAI = "https://data.rijksmuseum.nl/oai"
PAINTINGS_SET = "261208"
LINKED_ART = "https://id.rijksmuseum.nl/"
ROOM_TYPE = "http://vocab.getty.edu/aat/300260522"
ENGLISH = "http://vocab.getty.edu/aat/300388277"
NS = {
    "oai": "http://www.openarchives.org/OAI/2.0/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "edm": "http://www.europeana.eu/schemas/edm/",
    "mrel": "http://id.loc.gov/vocabulary/relators/",
    "skos": "http://www.w3.org/2004/02/skos/core#",
}
RESOURCE = f"{{{NS['rdf']}}}resource"
ABOUT = f"{{{NS['rdf']}}}about"
LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def fetch(client: PoliteClient, out: Path) -> dict:
    """Pages and room records are cached under `out`, so a rerun resumes where it stopped."""
    pages = out / "oai"
    pages.mkdir(parents=True, exist_ok=True)
    rows: list[FeedRow] = []
    params = {"verb": "ListRecords", "metadataPrefix": "edm", "set": PAINTINGS_SET}
    number = listed = 0
    while True:
        path = pages / f"page-{number}.xml"
        if not path.exists():
            response = client.get(f"{OAI}?{urlencode(params)}")
            response.raise_for_status()
            path.write_bytes(response.content)
        root = ET.parse(path).getroot()
        if (error := root.find("oai:error", NS)) is not None:
            raise RuntimeError(f"Rijksmuseum OAI error {error.get('code')}: {error.text}")
        rows += parse_records(root)
        listed += len(root.findall("oai:ListRecords/oai:record", NS))
        token = root.find("oai:ListRecords/oai:resumptionToken", NS)
        if token is None or not token.text:
            total = int(token.get("completeListSize")) if token is not None else listed
            break
        params = {"verb": "ListRecords", "resumptionToken": token.text}
        number += 1
        log.info("Rijksmuseum OAI: %d paintings", len(rows))
    if listed != total:
        raise RuntimeError(f"Rijksmuseum OAI listed {listed} of {total} paintings")
    rooms = out / "rooms"
    rooms.mkdir(exist_ok=True)
    for index, row in enumerate(row for row in rows if row["onView"]):
        path = rooms / f"{row['id']}.json"
        if not path.exists():
            response = client.get(LINKED_ART + row["id"], headers={"Accept": "application/ld+json"})
            response.raise_for_status()
            path.write_bytes(response.content)
        row["gallery"] = room_name(json.loads(path.read_text()))
        if index % 100 == 99:
            log.info("Rijksmuseum rooms: %d", index + 1)
    return write_snapshot(out, rows, minimum_on_view=400)


def parse_records(root: ET.Element) -> list[FeedRow]:
    rows = []
    for record in root.iterfind("oai:ListRecords/oai:record", NS):
        header = record.find("oai:header", NS)
        rdf = record.find("oai:metadata/rdf:RDF", NS)
        if header.get("status") == "deleted" or rdf is None:
            continue
        work = rdf.find("edm:ProvidedCHO", NS)
        # Loans hang here but belong to their lenders.
        if any(
            (credit.text or "").startswith("On loan from")
            for credit in work.iterfind("mrel:spn", NS)
        ):
            continue
        agents = {
            agent.get(ABOUT): english(agent.iterfind("skos:prefLabel", NS))
            for agent in rdf.iterfind("edm:Agent", NS)
        }
        creator = work.find("dc:creator", NS)
        identifier = header.findtext("oai:identifier", namespaces=NS)
        rows.append(
            {
                "id": identifier.removeprefix(LINKED_ART),
                "accession": work.findtext("dc:identifier", namespaces=NS),
                "title": english(work.iterfind("dc:title", NS)),
                "artist": agents.get(creator.get(RESOURCE)) if creator is not None else None,
                "url": f"https://www.rijksmuseum.nl/en/collection/{work.findtext('dc:identifier', namespaces=NS)}",
                "onView": work.find("edm:currentLocation", NS) is not None,
            }
        )
    return rows


def english(elements) -> str | None:
    values = [(element.get(LANG), element.text) for element in elements if element.text]
    return next((text for lang, text in values if lang == "en"), values[0][1] if values else None)


def room_name(record: dict) -> str | None:
    """ "Night Watch Gallery (2.31)" from the room parts of the current location's name and identifier."""
    names, number = [], None
    for entry in (record.get("current_location") or {}).get("identified_by", []):
        for part in entry.get("part", []):
            if not any(kind.get("id") == ROOM_TYPE for kind in part.get("classified_as", [])):
                continue
            if entry["type"] == "Identifier":
                number = part.get("content")
            elif any(language.get("id") == ENGLISH for language in part.get("language", [])):
                names.append(part.get("content"))
    name = next(iter(names), None)
    if name and number:
        return f"{name} ({number})"
    return name or (f"Gallery {number}" if number else None)

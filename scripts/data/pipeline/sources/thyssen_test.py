import json

import pytest

from .thyssen import parse_page


def page(
    location,
    inventory='<div class="field--string">292</div> (<div class="field--string">1985.18</div>)',
):
    taxonomy = {"localizacion": [{"name": location}]} if location else {}
    data = {"content_id": "17250", "content_title": "Robles", "content_taxonomy": taxonomy}
    return f"""<script>dataLayer.push({json.dumps(data)});</script>
<a id="rs_artwork_artist" href="#"> Christian E. B. Morgenstern </a>
<h1><span class="field--string">Robles junto al agua</span></h1>
<div><div>Óleo sobre lienzo.</div><div>
  Nº INV. {inventory}
</div></div>"""


def test_a_collection_page_gives_its_room_and_inventory_number():
    assert parse_page(
        "https://www.museothyssen.org/coleccion/artistas/m/robles", page("Sala 29")
    ) == {
        "id": "17250",
        "accession": "292 (1985.18)",
        "title": "Robles junto al agua",
        "artist": "Christian E. B. Morgenstern",
        "url": "https://www.museothyssen.org/coleccion/artistas/m/robles",
        "onView": True,
        "gallery": "Sala 29",
    }
    stored = parse_page("u", page("No expuesta", '(<div class="field--string">CTB.1994.8</div>)'))
    assert (stored["accession"], stored["onView"]) == ("(CTB.1994.8)", False)
    # Decorative objects outside the galleries have no location at all.
    assert parse_page("u", page(None)) is None
    with pytest.raises(RuntimeError, match="dataLayer"):
        parse_page("u", "<html></html>")

import httpx

from ..polite_http import PoliteClient
from . import wallace

LOCATIONS = {"1": "Boudoir", "2": "Boudoir Cabinet", "3": "Not on display"}
# The location filter matches prefixes, so "Boudoir" also finds the Boudoir Cabinet's miniature.
RESULTS = {
    "1": [("65001", "P1"), ("65003", "M3")],
    "2": [("65003", "M3")],
    "3": [("65545", "P545")],
}


def item(object_id, number):
    return f"""<dl class="simpleListItem" id="simpleListItem-0"><dd><ul>
<li class="ListArtist"><span class="tspReferenceLink">Jean-Honoré Fragonard</span></li>
<li class="ListTitlepic"><a href="#">The Swing</a></li>
<li class="ListDate"><span class="tspValue">about 1767 - 1768</span></li>
<li class="ListMuseumno"><span class="tspValue">{number}</span></li>
<li class="hidden"><a class="Bookmark" href="{wallace.APP}?objectId={object_id}&amp;viewType=detailView">Bookmarkable URL</a></li>
</ul></dd></dl>"""


def handler(request):
    if request.url.path == "/robots.txt":
        return httpx.Response(404)
    if request.method == "POST":
        form = dict(httpx.QueryParams(request.content.decode()))
        assert form["$PropertySelection"] == wallace.PICTURES_AND_MINIATURES
        return httpx.Response(
            302, headers={"Location": f"{wallace.APP}?results={form['$PropertySelection$4']}"}
        )
    params = request.url.params
    if "moduleFunction" in params:
        options = "".join(f'<option value="{v}">{name}</option>' for v, name in LOCATIONS.items())
        return httpx.Response(
            200, text=f'<select id="field_10365"><option value="0"></option>{options}</select>'
        )
    results = RESULTS[params.get("results") or params["location"]]
    if "results" in params:
        # The first answer is an image list; the summary list carries the inventory numbers.
        return httpx.Response(
            200,
            text=f'Results:&nbsp; {len(results)} <a href="/eMP/eMuseumPlus?location={params["results"]}&amp;page=0">Summary List</a>',
        )
    page = int(params["page"])
    navigator = "".join(
        f'<a href="/eMP/eMuseumPlus?location={params["location"]}&amp;page={n}">{n + 1} - {n + 1}</a>'
        for n in range(len(results))
    )
    return httpx.Response(
        200, text=f"Results:&nbsp; {len(results)} {item(*results[page])} {navigator}"
    )


def test_each_work_takes_the_longest_room_name_that_listed_it(tmp_path, monkeypatch):
    monkeypatch.setattr(wallace, "write_snapshot", lambda out, rows, minimum_on_view: rows)
    client = PoliteClient(
        user_agent="test",
        transport=httpx.MockTransport(handler),
        per_host_rps=1000,
        sleep=lambda _: None,
    )
    rows = {row["accession"]: row for row in wallace.fetch(client, tmp_path)}
    assert rows["P1"] == {
        "id": "65001",
        "accession": "P1",
        "title": "The Swing",
        "artist": "Jean-Honoré Fragonard",
        "url": f"{wallace.APP}?service=ExternalInterface&module=collection&objectId=65001&viewType=detailView",
        "onView": True,
        "gallery": "Boudoir",
    }
    assert (rows["M3"]["gallery"], rows["M3"]["onView"]) == ("Boudoir Cabinet", True)
    assert (rows["P545"]["gallery"], rows["P545"]["onView"]) == ("Not on display", False)

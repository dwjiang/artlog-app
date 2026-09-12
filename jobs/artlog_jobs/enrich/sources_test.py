import httpx
import pytest

from artlog_jobs.enrich.sources import SourceGatherer, source_score, wikipedia_lead
from artlog_jobs.polite_http import PoliteClient


@pytest.mark.parametrize(
    ("url", "score"),
    [
        ("https://www.metmuseum.org/art/1", 1),
        ("https://en.wikipedia.org/wiki/Art", 0.7),
        ("https://metmuseum.org.evil.test/", None),
        ("https://unknown.test/", None),
        ("https://www.pinterest.com/pin/1", None),
        ("https://shop.metmuseum.org/1", None),
        ("https://www.tate.org.uk/products/1", None),
        ("file:///etc/passwd", None),
    ],
)
def test_domain_admission(url, score):
    assert source_score(url) == score


def test_owner_text_search_filter_and_character_limits():
    def respond(request):
        return httpx.Response(
            200,
            text="<nav>Buy tickets</nav><main>"
            + "Art history. " * 1000
            + "</main><script>TRACKING</script>",
        )

    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        gatherer = SourceGatherer(
            http,
            lambda query: [
                {
                    "url": "https://en.wikipedia.org/wiki/Test",
                    "title": "Test",
                    "content": "x" * 7000,
                },
                {"url": "https://pinterest.com/a", "content": "Bad"},
                {"url": "https://www.metmuseum.org/art/1", "content": "duplicate"},
            ],
        )
        sources = gatherer.gather(
            {"title": "Test", "artist": "Artist"},
            {
                "pageUrl": "http://www.metmuseum.org/art/1",
                "owner": {"name": "The Met", "website": "https://www.metmuseum.org"},
            },
        )
    assert len(sources) == 1
    assert sources[0]["label"] == "The Met"
    assert sources[0]["url"] == "https://www.metmuseum.org/art/1"
    assert all(len(s["text"]) <= 6000 for s in sources)
    assert "Buy tickets" not in sources[0]["text"]
    assert "TRACKING" not in sources[0]["text"]


def test_owner_page_is_canonical_regardless_of_domain_score():
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, text="<main>Wall label</main>")
        ),
    ) as http:
        sources = SourceGatherer(http, lambda _: []).gather(
            {"title": "Test", "artist": "Artist"},
            {
                "pageUrl": "https://www.sfmoma.org/artwork/1",
                "owner": {"name": "SFMOMA", "website": "https://www.sfmoma.org"},
            },
        )
    assert source_score("https://www.sfmoma.org/artwork/1") is None
    assert [(s["label"], s["score"], s["text"]) for s in sources] == [("SFMOMA", 1.0, "Wall label")]


def test_owner_redirect_is_rejected_before_fetching_another_host():
    requests = []

    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://other.test/art"})

    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        gatherer = SourceGatherer(http, lambda _: [])
        assert (
            gatherer.gather(
                {"title": "Test", "artist": "Artist"},
                {
                    "pageUrl": "https://metmuseum.org/art/1",
                    "owner": {"website": "https://metmuseum.org", "name": "Met"},
                },
            )
            == []
        )
    assert requests == ["https://metmuseum.org/art/1"]


def test_wikidata_claims_labels_units_precision_and_wikipedia():
    requests = []

    def claim(value, **extra):
        return {"mainsnak": {"snaktype": "value", "datavalue": {"value": value}}, **extra}

    entity = {
        "labels": {"en": {"value": "Harbor"}},
        "claims": {
            "P1476": [claim({"text": "Harbor"})],
            "P571": [claim({"time": "+1912-00-00T00:00:00Z", "precision": 9})],
            "P186": [claim({"id": "Q296955"})],
            "P2048": [claim({"amount": "+60", "unit": "http://www.wikidata.org/entity/Q174728"})],
            "P276": [claim({"id": "Q123"})],
            "P217": [claim("1987.1"), claim("wrong", rank="deprecated")],
        },
        "sitelinks": {"enwiki": {"title": "Harbor (painting)"}},
    }

    def respond(request):
        if request.url.path.endswith("/Q1.json"):
            return httpx.Response(200, json={"entities": {"Q1": entity}})
        if "Special:EntityData" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "entities": {
                        "Q296955": {"labels": {"en": {"value": "oil paint"}}},
                        "Q123": {"labels": {"en": {"value": "Gallery"}}},
                    }
                },
            )
        requests.append(str(request.url))
        return httpx.Response(
            200,
            text='<div class="mw-parser-output"><div class="hatnote">For the port, see Harbor.</div>'
            '<table class="infobox"><tr><td>Artist</td><td>Mira</td></tr></table>'
            '<p class="mw-empty-elt"></p><p>Harbor depicts fishing boats.'
            '<sup class="reference">[1]</sup></p><p>It hangs in a gallery.</p>'
            '<div class="mw-heading mw-heading2"><h2>History</h2></div>'
            "<p>Section text must not appear.</p></div>",
        )

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(http, lambda _: []).gather(
            {"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {}
        )
    assert len(sources) == 2
    text = sources[0]["text"]
    for expected in ("Harbor", "1912", "oil paint", "60 cm", "Gallery", "1987.1"):
        assert expected in text
    assert "wrong" not in text
    assert requests == ["https://en.wikipedia.org/wiki/Harbor_(painting)"]
    assert sources[1]["url"] == "https://en.wikipedia.org/wiki/Harbor_(painting)"
    assert sources[1]["text"] == "Harbor depicts fishing boats. It hangs in a gallery."


def test_wikipedia_lead_reads_parsoid_sections():
    html = (
        '<div class="mw-parser-output"><section><div class="shortdescription">Painting</div>'
        '<table class="infobox"><tr><td>Artist</td></tr></table>'
        '<p>Lead by <a href="/wiki/Mira">Mira</a>, painted (<a href="/wiki/1912">1912</a>).</p></section>'
        '<section><div class="mw-heading mw-heading2"><h2>History</h2></div><p>Later.</p></section>'
        "</div>"
    )
    assert wikipedia_lead(html) == "Lead by Mira, painted (1912)."
    assert wikipedia_lead("<html><body><p>No article body</p></body></html>") == ""


def test_unavailable_item_labels_preserve_the_entity_facts():
    entity = {
        "labels": {"en": {"value": "Harbor"}},
        "claims": {
            "P217": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": "1987.1"}}}],
            "P186": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": "Q2"}}}}],
        },
    }

    def respond(request):
        if request.url.path.endswith("/Q1.json"):
            return httpx.Response(200, json={"entities": {"Q1": entity}})
        return httpx.Response(403)

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(http, lambda _: []).gather(
            {"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {}
        )
    assert len(sources) == 1
    assert "1987.1" in sources[0]["text"]
    assert "Material" not in sources[0]["text"]


def test_copyright_claim_retains_its_jurisdiction():
    entity = {
        "claims": {
            "P6216": [
                {
                    "mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": "Q19652"}}},
                    "qualifiers": {
                        "P1001": [{"snaktype": "value", "datavalue": {"value": {"id": "Q30"}}}]
                    },
                }
            ]
        }
    }

    def respond(request):
        qid = request.url.path.rsplit("/", 1)[-1].removesuffix(".json")
        labels = {"Q19652": "public domain", "Q30": "United States"}
        return httpx.Response(
            200,
            json={
                "entities": {
                    qid: entity
                    if qid == "Q1"
                    else {
                        "labels": {"en": {"value": labels[qid]}},
                    }
                }
            },
        )

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(http, lambda _: []).gather(
            {"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {}
        )
    text = sources[0]["text"]
    assert "public domain" in text and '"jurisdiction": ["United States"]' in text


def test_search_cannot_introduce_a_different_work_with_the_same_title():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {
                    "url": "https://en.wikipedia.org/wiki/The_Bathers_(Cézanne)",
                    "content": "The Philadelphia painting measures 210.5 by 250.8 cm.",
                },
                {
                    "url": "https://www.metmuseum.org/art/collection/search/435867?lang=en",
                    "content": "The Met painting measures 38.1 by 46 cm.",
                },
            ],
        ).gather(
            {"title": "Bathers", "artist": "Paul Cézanne"},
            {"pageUrl": "http://www.metmuseum.org/art/collection/search/435867"},
        )
    assert len(sources) == 1
    assert "38.1 by 46" in sources[0]["text"]


def test_unanchored_search_still_applies_scores_and_text_limits():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {"url": "https://www.metmuseum.org/art/1", "content": "x" * 8000},
                {"url": "https://random.test/art", "content": "untrusted"},
            ],
        ).gather({"title": "Harbor", "artist": "Mira"}, {})
    assert len(sources) == 1 and len(sources[0]["text"]) == 6000

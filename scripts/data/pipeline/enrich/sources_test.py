import httpx
import pytest

from pipeline.enrich.sources import (
    SourceGatherer,
    links_to_artwork,
    source_identity,
    source_score,
    trim_sources,
    wikipedia_lead,
)
from pipeline.polite_http import PoliteClient


@pytest.fixture(autouse=True)
def no_live_wikidata_queries(monkeypatch):
    monkeypatch.setattr("pipeline.enrich.sources.sparql", lambda *_args, **_kwargs: [])


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
                    "content": "x" * 25000,
                },
                {"url": "https://pinterest.com/a", "content": "Bad"},
                {"url": "https://www.metmuseum.org/art/1", "content": "duplicate"},
                {
                    "url": "https://www.metmuseum.org/art/1?lang=it",
                    "content": "same page, translated",
                },
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
    assert all(len(s["text"]) <= 24000 for s in sources)
    assert "Buy tickets" not in sources[0]["text"]
    assert "TRACKING" not in sources[0]["text"]


def test_repeated_passages_stay_in_the_best_source_and_the_budget_caps_the_request():
    quoted = (
        "Van Gogh painted this wheat field with cypresses in late June 1889 "
        "while at the asylum in Saint-Rémy."
    )
    remark = (
        "Critics admired it when it was first shown in Paris, "
        "and the museum bought it a century later."
    )
    owner = {
        "url": "https://museum.example/work",
        "label": "Museum",
        "score": 1.0,
        "text": f"Title\n{quoted}\nBought in 1993 with a gift.",
    }
    article = {
        "url": "https://en.wikipedia.org/wiki/Work",
        "label": "Wikipedia",
        "score": 0.7,
        "text": f"Title\n“{quoted}”\n{remark}",
    }
    mirror = {"url": "https://mirror.example/work", "label": "mirror", "score": 0.6, "text": quoted}
    assert trim_sources([owner, article, mirror]) == [
        owner,
        {**article, "text": f"Title\n{remark}"},
    ]
    trimmed = trim_sources(
        [
            {"url": u, "label": u, "score": s, "text": u * 30_000}
            for u, s in (("a", 1), ("b", 0.9), ("c", 0.8))
        ]
    )
    assert [(s["url"], len(s["text"])) for s in trimmed] == [("a", 30_000), ("b", 10_000)]


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


@pytest.mark.parametrize(
    ("prop", "object_id", "page", "other"),
    [
        (
            "P3634",
            "437881",
            "https://www.metmuseum.org/art/collection/search/437881?lang=en",
            "https://www.metmuseum.org/art/collection/search/437880",
        ),
        (
            "P4610",
            "28560",
            "https://www.artic.edu/artworks/28560/the-bedroom",
            "https://www.artic.edu/artworks/28561/the-bedroom",
        ),
    ],
)
def test_collection_ids_on_wikidata_identify_the_museum_page(prop, object_id, page, other):
    entity = {
        "claims": {prop: [{"mainsnak": {"snaktype": "value", "datavalue": {"value": object_id}}}]}
    }

    def respond(request):
        return httpx.Response(200, json={"entities": {"Q1": entity}})

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {"url": page, "content": "This painting."},
                {"url": other, "content": "Another painting with the same title."},
            ],
        ).gather(
            {"title": "The Bedroom", "artist": "Vincent van Gogh", "wikidataId": "Q1"},
            {"pageUrl": "https://www.wikidata.org/wiki/Q1"},
        )
    assert [source["url"] for source in sources] == [page]


def test_chicago_work_finds_its_wikidata_item_and_reads_the_api_text():
    queries = []

    def query(text):
        queries.append(text)
        return [{"item": {"value": "http://www.wikidata.org/entity/Q18713076"}}]

    def respond(request):
        if request.url.host == "api.artic.edu":
            assert request.headers["AIC-User-Agent"] == "test"
            description = "<p>The most famous <em>bedroom</em>, in Arles.</p><p>He made three.</p>"
            return httpx.Response(200, json={"data": {"description": description}})
        if request.url.host == "www.wikidata.org":
            entity = {"labels": {"en": {"value": "The Bedroom"}}}
            return httpx.Response(200, json={"entities": {"Q18713076": entity}})
        return httpx.Response(403)

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(http, lambda _: [], query).gather(
            {"title": "The Bedroom", "artist": "Vincent van Gogh"},
            {
                "pageUrl": "https://www.artic.edu/artworks/28560",
                "owner": {"name": "Art Institute of Chicago", "website": "https://www.artic.edu"},
            },
        )
    assert [(source["url"], source["text"]) for source in sources] == [
        (
            "https://www.artic.edu/artworks/28560",
            "The most famous bedroom, in Arles.\nHe made three.",
        ),
        ("https://www.wikidata.org/wiki/Q18713076", "Label: The Bedroom"),
    ]
    assert 'wdt:P4610 "28560"' in queries[0]


def test_search_copy_of_the_wikidata_page_does_not_replace_its_summary():
    entity = {"labels": {"en": {"value": "Harbor"}}}

    def respond(request):
        return httpx.Response(200, json={"entities": {"Q1": entity}})

    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(respond),
        sleep=lambda _: None,
    ) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {"url": "https://www.wikidata.org/wiki/Q1", "content": "| depicts | boat |\n" * 50}
            ],
        ).gather({"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {})
    assert [source["text"] for source in sources] == ["Label: Harbor"]


def test_unanchored_search_still_applies_scores_and_text_limits():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {"url": "https://www.metmuseum.org/art/1", "content": "x" * 25000},
                {"url": "https://random.test/art", "content": "untrusted"},
            ],
        ).gather({"title": "Harbor", "artist": "Mira"}, {})
    assert len(sources) == 1 and len(sources[0]["text"]) == 24000


def test_search_full_content_replaces_a_short_owner_page():
    def respond(request):
        return httpx.Response(200, text="<main>A short wall label.</main>")

    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {
                    "url": "https://www.metmuseum.org/art/1",
                    "content": "Snippet",
                    "raw_content": "Full research describing brushwork and the circumstances of the painting.",
                }
            ],
        ).gather(
            {"title": "Harbor", "artist": "Mira"},
            {
                "pageUrl": "https://www.metmuseum.org/art/1",
                "owner": {"name": "Met", "website": "https://www.metmuseum.org"},
            },
        )
    assert len(sources) == 1
    assert "Full research" in sources[0]["text"]
    assert (sources[0]["label"], sources[0]["score"]) == ("Met", 1.0)


def test_markdown_search_pages_reach_the_model_as_plain_prose():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _: [
                {
                    "url": "https://www.metmuseum.org/perspectives/van-gogh-cypresses",
                    "title": "Cypresses",
                    "raw_content": "## Letters\n\n![Detail](https://images.example/detail_(crop).jpg)\n\n"
                    "He described the cypresses in *Wheat Field with Cypresses* as a **splash of black**. "
                    "See [the painting](/art/collection/search/436535).",
                }
            ],
        ).gather(
            {"title": "Wheat Field with Cypresses", "artist": "Vincent van Gogh"},
            {"pageUrl": "https://www.metmuseum.org/art/collection/search/436535"},
        )
    assert [source["text"] for source in sources] == [
        (
            "Cypresses\nLetters\n\nHe described the cypresses in Wheat Field with Cypresses "
            "as a splash of black. See the painting."
        )
    ]


def test_curatorial_links_identify_the_exact_work_across_museum_url_formats():
    anchors = {source_identity("https://www.metmuseum.org/art/collection/search/436534")}
    assert links_to_artwork(
        "[Roses](/exhibitions/view?oid=436534)",
        "https://www.metmuseum.org/exhibitions/listings/2015/van-gogh",
        anchors,
    )
    assert not links_to_artwork(
        "[Other](/exhibitions/view?oid=436535)",
        "https://www.metmuseum.org/exhibitions/listings/2015/van-gogh",
        anchors,
    )
    assert not links_to_artwork(
        "[Roses](/art/collection/search/436534)",
        "https://www.metmuseum.org/art/collection/search/436535",
        anchors,
    )

from unittest.mock import Mock

import httpx
import pytest

from pipeline.enrich.providers import SpendCap
from pipeline.enrich.references import review_references
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


def test_verified_owner_domains_expand_search_without_admitting_shops_or_other_hosts():
    page = "https://collection.museum.example/work/1"
    search = Mock(return_value=[{"url": page, "content": "Curatorial research. " * 100}])
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(lambda _: httpx.Response(403)),
    ) as http:
        sources = SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Jane Painter"},
            {"pageUrl": page, "owner": {"name": "Museum", "website": "https://museum.example"}},
        )
    assert [s["url"] for s in sources] == [page]
    assert sources[0]["score"] == 1
    search.assert_called_once()
    assert {"museum.example", "sfmoma.org", "famsf.org", "asianart.org", "bampfa.org"} <= set(
        search.call_args.args[1]
    )
    assert source_score("https://shop.museum.example/work/1", ["museum.example"]) is None
    assert source_score("https://museum.example.evil.test/work/1", ["museum.example"]) is None


def test_accession_fallback_accepts_only_the_owners_matching_essay():
    accepted = "https://www.sfmoma.org/read/harbor"
    search = Mock(
        side_effect=[
            [],
            [
                {
                    "url": accepted,
                    "content": "Harbor by Jane Painter. Accession 1987.1. Painted outdoors.",
                },
                {
                    "url": "https://www.sfmoma.org/read/other-number",
                    "content": "Harbor by Jane Painter. Accession 1987.10.",
                },
                {
                    "url": "https://www.sfmoma.org/read/other-part",
                    "content": "Harbor by Jane Painter. Accession 1987.1.2.",
                },
                {
                    "url": "https://www.sfmoma.org/read/other-artist",
                    "content": "Harbor by John Painter. Accession 1987.1.",
                },
                {
                    "url": "https://www.metmuseum.org/essays/harbor",
                    "content": "Harbor by Jane Painter. Accession 1987.1.",
                },
                {
                    "url": "https://www.sfmoma.org/artwork/other",
                    "content": "Related work: Harbor by Jane Painter. Accession 1987.1.",
                },
            ],
        ]
    )
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(lambda _: httpx.Response(403)),
    ) as http:
        sources = SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Jane Painter"},
            {
                "pageUrl": "https://www.sfmoma.org/artwork/1987.1",
                "accession": "1987.1",
                "owner": {"name": "SFMOMA", "website": "https://www.sfmoma.org"},
            },
        )
    assert [s["url"] for s in sources] == [accepted]
    assert search.call_count == 2
    assert '"1987.1"' in search.call_args.args[0]


def test_linked_non_english_article_and_alternate_title_expand_thin_research():
    entity = {
        "labels": {"en": {"value": "Harbor"}, "fr": {"value": "Le Port"}},
        "sitelinks": {"frwiki": {"title": "Le Port (tableau)"}},
    }
    requests = []

    def respond(request):
        requests.append(str(request.url))
        if request.url.host == "www.wikidata.org":
            return httpx.Response(200, json={"entities": {"Q1": entity}})
        return httpx.Response(
            200, text='<div class="mw-parser-output"><p>Le tableau représente un port.</p></div>'
        )

    search = Mock(return_value=[])
    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        sources = SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Jane Painter", "wikidataId": "Q1"}, {}
        )
    assert "https://fr.wikipedia.org/wiki/Le_Port_(tableau)" in requests
    assert any(s["text"] == "Le tableau représente un port." for s in sources)
    assert search.call_count == 2
    assert '"Le Port"' in search.call_args.args[0]


@pytest.mark.parametrize("language", ["en", "fr"])
def test_full_search_article_expands_the_linked_wikipedia_lead(language):
    title, lead, history = (
        (
            "Harbor",
            "Harbor is an oil painting by Jane Painter.",
            "The artist painted outdoors, building up blue and violet shadows in thin layers. ",
        )
        if language == "en"
        else (
            "Le Port",
            "Le Port est une peinture de Jane Painter.",
            "L'artiste peignait en plein air, superposant des ombres bleues et violettes. ",
        )
    )
    history = history * 20
    url = f"https://{language}.wikipedia.org/wiki/{title.replace(' ', '_')}"
    entity = {"sitelinks": {f"{language}wiki": {"title": title}}}

    def respond(request):
        if request.url.host == "www.wikidata.org":
            return httpx.Response(200, json={"entities": {"Q1": entity}})
        return httpx.Response(200, text=f'<div class="mw-parser-output"><p>{lead}</p></div>')

    result = {"url": url, "title": title, "raw_content": f"{lead}\n\n{history}"}
    search = Mock(side_effect=[[result], []] if language == "en" else [[], [result]])
    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        sources = SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Jane Painter", "wikidataId": "Q1"}, {}
        )

    assert sources == [
        {
            "url": url,
            "label": "Wikipedia",
            "score": 0.7,
            "text": f"{title}\n{lead}\n\n{history}".strip(),
        }
    ]
    assert search.call_count == (1 if language == "en" else 2)


def test_optional_fallback_cap_keeps_the_first_pass_evidence():
    page = "https://www.sfmoma.org/artwork/1987.1"
    search = Mock(
        side_effect=[
            [{"url": page, "content": "Harbor was painted outdoors."}],
            SpendCap("Daily cap"),
        ]
    )
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(lambda _: httpx.Response(403)),
    ) as http:
        sources = SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Jane Painter"}, {"pageUrl": page}
        )
    assert [s["url"] for s in sources] == [page]
    assert search.call_count == 2


def test_failed_first_search_is_not_retried():
    search = Mock(side_effect=SpendCap("Daily cap"))
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(lambda _: httpx.Response(403)),
    ) as http:
        assert (
            SourceGatherer(http, search, extract=Mock(return_value=[])).gather(
                {"title": "Harbor", "artist": "Jane Painter"}, {}
            )
            == []
        )
    search.assert_called_once()


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
            lambda query, domains: [
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
            extract=Mock(return_value=[]),
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
        sources = SourceGatherer(http, lambda _, domains: [], extract=Mock(return_value=[])).gather(
            {"title": "Test", "artist": "Artist"},
            {
                "pageUrl": "https://www.sfmoma.org/artwork/1",
                "owner": {"name": "SFMOMA", "website": "https://www.sfmoma.org"},
            },
        )
    assert source_score("https://www.sfmoma.org/artwork/1") == 0.95
    assert [(s["label"], s["score"], s["text"]) for s in sources] == [("SFMOMA", 1.0, "Wall label")]


def test_owner_redirect_is_rejected_before_fetching_another_host():
    requests = []

    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://other.test/art"})

    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        gatherer = SourceGatherer(http, lambda _, domains: [], extract=Mock(return_value=[]))
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
        sources = SourceGatherer(http, lambda _, domains: [], extract=Mock(return_value=[])).gather(
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
        sources = SourceGatherer(http, lambda _, domains: [], extract=Mock(return_value=[])).gather(
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
        sources = SourceGatherer(http, lambda _, domains: [], extract=Mock(return_value=[])).gather(
            {"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {}
        )
    text = sources[0]["text"]
    assert "public domain" in text and '"jurisdiction": ["United States"]' in text


def test_search_cannot_introduce_a_different_work_with_the_same_title():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _, domains: [
                {
                    "url": "https://en.wikipedia.org/wiki/The_Bathers_(Cézanne)",
                    "content": "The Philadelphia painting measures 210.5 by 250.8 cm.",
                },
                {
                    "url": "https://www.metmuseum.org/art/collection/search/435867?lang=en",
                    "content": "The Met painting measures 38.1 by 46 cm.",
                },
            ],
            extract=Mock(return_value=[]),
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
            lambda _, domains: [
                {"url": page, "content": "This painting."},
                {"url": other, "content": "Another painting with the same title."},
            ],
            extract=Mock(return_value=[]),
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
        sources = SourceGatherer(
            http, lambda _, domains: [], query, extract=Mock(return_value=[])
        ).gather(
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
            lambda _, domains: [
                {"url": "https://www.wikidata.org/wiki/Q1", "content": "| depicts | boat |\n" * 50}
            ],
            extract=Mock(return_value=[]),
        ).gather({"title": "Harbor", "artist": "Mira", "wikidataId": "Q1"}, {})
    assert [source["text"] for source in sources] == ["Label: Harbor"]


def test_unanchored_search_still_applies_scores_and_text_limits():
    with PoliteClient(user_agent="test", robots=False) as http:
        sources = SourceGatherer(
            http,
            lambda _, domains: [
                {"url": "https://www.metmuseum.org/art/1", "content": "x" * 25000},
                {"url": "https://random.test/art", "content": "untrusted"},
            ],
            extract=Mock(return_value=[]),
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
            lambda _, domains: [
                {
                    "url": "https://www.metmuseum.org/art/1",
                    "content": "Snippet",
                    "raw_content": "Full research describing brushwork and the circumstances of the painting.",
                }
            ],
            extract=Mock(return_value=[]),
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
            lambda _, domains: [
                {
                    "url": "https://www.metmuseum.org/perspectives/van-gogh-cypresses",
                    "title": "Cypresses",
                    "raw_content": "## Letters\n\n![Detail](https://images.example/detail_(crop).jpg)\n\n"
                    "He described the cypresses in *Wheat Field with Cypresses* as a **splash of black**. "
                    "See [the painting](/art/collection/search/436535).",
                }
            ],
            extract=Mock(return_value=[]),
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


def test_trim_preserves_reference_marker_so_review_cannot_be_skipped():
    source = {
        "url": "https://auction.example/1",
        "label": "Auction",
        "score": 0.8,
        "text": "  The painting depicts Carnival and Lent.  ",
        "referenceUrl": "https://www.wikidata.org/wiki/Q1",
    }
    assert trim_sources([source]) == [{**source, "text": source["text"].strip()}]


def test_known_artwork_reference_reaches_review_without_expanding_search_domains():
    citation = "https://auction.example/lot/1"
    text = "Carnival and Lent. Follower of Pieter Brueghel II. Oil on circular panel, diameter 26.8 cm."
    entity = {
        "id": "Q1",
        "claims": {
            "P18": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": "Painting.jpg"}}}]
        },
    }
    html = f'<table><tr><td id="fileinfotpl_art_references">References</td><td><a href="{citation}">Lot</a></td></tr></table><a href="https://other.example/1">Biography</a>'

    def respond(request):
        if request.url.host == "www.wikidata.org":
            return httpx.Response(200, json={"entities": {"Q1": entity}})
        if request.url.host == "commons.wikimedia.org":
            return httpx.Response(200, text=html)
        raise AssertionError(request.url)

    extract = Mock(
        return_value=[
            {"url": citation, "raw_content": text},
            {"url": "https://unrequested.example/1", "raw_content": text},
        ]
    )
    search = Mock(return_value=[])
    with PoliteClient(
        user_agent="test", robots=False, transport=httpx.MockTransport(respond)
    ) as http:
        sources = SourceGatherer(http, search, extract=extract).gather(
            {"title": "Carnival and Lent", "artist": "Marten van Cleve", "wikidataId": "Q1"}, {}
        )
    extract.assert_called_once_with([citation])
    assert sources == [
        {
            "url": citation,
            "label": "auction.example",
            "score": 0.8,
            "text": text,
            "referenceUrl": "https://commons.wikimedia.org/wiki/File:Painting.jpg",
        }
    ]
    assert all("auction.example" not in c.args[1] for c in search.call_args_list)


@pytest.mark.parametrize("via", ["owner", "search"])
def test_existing_sources_keep_citation_for_review_without_another_extraction(via):
    page = "https://museum.example/work/1"
    text = "Harbor. Follower of Jane Painter. Oil on panel, 26 cm. Provenance includes the original gallery collection."
    entity = {
        "id": "Q1",
        "claims": {
            "P170": [
                {
                    "references": [
                        {"snaks": {"P854": [{"datavalue": {"value": page + "?utm_source=wiki"}}]}}
                    ]
                }
            ]
        },
    }
    search = Mock(return_value=[{"url": page, "content": text}] if via == "search" else [])
    extract = Mock(return_value=[])
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200 if via == "owner" else 403, text=f"<main>{text}</main>")
        ),
    ) as http:
        gatherer = SourceGatherer(http, search, extract=extract)
        gatherer._wikidata = Mock(return_value=("", entity))
        artwork = {"title": "Harbor", "artist": "Jane Painter", "wikidataId": "Q1"}
        sources = gatherer.gather(
            artwork,
            {"pageUrl": page, "owner": {"name": "Museum", "website": "https://museum.example"}},
        )
    assert len(sources) == 1
    assert sources[0]["referenceUrl"] == "https://www.wikidata.org/wiki/Q1"
    extract.assert_not_called()
    provider = Mock()
    provider.chat.return_value = {
        "reviews": [
            {
                "source": "s1",
                "relation": "same_artwork",
                "evidence": "Harbor.",
                "comparison": "The title and dimensions match.",
                "conflicts": [{"field": "artist", "text": "Follower of Jane Painter"}],
            }
        ]
    }
    _, conflicts = review_references(provider, sources, artwork)
    assert conflicts[0]["field"] == "artist"


def test_rejected_references_cannot_displace_catalogue_research():
    citations = [f"https://auction.example/lot/{i}" for i in range(5)]
    article = "The painting depicts the harbor where the artist spent the summer working outdoors."
    entity = {
        "id": "Q1",
        "sitelinks": {"enwiki": {"title": "Harbor"}},
        "claims": {
            "P170": [
                {
                    "references": [
                        {"snaks": {"P854": [{"datavalue": {"value": url}} for url in citations]}}
                    ]
                }
            ]
        },
    }
    extract = Mock(
        return_value=[
            {"url": url, "raw_content": str(i) * 24_000} for i, url in enumerate(citations)
        ]
    )
    with PoliteClient(
        user_agent="test",
        robots=False,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, text=f'<div class="mw-parser-output"><p>{article}</p></div>'
            )
        ),
    ) as http:
        gatherer = SourceGatherer(http, Mock(return_value=[]), extract=extract)
        gatherer._wikidata = Mock(return_value=("", entity))
        sources = gatherer.gather({"title": "Harbor", "artist": "Artist", "wikidataId": "Q1"}, {})
    assert len([s for s in sources if s.get("referenceUrl")]) == 5
    provider = Mock()
    provider.chat.return_value = {
        "reviews": [
            {
                "source": f"s{i + 1}",
                "relation": "other",
                "evidence": "",
                "comparison": "Different painting.",
                "conflicts": [],
            }
            for i, source in enumerate(sources)
            if source.get("referenceUrl")
        ]
    }
    accepted, conflicts = review_references(provider, sources, {})
    assert not conflicts
    assert [s["text"] for s in trim_sources(accepted)] == [article]

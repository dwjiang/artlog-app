import pytest

from pipeline.enrich.factsheet import build_fact_sheet, is_catalogue_line
from pipeline.enrich.prompts import fact_sheet_schema, facts_per_source

MUSEUM = {
    "url": "https://museum.example/work",
    "label": "Museum",
    "score": 1,
    "text": "Visible brushwork conveys wind.",
}


def test_grounding_sort_dedupe_ids_and_cap():
    sources = [
        {
            "url": "https://en.wikipedia.org/wiki/Art",
            "score": 0.7,
            "label": "Wikipedia",
            "text": " ".join(f"Fact {i}" for i in range(0, 20, 2)),
        },
        {
            "url": "https://metmuseum.org/art/1",
            "score": 1,
            "label": "Met",
            "text": " ".join(f"Fact {i}" for i in range(1, 20, 2)),
        },
    ]
    extracted = [
        [f"Fact {i}" for i in range(0, 20, 2)] + ["Unsupported claim"],
        [f"Fact {i}" for i in range(1, 20, 2)] + ["  Fact   1 ", " "],
    ]
    facts = build_fact_sheet(extracted, sources)
    assert len(facts) == 20
    assert [f["id"] for f in facts] == [f"f{i}" for i in range(1, 21)]
    assert [f["sourceScore"] for f in facts] == [1] * 10 + [0.7] * 10
    assert len({f["text"] for f in facts}) == 20
    assert all(f["sourceLabel"] == ("Met" if f["sourceScore"] == 1 else "Wikipedia") for f in facts)


def test_rejects_invented_details_and_facts_copied_from_another_source():
    museum = {
        "url": "https://metmuseum.org/art/1",
        "label": "Met",
        "score": 1,
        "text": "Visible brushwork conveys wind.",
    }
    wikidata = {
        "url": "https://www.wikidata.org/wiki/Q1",
        "label": "Wikidata",
        "score": 0.8,
        "text": "Inception: 1889",
    }
    extracted = [
        ["Visible brushwork conveys wind.", "The artist was feeling hopeful."],
        ["Visible brushwork conveys wind."],
    ]
    assert [fact["text"] for fact in build_fact_sheet(extracted, [museum, wikidata])] == [
        "Visible brushwork conveys wind."
    ]


def test_caps_each_sources_facts_allowing_more_when_few_prose_sources_share_the_sheet():
    def page(host):
        return {"url": f"https://{host}/work"}

    assert facts_per_source([page("museum.example"), page("www.wikidata.org")]) == 20
    assert facts_per_source([page("museum.example"), page("en.wikipedia.org")]) == 10
    assert facts_per_source([page(f"{host}.example") for host in "abcd"]) == 8
    assert fact_sheet_schema(8)["minItems"] == 1 and fact_sheet_schema(8)["maxItems"] == 8


def test_ranks_prose_ahead_of_catalogue_lines_and_captions():
    wikidata = {
        "url": "https://www.wikidata.org/wiki/Q1",
        "label": "Wikidata",
        "score": 0.8,
        "text": "Inception: 1889\nOil on canvas.",
    }
    article = {
        "url": "https://en.wikipedia.org/wiki/Work",
        "label": "Wikipedia",
        "score": 0.7,
        "text": "The cypresses were painted in thick strokes during his stay at the asylum.",
    }
    sheet = build_fact_sheet(
        [["Inception: 1889", "Oil on canvas."], [article["text"]]], [wikidata, article]
    )
    assert [fact["text"] for fact in sheet] == [
        article["text"],
        "Inception: 1889",
        "Oil on canvas.",
    ]


def test_allows_typographic_quote_changes_without_accepting_a_changed_claim():
    source = {**MUSEUM, "text": "He called it “a summer landscape.”"}
    assert len(build_fact_sheet([['He called it "a summer landscape."']], [source])) == 1
    assert build_fact_sheet([['He called it "a winter landscape."']], [source]) == []


def test_keeps_a_copy_that_differs_only_by_accents_or_a_fixed_typo_in_the_sources_words():
    source = {
        **MUSEUM,
        "text": "In this depiction of his sister, Julie Fréderique Lemmen, the artist captured her"
        " biting personality. The painter may have chosen these scenes fo their felicitous"
        " overtones.",
    }
    accent = (
        "In this depiction of his sister, Julie Frédérique Lemmen, the artist captured her biting"
        " personality."
    )
    typo = "The painter may have chosen these scenes for their felicitous overtones."
    assert [fact["text"] for fact in build_fact_sheet([[accent, typo]], [source])] == [
        accent,
        "The painter may have chosen these scenes fo their felicitous overtones.",
    ]
    # A changed number or a second change is a different claim, not a typo.
    for claim in (
        "The painter may have chosen 12 scenes for their felicitous overtones.",
        "The painter may have chosen those scenes for their joyful overtones.",
    ):
        assert build_fact_sheet([[claim]], [source]) == []


@pytest.mark.parametrize(
    ("text", "catalogue"),
    [
        ("Inception: 1889", True),
        ("  credit line : Gift of the artist", True),
        ("Oil on canvas.", True),
        ("Medium Oil on canvas on board", True),
        ("Artist James HUCK (Scottish, b.1875, d.1940)", True),
        ("Gift of J. Pierpont Morgan, 1907", True),
        ("Overall: 21 3/4 x 33 7/8 in. (55.2 x 86 cm)", True),
        ("Artist James Huck painted Saunders in his studio in 1924.", False),
        ("The cypresses were painted in thick strokes.", False),
        ("この作品は、画家が庭の池に映る光を長年観察して描いた連作の一つです。", False),
        ("这幅画描绘了花园池塘中的睡莲以及水面上不断变化的光线和倒影。", False),
        ("この絵は庭の池を描いています。", False),
        ("神奈川沖浪裏", True),
        ("油彩、画布。", True),
    ],
)
def test_catalogue_lines_are_label_rows_or_too_short_to_be_prose(text, catalogue):
    assert is_catalogue_line(text) is catalogue

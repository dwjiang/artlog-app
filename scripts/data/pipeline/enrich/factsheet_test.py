from pipeline.enrich.factsheet import build_fact_sheet
from pipeline.enrich.prompts import fact_sheet_schema, facts_per_source


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

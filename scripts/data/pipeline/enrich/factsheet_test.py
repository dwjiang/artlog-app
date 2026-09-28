from pipeline.enrich.factsheet import build_fact_sheet
from pipeline.enrich.prompts import fact_sheet_schema, source_id


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
    raw = [{"text": "Unsupported claim", "source": "s9"}]
    raw += [{"text": f"Fact {i}", "source": source_id(i % 2)} for i in range(20)]
    raw += [
        {"text": "  Fact   1 ", "source": " s2 "},
        {"text": " ", "source": "s2"},
    ]
    facts = build_fact_sheet(raw, sources)
    assert len(facts) == 20
    assert [f["id"] for f in facts] == [f"f{i}" for i in range(1, 21)]
    assert [f["sourceScore"] for f in facts] == [1] * 10 + [0.7] * 10
    assert len({f["text"] for f in facts}) == 20
    assert all(f["sourceUrl"] in {s["url"] for s in sources} for f in facts)
    assert all(f["sourceLabel"] == ("Met" if f["sourceScore"] == 1 else "Wikipedia") for f in facts)


def test_rejects_invented_details_even_when_they_cite_a_real_source():
    sources = [
        {
            "url": "https://metmuseum.org/art/1",
            "label": "Met",
            "score": 1,
            "text": "Visible brushwork conveys wind.",
        }
    ]
    raw = [
        {"source": "s1", "text": "Visible brushwork conveys wind."},
        {"source": "s1", "text": "The artist was feeling hopeful."},
    ]
    assert [fact["text"] for fact in build_fact_sheet(raw, sources)] == [
        "Visible brushwork conveys wind."
    ]


def test_schema_lets_a_fact_cite_only_the_sources_sent():
    assert fact_sheet_schema(2)["items"]["properties"]["source"] == {
        "type": "string",
        "enum": ["s1", "s2"],
    }

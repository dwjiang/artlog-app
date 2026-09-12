from artlog_jobs.enrich.factsheet import build_fact_sheet


def test_grounding_sort_dedupe_ids_and_cap():
    sources = [
        {
            "url": "https://en.wikipedia.org/wiki/Art",
            "score": 0.7,
            "label": "Wikipedia",
            "text": "A",
        },
        {"url": "https://metmuseum.org/art/1", "score": 1, "label": "Met", "text": "B"},
    ]
    raw = [{"text": "Unsupported claim", "sourceUrl": "https://invented.test"}]
    raw += [{"text": f"Fact {i}", "sourceUrl": sources[i % 2]["url"]} for i in range(20)]
    raw += [
        {"text": "  Fact   1 ", "sourceUrl": sources[1]["url"]},
        {"text": " ", "sourceUrl": sources[1]["url"]},
    ]
    facts = build_fact_sheet(raw, sources)
    assert len(facts) == 14
    assert [f["id"] for f in facts] == [f"f{i}" for i in range(1, 15)]
    assert [f["sourceScore"] for f in facts] == [1] * 10 + [0.7] * 4
    assert len({f["text"] for f in facts}) == 14
    assert all(f["sourceUrl"] in {s["url"] for s in sources} for f in facts)
    assert all(f["sourceLabel"] == ("Met" if f["sourceScore"] == 1 else "Wikipedia") for f in facts)

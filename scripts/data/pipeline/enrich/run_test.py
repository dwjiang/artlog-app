from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from pipeline.enrich.providers import SpendCap, Usage
from pipeline.enrich.run import EnrichmentSettings, run

FACT = {"id": "f1", "text": "The artist painted the harbor outdoors at dawn."}


@pytest.fixture
def rig(monkeypatch):
    artworks = [
        {
            "key": f"art:{i}",
            "_id": f"id{i}",
            "title": f"Painting {i}",
            "artist": "Artist",
            "enrichGeneration": 7,
        }
        for i in range(30)
    ]
    pages = iter(
        [
            {"artworks": [], "after": {"phase": "artworks", "cursor": None}},
            {"artworks": artworks[:3], "after": None},
        ]
    )
    writer = Mock()
    contents = {}

    def query(name, args):
        if name == "docent:load":
            return {
                "artwork": next(a for a in artworks if a["_id"] == args["artworkId"]),
                "content": contents.get(args["artworkId"]),
            }
        if name == "enrich:lookup":
            return artworks[0]
        if name == "enrich:previewBatch":
            return next(pages)
        raise AssertionError(name)

    def mutation(name, args):
        if name == "enrich:claimBatch":
            return next(pages)
        if name == "docent:claim":
            return 7
        if name == "docent:writeEnrichment":
            return True
        if name == "enrich:releaseClaim":
            return None
        raise AssertionError(name)

    writer.query.side_effect = query
    writer.mutation.side_effect = mutation
    provider = Mock(usage=Usage())
    gatherer = Mock()
    gatherer.gather.return_value = [{"url": "https://metmuseum.org/art/1", "text": "Source"}]
    monkeypatch.setattr("pipeline.enrich.run.factsheet.generate", Mock(return_value=[FACT]))
    monkeypatch.setattr(
        "pipeline.enrich.run.docent.generate",
        Mock(
            return_value=(
                [
                    {"sentence": "The painting depicts a harbor.", "factIds": ["f1"]},
                ],
                1,
            )
        ),
    )
    return SimpleNamespace(
        writer=writer,
        gatherer=gatherer,
        provider=provider,
        artworks=artworks,
        contents=contents,
        outputs=[],
        calls=lambda name: [c.args[1] for c in writer.mutation.call_args_list if c.args[0] == name],
    )


def execute(rig, **kwargs):
    return run(
        rig.writer,
        rig.gatherer,
        rig.provider,
        emit=rig.outputs.append,
        budget=kwargs.pop("budget", 3),
        **kwargs,
    )


def test_empty_pages_advance_and_budget_releases_unused_claims(rig):
    summary = execute(rig, budget=2)
    assert summary.written == 2
    assert rig.calls("enrich:claimBatch")[1]["after"] == {"phase": "artworks", "cursor": None}
    assert rig.calls("enrich:releaseClaim") == [{"artworkId": "id2", "generation": 7}]
    assert all(c["generation"] == 7 for c in rig.calls("docent:writeEnrichment"))


def test_empty_cached_research_is_rebuilt(rig):
    rig.artworks[0]["factSheetUpdatedAt"] = 1
    rig.contents["id0"] = {"factSheet": [], "docent": {"en": []}}
    summary = execute(rig, budget=1)
    assert summary.written == 1
    rig.gatherer.gather.assert_called_once()
    assert rig.calls("docent:writeEnrichment")[0]["factSheet"]


def test_preview_does_not_claim_release_or_write_artwork(rig):
    summary = execute(rig, dry_run=True)
    assert summary.previewed == 3
    rig.writer.mutation.assert_not_called()
    assert all(row["dryRun"] and row["factSheet"] for row in rig.outputs)


def test_failure_releases_generation_and_continues(rig):
    rig.gatherer.gather.side_effect = [
        ValueError("source failed"),
        [{"url": "a", "text": "Source A"}],
        [{"url": "b", "text": "Source B"}],
    ]
    summary = execute(rig)
    assert (summary.failed, summary.written) == (1, 2)
    assert rig.calls("enrich:releaseClaim") == [{"artworkId": "id0", "generation": 7}]


def test_cap_mid_batch_stops_spend_and_releases_all_remaining(rig):
    rig.provider.check_budget.side_effect = [None, None, None, SpendCap("cap")]
    summary = execute(rig)
    assert (summary.written, summary.stopped) == (1, "cap")
    assert rig.calls("enrich:releaseClaim") == [
        {"artworkId": "id1", "generation": 7},
        {"artworkId": "id2", "generation": 7},
    ]


def test_rejected_write_is_never_retried(rig):
    original = rig.writer.mutation.side_effect
    rig.writer.mutation.side_effect = lambda name, args: (
        False if name == "docent:writeEnrichment" else original(name, args)
    )
    summary = execute(rig, artwork_key="met:1")
    assert summary.superseded == 1
    assert len(rig.calls("docent:writeEnrichment")) == 1
    assert rig.calls("enrich:releaseClaim") == [{"artworkId": "id0", "generation": 7}]


def test_superseded_context_skips_paid_work(rig):
    original = rig.writer.query.side_effect
    rig.writer.query.side_effect = lambda name, args: (
        {"artwork": {"enrichGeneration": 8}} if name == "docent:load" else original(name, args)
    )
    summary = execute(rig)
    assert summary.superseded == 3
    rig.gatherer.gather.assert_not_called()
    assert len(rig.calls("enrich:releaseClaim")) == 3


def test_interrupt_releases_whole_batch(rig):
    rig.gatherer.gather.side_effect = KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        execute(rig)
    assert len(rig.calls("enrich:releaseClaim")) == 3


def test_drop_rate_gate_stops_at_twenty(rig, monkeypatch):
    monkeypatch.setattr(
        "pipeline.enrich.run.docent.generate",
        Mock(
            return_value=(
                [
                    {"sentence": "Only one kept sentence here.", "factIds": ["f1"]},
                ],
                4,
            )
        ),
    )
    original = rig.writer.mutation.side_effect
    rig.writer.mutation.side_effect = lambda name, args: (
        {"artworks": rig.artworks, "after": None}
        if name == "enrich:claimBatch"
        else original(name, args)
    )
    summary = execute(rig, budget=30, batch=30)
    assert summary.attempted == 20
    assert "40%" in summary.stopped
    assert len(rig.calls("enrich:releaseClaim")) == 10


def test_no_sources_or_no_facts_does_not_cache_empty_success(rig):
    rig.gatherer.gather.return_value = []
    summary = execute(rig)
    assert summary.failed == 3
    assert not rig.calls("docent:writeEnrichment")


def test_required_models_have_no_defaults():
    with pytest.raises(ValueError):
        EnrichmentSettings(_env_file=None, nebius_api_key="key", tavily_api_key="key")


def test_release_failure_does_not_abandon_remaining_claims(rig):
    original = rig.writer.mutation.side_effect

    def mutation(name, args):
        if name == "enrich:releaseClaim" and args["artworkId"] == "id0":
            raise RuntimeError("network unavailable")
        return original(name, args)

    rig.writer.mutation.side_effect = mutation
    rig.gatherer.gather.side_effect = ValueError("source failed")
    summary = execute(rig)
    assert summary.release_failures == 1
    assert len(rig.calls("enrich:releaseClaim")) == 3


def test_cached_sheet_rewrite_needs_no_search_budget(rig):
    rig.artworks[0]["factSheetUpdatedAt"] = 1
    rig.contents["id0"] = {"factSheet": [{**FACT, "id": "cached-fact"}]}
    summary = execute(rig, artwork_key="met:1")
    assert summary.written == 1
    rig.gatherer.gather.assert_not_called()
    assert all(c.kwargs == {"cached": True} for c in rig.provider.check_budget.call_args_list)
    assert "factSheet" not in rig.calls("docent:writeEnrichment")[0]
    assert rig.outputs[0]["factSheet"] == [{**FACT, "id": "cached-fact"}]


def test_cached_sheet_without_content_is_rebuilt(rig):
    rig.artworks[0]["factSheetUpdatedAt"] = 1
    summary = execute(rig, artwork_key="met:1")
    assert (summary.failed, summary.written) == (0, 1)
    rig.gatherer.gather.assert_called_once()
    assert rig.calls("docent:writeEnrichment")[0]["factSheet"]


def test_missing_setting_error_does_not_print_provider_keys():
    with pytest.raises(ValueError) as error:
        EnrichmentSettings(
            _env_file=None, nebius_api_key="private-test-secret", tavily_api_key="key"
        )
    assert "private-test-secret" not in str(error.value)


def test_reference_conflicts_write_a_review_hold_without_generating_prose(rig, monkeypatch):
    conflict = {
        "field": "artist",
        "text": "Follower of Pieter Brueghel II",
        "sourceUrl": "https://auction.example/1",
        "sourceLabel": "Auction",
        "referenceUrl": "https://www.wikidata.org/wiki/Q1",
    }
    monkeypatch.setattr(
        "pipeline.enrich.run.review_references", Mock(return_value=([], [conflict]))
    )
    prose = Mock(side_effect=AssertionError("Conflicts must not produce prose"))
    monkeypatch.setattr("pipeline.enrich.run.docent.generate", prose)
    result = run(
        rig.writer, rig.gatherer, rig.provider, budget=1, artwork_key="art:0", emit=lambda _: None
    )
    assert result.written == 1
    write = next(
        c for c in rig.writer.mutation.call_args_list if c.args[0] == "docent:writeEnrichment"
    )
    assert write.args[1]["researchConflicts"] == [conflict]
    assert write.args[1]["docentEn"] == []
    assert "factSheet" not in write.args[1]


@pytest.mark.parametrize("relation", ["other", "same_artwork"])
def test_fact_sheet_budget_applies_after_reference_review(rig, monkeypatch, relation):
    references = [
        {
            "url": f"https://auction.example/{i}",
            "label": "Auction",
            "score": 0.8,
            "referenceUrl": "https://www.wikidata.org/wiki/Q1",
            "text": f"{i} " * 12_000,
        }
        for i in range(2)
    ]
    article = {
        "url": "https://en.wikipedia.org/wiki/Harbor",
        "label": "Wikipedia",
        "score": 0.7,
        "text": "The artist painted the harbor outdoors during the summer.",
    }
    rig.gatherer.gather.return_value = references + [article]
    rig.provider.chat.return_value = {
        "reviews": [
            {
                "source": f"s{i + 1}",
                "relation": relation,
                "evidence": f"{i} " * 40,
                "comparison": "Compared the object details.",
                "conflicts": [],
            }
            for i in range(2)
        ]
    }
    sheet = Mock(return_value=[FACT])
    monkeypatch.setattr("pipeline.enrich.run.factsheet.generate", sheet)
    assert execute(rig, artwork_key="art:0").written == 1
    sources = sheet.call_args.args[1]
    if relation == "other":
        assert sources == [article]
    else:
        assert sum(len(s["text"]) for s in sources) == 40_000


def test_all_references_rejected_releases_claim_without_a_fact_sheet_call(rig, monkeypatch):
    monkeypatch.setattr("pipeline.enrich.run.review_references", Mock(return_value=([], [])))
    sheet = Mock()
    monkeypatch.setattr("pipeline.enrich.run.factsheet.generate", sheet)
    summary = execute(rig, artwork_key="art:0")
    assert (summary.failed, summary.written) == (1, 0)
    sheet.assert_not_called()
    assert rig.calls("enrich:releaseClaim") == [{"artworkId": "id0", "generation": 7}]


def test_catalogue_lines_alone_write_no_docent_and_are_not_a_failure(rig, monkeypatch):
    label = [{"id": "f1", "text": "Inception: 1889"}, {"id": "f2", "text": "Oil on canvas."}]
    monkeypatch.setattr("pipeline.enrich.run.factsheet.generate", Mock(return_value=label))
    prose = Mock(side_effect=AssertionError("Catalogue lines must not produce prose"))
    monkeypatch.setattr("pipeline.enrich.run.docent.generate", prose)
    summary = execute(rig, artwork_key="art:0")
    assert (summary.no_prose, summary.failed, summary.written) == (1, 0, 0)
    assert not rig.calls("docent:writeEnrichment")
    assert rig.calls("enrich:releaseClaim") == [{"artworkId": "id0", "generation": 7}]
    assert rig.outputs[0]["unwritten"] == "no_prose"


def test_accepted_references_follow_the_museums_own_text_in_the_budget(rig, monkeypatch):
    owner = {
        "url": "https://museum.example/work",
        "label": "Museum",
        "score": 1.0,
        "firstParty": True,
        "referenceUrl": "https://www.wikidata.org/wiki/Q1",
        "text": "The museum's own entry.",
    }
    cited = {
        "url": "https://auction.example/1",
        "label": "Auction",
        "score": 0.9,
        "referenceUrl": "https://www.wikidata.org/wiki/Q1",
        "text": "A cited lot description.",
    }
    article = {
        "url": "https://en.wikipedia.org/wiki/Harbor",
        "label": "Wikipedia",
        "score": 0.7,
        "text": "The artist painted the harbor outdoors.",
    }
    monkeypatch.setattr(
        "pipeline.enrich.run.review_references",
        Mock(return_value=([cited, owner, article], [])),
    )
    sheet = Mock(return_value=[FACT])
    monkeypatch.setattr("pipeline.enrich.run.factsheet.generate", sheet)
    assert execute(rig, artwork_key="art:0").written == 1
    assert [s["url"] for s in sheet.call_args.args[1]] == [
        owner["url"],
        article["url"],
        cited["url"],
    ]

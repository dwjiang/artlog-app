import copy
import json
import re
from types import SimpleNamespace
from unittest.mock import Mock, call

import httpx
import pytest
from convex import ConvexError

from pipeline.enrich import docent, factsheet, prompts
from pipeline.enrich.providers import Providers, SpendCap
from pipeline.model_version import REPO_ROOT


@pytest.fixture
def factory():
    clients = []

    def build(respond):
        http = httpx.Client(transport=httpx.MockTransport(respond))
        clients.append(http)
        writer = Mock()
        writer.mutation.return_value = "2026-09-11"
        writer.query.return_value = {"spent": 0, "cap": 20}
        settings = SimpleNamespace(
            nebius_api_key="key",
            tavily_api_key="key",
            fact_sheet_model="fact-test",
            docent_model="docent-test",
        )
        return Providers(writer, http, settings)

    yield build
    for client in clients:
        client.close()


def completion(value, finish="stop"):
    return httpx.Response(
        200,
        json={
            "choices": [{"finish_reason": finish, "message": {"content": json.dumps(value)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        },
    )


def test_docent_json_request_validation_and_token_accounting(factory):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return completion(
            [
                {"sentence": "The artwork depicts three fishing boats.", "fact_ids": ["f1", "f1"]},
                {"sentence": "The artist painted this on Mars.", "fact_ids": ["invented"]},
            ]
        )

    provider = factory(respond)
    facts = [{"id": "f1", "text": "Three boats"}]
    kept, generated = docent.generate(provider, facts)
    assert generated == 2 and kept == [
        {"sentence": "The artwork depicts three fishing boats.", "factIds": ["f1"]}
    ]
    body = requests[0]
    assert body["temperature"] == 0
    assert body["response_format"]["json_schema"]["strict"]
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    # The grammar carries the schema; the prompt carries only the data.
    assert json.loads(body["messages"][1]["content"]) == {"input": facts}
    assert provider.usage.prompt_tokens == 100 and provider.usage.completion_tokens == 50
    assert provider.usage.estimated_model_usd == pytest.approx(0.000018)
    assert provider.writer.mock_calls == [
        call.query("spend:assertCap", {"kind": "tokenFactory", "amount": 1}),
        call.mutation("spend:add", {"kind": "tokenFactory", "amount": 1}),
    ]


@pytest.mark.parametrize(
    "value,finish", [([{"sentence": "No citations"}], "stop"), ([], "stop"), ([], "length")]
)
def test_malformed_or_truncated_output_is_rejected_without_retry(factory, value, finish):
    provider = factory(lambda _: completion(value, finish))
    with pytest.raises(ValueError):
        docent.generate(provider, [{"id": "f1"}])
    assert provider.usage.token_factory_calls == 1
    assert provider.parse_failures == 1


def test_fact_schema_rejection_falls_back_and_validates(factory):
    requests = []
    fact = {"text": "A sourced fact"}

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(400, text="json_schema unsupported")
        return completion({"facts": [fact]})

    provider = factory(respond)
    source = {
        "url": "https://metmuseum.org/art",
        "label": "Met",
        "score": 1,
        "text": "A sourced fact",
    }
    result = factsheet.generate(
        provider,
        [source],
        {"title": "Sunflowers", "artist": "Vincent van Gogh", "date": "1887"},
    )
    first = json.loads(requests[0]["messages"][1]["content"])
    assert first == {
        "input": {
            "target": {"title": "Sunflowers", "artist": "Vincent van Gogh", "date": "1887"},
            "source": source,
        }
    }
    assert requests[0]["response_format"]["json_schema"]["schema"] == prompts.fact_sheet_schema(20)
    # Without a grammar the fallback prompt has to carry the wrapped schema itself.
    assert requests[1]["response_format"] == {"type": "json_object"}
    assert "schema" in json.loads(requests[1]["messages"][1]["content"])
    assert result[0]["sourceUrl"] == source["url"]
    assert result[0]["sourceLabel"] == "Met" and result[0]["sourceScore"] == 1
    assert provider.schema_fallbacks == 1 and provider.usage.token_factory_calls == 2


@pytest.mark.parametrize("fact_count,valid", [(0, False), (1, True), (8, True), (9, False)])
def test_each_source_respects_fact_bounds_after_schema_fallback(factory, fact_count, valid):
    def respond(request):
        body = json.loads(request.content)
        if body["response_format"]["type"] == "json_schema":
            return httpx.Response(400, text="json_schema unsupported")
        source = json.loads(body["messages"][1]["content"])["input"]["source"]
        count = fact_count if source["label"] == "Source 2" else 1
        return completion(
            {"facts": [{"text": line} for line in source["text"].splitlines()[:count]]}
        )

    provider = factory(respond)
    sources = [
        {
            "url": f"https://museum.example/{index}",
            "label": f"Source {index}",
            "score": 1,
            "text": "\n".join(f"Source {index} fact {fact}." for fact in range(9)),
        }
        for index in range(1, 4)
    ]
    artwork = {"title": "Painting", "artist": "Artist"}
    if valid:
        result = factsheet.generate(provider, sources, artwork)
        assert len(result) == fact_count + 2
        assert {fact["sourceUrl"] for fact in result} == {source["url"] for source in sources}
        assert provider.parse_failures == 0
    else:
        # A lesser source answering out of bounds is left out; the others still make the sheet.
        result = factsheet.generate(provider, sources, artwork)
        assert {fact["sourceUrl"] for fact in result} == {sources[0]["url"], sources[2]["url"]}
        assert provider.parse_failures == 1
        # The museum's own text failing the same way keeps the artwork retryable instead.
        sources[1]["firstParty"] = True
        with pytest.raises(ValueError, match="1 to 8 facts"):
            factsheet.generate(provider, sources, artwork)


def test_a_source_that_runs_out_of_tokens_is_dropped_and_the_others_kept(factory):
    def respond(request):
        source = json.loads(json.loads(request.content)["messages"][1]["content"])["input"][
            "source"
        ]
        if source["label"] == "Stalled":
            return completion([], "length")
        return completion([{"text": source["text"]}])

    provider = factory(respond)
    sources = [
        {"url": "https://metmuseum.org/art", "label": "Met", "score": 1, "text": "A sourced fact."},
        {
            "url": "https://stalled.example/",
            "label": "Stalled",
            "score": 1,
            "text": "Nothing to copy.",
        },
    ]
    result = factsheet.generate(
        provider, sources, {"title": "Sunflowers", "artist": "Vincent van Gogh"}
    )
    assert [fact["text"] for fact in result] == ["A sourced fact."]
    assert provider.usage.token_factory_calls == 2


def test_paid_timeout_is_not_retried_or_refunded(factory):
    def respond(request):
        raise httpx.ReadTimeout("ambiguous", request=request)

    provider = factory(respond)
    with pytest.raises(httpx.ReadTimeout):
        provider.search("painting", ["metmuseum.org"])
    assert provider.usage.tavily_credits == 1
    assert provider.writer.mock_calls == [
        call.query("spend:assertCap", {"kind": "tavily", "amount": 1}),
        call.mutation("spend:add", {"kind": "tavily", "amount": 1}),
    ]


def test_search_request_and_reported_credit_reconciliation(factory):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"results": [], "usage": {"credits": 0}})

    provider = factory(respond)
    assert provider.search("painting", ["metmuseum.org"]) == []
    assert requests[0]["search_depth"] == "basic" and requests[0]["max_results"] == 8
    assert requests[0]["include_raw_content"] == "markdown"
    assert requests[0]["include_domains"] == ["metmuseum.org"]
    assert provider.usage.tavily_credits == 0
    provider.writer.mutation.assert_any_call(
        "spend:reconcile", {"kind": "tavily", "day": "2026-09-11", "reserved": 1, "actual": 0}
    )


def test_cap_rejection_never_charges_or_dispatches(factory):
    respond = Mock()
    provider = factory(respond)
    # The Python client reports application errors with a generic message and the data on `.data`.
    provider.writer.query.side_effect = ConvexError(
        "Convex error", {"code": "spend_cap", "kind": "tokenFactory", "spent": 2000, "cap": 2000}
    )
    with pytest.raises(SpendCap, match="tokenFactory daily cap reached \\(2000/2000\\)"):
        docent.generate(provider, [{"id": "f1"}])
    respond.assert_not_called()
    provider.writer.mutation.assert_not_called()
    provider.writer.query.side_effect = None
    provider.writer.mutation.side_effect = ConvexError("Convex error", {"code": "invalid_spend"})
    with pytest.raises(ConvexError):
        docent.generate(provider, [{"id": "f1"}])
    respond.assert_not_called()


def test_versioned_system_prompts_match_convex():
    ts = (REPO_ROOT / "convex/lib/docentPrompts.ts").read_text()
    for name in ("FACT_SHEET_PROMPT", "DOCENT_PROMPT"):
        block = ts.split(f"export const {name} =", 1)[1].split(";\n", 1)[0]
        assert "".join(re.findall(r'"([^"]*)"', block)) == getattr(prompts, name)
    assert f'PROMPT_VERSION = "{prompts.PROMPT_VERSION}"' in ts


@pytest.mark.parametrize(
    "schema,filename",
    [(prompts.fact_sheet_schema(8), "factsheet"), (prompts.docent_schema(["f1", "f2"]), "docent")],
)
def test_schemas_match_the_evaluated_model_contract(schema, filename):
    retained = json.loads((REPO_ROOT / f"scripts/data/fixtures/{filename}-schema.json").read_text())
    # The retained contracts leave per-call bounds open: the live fact-sheet schema caps the facts
    # from the sources sent, and the live docent schema names the sheet's own ids.
    live = copy.deepcopy(schema)
    live.pop("maxItems", None)
    if filename == "docent":
        assert live["items"]["properties"]["fact_ids"]["items"].pop("enum") == ["f1", "f2"]
    assert live == retained


def test_reference_extraction_reserves_two_credits_and_keeps_partial_success(factory):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "results": [{"url": "https://auction.example/1", "raw_content": "Catalogue essay"}],
                "failed_results": [{"url": "https://gallery.example/2", "error": "Unavailable"}],
                "usage": {"credits": 0},
            },
        )

    provider = factory(respond)
    results = provider.extract(["https://auction.example/1", "https://gallery.example/2"])
    assert results == [{"url": "https://auction.example/1", "raw_content": "Catalogue essay"}]
    assert requests[0]["extract_depth"] == "advanced"
    assert requests[0]["include_usage"] is True
    provider.writer.mutation.assert_any_call("spend:add", {"kind": "tavily", "amount": 2})
    provider.writer.mutation.assert_any_call(
        "spend:reconcile", {"kind": "tavily", "day": "2026-09-11", "reserved": 2, "actual": 0}
    )
    assert provider.usage.tavily_credits == 0


def test_prose_copied_in_another_language_is_written_again_in_english(factory):
    italian = [
        {
            "sentence": "Il dipinto della pittrice è conservato nel museo di Lisbona.",
            "fact_ids": ["f1"],
        }
    ]
    english = [{"sentence": "The painting is kept in the museum in Lisbon.", "fact_ids": ["f1"]}]
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return completion(italian if len(requests) == 1 else english)

    provider = factory(respond)
    facts = [{"id": "f1", "text": "Il dipinto è conservato nel museo di Lisbona."}]
    kept, generated = docent.generate(provider, facts)
    assert kept == [{"sentence": english[0]["sentence"], "factIds": ["f1"]}]
    assert generated == 2
    assert requests[0]["response_format"]["json_schema"]["schema"] == prompts.docent_schema(["f1"])
    assert json.loads(requests[1]["messages"][1]["content"]) == {
        "input": facts,
        "previousAttemptProblems": prompts.ENGLISH_RETRY,
    }


def test_prose_still_not_in_english_after_one_retry_is_dropped(factory):
    italian = [
        {
            "sentence": "Il dipinto della pittrice è conservato nel museo di Lisbona.",
            "fact_ids": ["f1"],
        }
    ]
    provider = factory(lambda _: completion(italian))
    assert docent.generate(provider, [{"id": "f1", "text": "Il dipinto."}]) == ([], 2)
    assert provider.usage.token_factory_calls == 2


def test_mirrored_word_lists_and_patterns_match_their_typescript_sources():
    from pipeline.enrich import references

    prompts_ts = (REPO_ROOT / "convex/lib/docentPrompts.ts").read_text()
    for name, words in (
        ("ENGLISH_WORDS", prompts.ENGLISH_STOPWORDS),
        ("OTHER_WORDS", prompts.OTHER_STOPWORDS),
    ):
        assert re.search(rf'const {name} = new Set\(\s*"([^"]+)"', prompts_ts)[1] == words
    guide = (REPO_ROOT / "shared/audio/guide.ts").read_text()
    catalogue = re.search(r"const CATALOGUE_LINE =\s*/(.*?)/i;", guide)[1]
    assert catalogue == factsheet.CATALOGUE_LINE.pattern
    assert f"const MIN_PROSE_WORDS = {factsheet.MIN_PROSE_WORDS};" in guide
    assert f"const MAX_CAPTION_WORDS = {factsheet.MAX_CAPTION_WORDS};" in guide
    artwork_references = (REPO_ROOT / "convex/lib/artworkReferences.ts").read_text()
    namespace = re.search(r"const WIKI_NAMESPACE =\s*/(.*)/i;", artwork_references)[1]
    assert namespace.replace("\\/", "/") == references.WIKI_NAMESPACE.pattern
    review = (REPO_ROOT / "convex/lib/referenceReview.ts").read_text()
    for name in ("REVIEW_CATALOGUE_CHARS", "REVIEW_REFERENCE_CHARS"):
        assert f"const {name} = {getattr(references, name)};" in review

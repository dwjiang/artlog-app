import json
import re
from types import SimpleNamespace
from unittest.mock import Mock

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
    assert json.loads(body["messages"][1]["content"]) == {
        "input": facts,
        "schema": prompts.DOCENT_SCHEMA,
    }
    assert provider.usage.prompt_tokens == 100 and provider.usage.completion_tokens == 50
    assert provider.usage.estimated_model_usd == pytest.approx(0.000018)
    provider.writer.mutation.assert_called_once_with(
        "spend:reserve", {"kind": "tokenFactory", "amount": 1}
    )


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
    fact = {
        "id": "f1",
        "text": "A sourced fact",
        "sourceUrl": "https://metmuseum.org/art",
        "sourceLabel": "Forged label",
        "sourceScore": 0.1,
    }

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(400, text="json_schema unsupported")
        return completion({"facts": [fact]})

    provider = factory(respond)
    result = factsheet.generate(
        provider,
        [{"url": fact["sourceUrl"], "label": "Met", "score": 1, "text": "A sourced fact"}],
        {"title": "Sunflowers", "artist": "Vincent van Gogh", "date": "1887"},
    )
    target = json.loads(requests[0]["messages"][1]["content"])["input"]["target"]
    assert target == {"title": "Sunflowers", "artist": "Vincent van Gogh", "date": "1887"}
    assert requests[1]["response_format"] == {"type": "json_object"}
    assert result[0]["sourceLabel"] == "Met" and result[0]["sourceScore"] == 1
    assert provider.schema_fallbacks == 1 and provider.usage.token_factory_calls == 2


def test_paid_timeout_is_not_retried_or_refunded(factory):
    def respond(request):
        raise httpx.ReadTimeout("ambiguous", request=request)

    provider = factory(respond)
    with pytest.raises(httpx.ReadTimeout):
        provider.search("painting")
    assert provider.usage.tavily_credits == 1
    provider.writer.mutation.assert_called_once_with(
        "spend:reserve", {"kind": "tavily", "amount": 1}
    )


def test_search_request_and_reported_credit_reconciliation(factory):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"results": [], "usage": {"credits": 0}})

    provider = factory(respond)
    assert provider.search("painting") == []
    assert requests[0]["search_depth"] == "basic" and requests[0]["max_results"] == 8
    assert requests[0]["include_raw_content"] == "markdown"
    assert provider.usage.tavily_credits == 0
    provider.writer.mutation.assert_any_call(
        "spend:reconcile", {"kind": "tavily", "day": "2026-09-11", "reserved": 1, "actual": 0}
    )


def test_atomic_cap_rejection_never_dispatches(factory):
    respond = Mock()
    provider = factory(respond)
    # The Python client reports application errors with a generic message and the data on `.data`.
    provider.writer.mutation.side_effect = ConvexError(
        "Convex error", {"code": "spend_cap", "kind": "tokenFactory", "spent": 2000, "cap": 2000}
    )
    with pytest.raises(SpendCap, match="tokenFactory daily cap reached \\(2000/2000\\)"):
        docent.generate(provider, [{"id": "f1"}])
    respond.assert_not_called()
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
    "name,filename", [("FACT_SHEET_SCHEMA", "factsheet"), ("DOCENT_SCHEMA", "docent")]
)
def test_schemas_match_the_evaluated_model_contract(name, filename):
    schema = json.loads((REPO_ROOT / f"scripts/data/fixtures/{filename}-schema.json").read_text())
    assert getattr(prompts, name) == schema

import json
import logging
from dataclasses import asdict, dataclass

import httpx
from convex import ConvexError

log = logging.getLogger(__name__)


class SpendCap(RuntimeError):
    pass


@dataclass
class Usage:
    token_factory_calls: int = 0
    tavily_credits: float = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    estimated_model_usd: float = 0

    def report(self) -> dict:
        return asdict(self)


class Providers:
    def __init__(self, writer, http: httpx.Client, settings):
        self.writer = writer
        self.http = http
        self.settings = settings
        self.usage = Usage()
        self.schema_fallbacks = 0
        self.parse_failures = 0
        self.model_responses = 0
        self.fact_sheet_json_object = False

    def check_budget(self, *, cached: bool = False):
        for kind, needed in [("tokenFactory", 1 if cached else 2), ("tavily", 0 if cached else 1)]:
            if not needed:
                continue
            status = self.writer.query("spend:status", {"kind": kind})
            if status["spent"] + needed > status["cap"]:
                raise SpendCap(f"{kind} daily cap reached ({status['spent']}/{status['cap']})")

    def _reserve(self, kind: str, amount: int = 1) -> str:
        try:
            self.writer.query("spend:assertCap", {"kind": kind, "amount": amount})
            return self.writer.mutation("spend:add", {"kind": kind, "amount": amount})
        except ConvexError as error:
            # The Python client keeps application data on `.data`; its message is generic.
            data = error.data if isinstance(error.data, dict) else {}
            if data.get("code") == "spend_cap":
                raise SpendCap(
                    f"{kind} daily cap reached ({data.get('spent')}/{data.get('cap')})"
                ) from error
            raise

    def search(self, query: str, domains: list[str]) -> list[dict]:
        return self._tavily(
            "search",
            {
                "query": query,
                "search_depth": "basic",
                "auto_parameters": False,
                "max_results": 8,
                "include_raw_content": "markdown",
                "include_usage": True,
                "include_domains": domains,
                "include_domains_mode": "filter",
                "topic": "general",
            },
        ).get("results", [])

    def extract(self, urls: list[str]) -> list[dict]:
        if not 1 <= len(urls) <= 5:
            raise ValueError("Invalid reference count")
        data = self._tavily(
            "extract",
            {
                "urls": urls,
                "extract_depth": "advanced",
                "format": "text",
                "include_images": False,
                "include_usage": True,
                "timeout": 20,
            },
            reserved=2,
        )
        results = data.get("results", [])
        missing = sum(not any(row.get("url") == url for row in results) for url in urls)
        if missing:
            log.warning("%s reference pages unavailable", missing)
        return results

    def _tavily(self, operation: str, body: dict, reserved: int = 1):
        day = self._reserve("tavily", reserved)
        self.usage.tavily_credits += reserved
        response = self.http.post(
            f"https://api.tavily.com/{operation}",
            headers={"Authorization": f"Bearer {self.settings.tavily_api_key}"},
            json=body,
        )
        response.raise_for_status()
        data = response.json()
        credits = data.get("usage", {}).get("credits")
        if isinstance(credits, (int, float)) and not isinstance(credits, bool) and credits >= 0:
            if credits != reserved:
                self.writer.mutation(
                    "spend:reconcile",
                    {
                        "kind": "tavily",
                        "day": day,
                        "reserved": reserved,
                        "actual": credits,
                    },
                )
            self.usage.tavily_credits += credits - reserved
        return data

    def chat(
        self, *, stage: str, system: str, inputs: list[dict] | dict, schema: dict, max_tokens: int
    ):
        model = (
            self.settings.fact_sheet_model
            if stage in {"factSheet", "referenceReview"}
            else self.settings.docent_model
        )
        while True:
            fallback = stage == "factSheet" and self.fact_sheet_json_object
            request_schema = (
                {
                    "type": "object",
                    "properties": {"facts": schema},
                    "required": ["facts"],
                    "additionalProperties": False,
                }
                if fallback
                else schema
            )
            prompt = (
                system + ' Wrap the array in a JSON object under the key "facts".'
                if fallback
                else system
            )
            body = {
                "model": model,
                "temperature": 0,
                "max_tokens": max_tokens,
                "chat_template_kwargs": {"thinking": False}
                if "kimi" in model.lower()
                else {"enable_thinking": False},
                "messages": [
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        # The grammar carries the schema; json_object mode has none, so its prompt does.
                        "content": json.dumps(
                            {"input": inputs, "schema": request_schema}
                            if fallback
                            else {"input": inputs}
                        ),
                    },
                ],
                "response_format": (
                    {"type": "json_object"}
                    if fallback
                    else {
                        "type": "json_schema",
                        "json_schema": {"name": stage, "schema": schema, "strict": True},
                    }
                ),
            }
            self._reserve("tokenFactory")
            self.usage.token_factory_calls += 1
            response = self.http.post(
                "https://api.tokenfactory.nebius.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.nebius_api_key}"},
                json=body,
            )
            if (
                stage == "factSheet"
                and not fallback
                and response.status_code in (400, 422)
                and "json_schema" in response.text.lower()
            ):
                self.fact_sheet_json_object = True
                self.schema_fallbacks += 1
                log.warning(
                    "Super rejected json_schema; using json_object with strict local validation"
                )
                continue
            response.raise_for_status()
            data = response.json()
            usage = data.get("usage", {})
            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))
            self.usage.prompt_tokens += prompt_tokens
            self.usage.completion_tokens += completion_tokens
            # Estimated model cost, excluding Tavily and unreported usage.
            input_rate, output_rate = (
                (0.30, 0.90) if stage in {"factSheet", "referenceReview"} else (0.06, 0.24)
            )
            self.usage.estimated_model_usd += (
                prompt_tokens * input_rate + completion_tokens * output_rate
            ) / 1e6
            self.model_responses += 1
            try:
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise ValueError("Incomplete model response")
                value = json.loads(choice["message"]["content"])
                if fallback:
                    if not isinstance(value, dict) or set(value) != {"facts"}:
                        raise ValueError("Expected the facts wrapper in json_object mode")
                    value = value["facts"]
                return value
            except (KeyError, IndexError, TypeError, ValueError) as error:
                self.parse_failures += 1
                raise ValueError("Invalid or truncated model JSON") from error

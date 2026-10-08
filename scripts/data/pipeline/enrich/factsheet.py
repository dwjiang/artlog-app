from pydantic import BaseModel, ConfigDict, TypeAdapter

from .prompts import (
    FACT_SHEET_MAX_TOKENS,
    FACT_SHEET_PROMPT,
    MAX_FACTS,
    fact_sheet_schema,
    facts_per_source,
)
from .providers import TruncatedResponse
from .validator import normalize, source_passage


class RawFact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str


FACTS = TypeAdapter(list[RawFact])


# `extracted[i]` holds what the model copied from `sources[i]`; a fact stays only when it is verbatim there.
def build_fact_sheet(extracted: list[list[str]], sources: list[dict]) -> list[dict]:
    seen = set()
    facts = []
    for source, copied in zip(sources, extracted, strict=True):
        for raw in copied:
            text = normalize(raw)
            if (
                not text
                or text.lower() in seen
                or source_passage(text) not in source_passage(source["text"])
            ):
                continue
            seen.add(text.lower())
            facts.append(
                {
                    "text": text,
                    "sourceUrl": source["url"],
                    "sourceLabel": source["label"],
                    "sourceScore": source["score"],
                    **(
                        {"referenceUrl": source["referenceUrl"]}
                        if source.get("referenceUrl")
                        else {}
                    ),
                }
            )
    facts.sort(key=lambda fact: -fact["sourceScore"])
    return [{"id": f"f{i}", **fact} for i, fact in enumerate(facts[:MAX_FACTS], 1)]


# One call per source, as in convex/docent.ts: a source that runs out of tokens stalled on its required
# first fact and gives nothing; any other failure leaves the artwork retryable.
def generate(provider, sources: list[dict], artwork: dict) -> list[dict]:
    target = {k: artwork[k] for k in ("title", "artist", "date", "wikidataId") if k in artwork}
    max_facts = facts_per_source(sources)
    extracted = []
    for source in sources:
        try:
            value = provider.chat(
                stage="factSheet",
                system=FACT_SHEET_PROMPT,
                inputs={"target": target, "source": source},
                schema=fact_sheet_schema(max_facts),
                max_tokens=FACT_SHEET_MAX_TOKENS,
            )
        except TruncatedResponse:
            extracted.append([])
            continue
        try:
            raw = FACTS.validate_python(value)
            if not 1 <= len(raw) <= max_facts:
                raise ValueError(f"Expected 1 to {max_facts} facts per source")
        except ValueError:
            provider.parse_failures += 1
            raise
        extracted.append([fact.text for fact in raw])
    return build_fact_sheet(extracted, sources)

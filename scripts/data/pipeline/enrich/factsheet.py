from pydantic import BaseModel, ConfigDict, TypeAdapter

from .prompts import (
    FACT_SHEET_MAX_TOKENS,
    FACT_SHEET_PROMPT,
    MAX_FACTS,
    fact_sheet_schema,
    source_id,
)
from .validator import normalize, source_passage


class RawFact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str
    source: str


FACTS = TypeAdapter(list[RawFact])


# A fact keeps only the source it cited, and only when its text is verbatim in that source.
def build_fact_sheet(raw: list[dict], sources: list[dict]) -> list[dict]:
    by_id = {source_id(index): source for index, source in enumerate(sources)}
    seen = set()
    facts = []
    for fact in raw:
        source = by_id.get(fact["source"].strip())
        text = normalize(fact["text"])
        if (
            not source
            or not text
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
                **({"referenceUrl": source["referenceUrl"]} if source.get("referenceUrl") else {}),
            }
        )
    facts.sort(key=lambda fact: -fact["sourceScore"])
    return [{"id": f"f{i}", **fact} for i, fact in enumerate(facts[:MAX_FACTS], 1)]


def generate(provider, sources: list[dict], artwork: dict) -> list[dict]:
    value = provider.chat(
        stage="factSheet",
        system=FACT_SHEET_PROMPT,
        inputs={
            "target": {
                k: artwork[k] for k in ("title", "artist", "date", "wikidataId") if k in artwork
            },
            "sources": [{"id": source_id(index), **source} for index, source in enumerate(sources)],
        },
        schema=fact_sheet_schema(len(sources)),
        max_tokens=FACT_SHEET_MAX_TOKENS,
    )
    try:
        raw = FACTS.validate_python(value)
        if not raw:
            raise ValueError("Empty fact sheet response")
    except ValueError:
        provider.parse_failures += 1
        raise
    return build_fact_sheet([fact.model_dump() for fact in raw], sources)

import re
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .prompts import FACT_SHEET_MAX_TOKENS, FACT_SHEET_PROMPT, FACT_SHEET_SCHEMA, MAX_FACTS
from .validator import normalize


class RawFact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    text: str
    sourceUrl: str
    sourceLabel: str
    sourceScore: float = Field(ge=0, le=1)


FACTS = TypeAdapter(list[RawFact])


def source_passage(text: str) -> str:
    return normalize(re.sub(r"[\"'‘’“”]", "", unicodedata.normalize("NFKC", text)))


def build_fact_sheet(raw: list[dict], sources: list[dict]) -> list[dict]:
    by_url = {source["url"]: source for source in sources}
    seen = set()
    facts = []
    for fact in raw:
        source = by_url.get(fact["sourceUrl"].strip())
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
            "sources": sources,
        },
        schema=FACT_SHEET_SCHEMA,
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

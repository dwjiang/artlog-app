from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .prompts import (
    DOCENT_MAX_TOKENS,
    DOCENT_PROMPT,
    ENGLISH_RETRY,
    docent_schema,
    written_in_english,
)
from .validator import validate


class RawSentence(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sentence: str = Field(min_length=1)
    fact_ids: list[str]


SENTENCES = TypeAdapter(list[RawSentence])


def _write(provider, facts: list[dict], problems: str | None = None) -> tuple[list[dict], int]:
    fact_ids = [fact["id"] for fact in facts]
    value = provider.chat(
        stage="docent",
        system=DOCENT_PROMPT,
        inputs=facts,
        schema=docent_schema(fact_ids),
        max_tokens=DOCENT_MAX_TOKENS,
        previous_attempt_problems=problems,
    )
    try:
        raw = SENTENCES.validate_python(value)
        if not raw:
            raise ValueError("Empty docent response")
    except ValueError:
        provider.parse_failures += 1
        raise
    candidates = [{"sentence": s.sentence, "factIds": s.fact_ids} for s in raw]
    return validate(candidates, set(fact_ids)), len(candidates)


def english(sentences: list[dict]) -> bool:
    return written_in_english(" ".join(sentence["sentence"] for sentence in sentences))


# Facts copied from another language's page pull a small model into that language, so prose that is
# not English is written once more and then dropped (convex/docent.ts).
def generate(provider, facts: list[dict]) -> tuple[list[dict], int]:
    kept, generated = _write(provider, facts)
    if kept and not english(kept):
        kept, retried = _write(provider, facts, ENGLISH_RETRY)
        generated += retried
        if not english(kept):
            return [], generated
    return kept, generated

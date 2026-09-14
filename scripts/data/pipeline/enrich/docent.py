from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .prompts import DOCENT_MAX_TOKENS, DOCENT_PROMPT, DOCENT_SCHEMA
from .validator import validate


class RawSentence(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sentence: str = Field(min_length=1)
    fact_ids: list[str]


SENTENCES = TypeAdapter(list[RawSentence])


def generate(provider, facts: list[dict]) -> tuple[list[dict], int]:
    value = provider.chat(
        stage="docent",
        system=DOCENT_PROMPT,
        inputs=facts,
        schema=DOCENT_SCHEMA,
        max_tokens=DOCENT_MAX_TOKENS,
    )
    try:
        raw = SENTENCES.validate_python(value)
        if not raw:
            raise ValueError("Empty docent response")
    except ValueError:
        provider.parse_failures += 1
        raise
    candidates = [{"sentence": s.sentence, "factIds": s.fact_ids} for s in raw]
    return validate(candidates, {f["id"] for f in facts}), len(candidates)

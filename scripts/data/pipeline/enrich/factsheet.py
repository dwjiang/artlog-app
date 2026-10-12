import logging
import re
import unicodedata

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter

from .prompts import (
    FACT_SHEET_MAX_TOKENS,
    FACT_SHEET_PROMPT,
    MAX_FACTS,
    fact_sheet_schema,
    facts_per_source,
)
from .providers import SpendCap, TruncatedResponse
from .validator import WHITESPACE, normalize, source_passage

log = logging.getLogger(__name__)

# Wikidata summary lines and museum label-value rows read as a catalogue, and so does a bare title or
# caption ("Oil on canvas."); mirrors isCatalogueLine in shared/audio/guide.ts.
CATALOGUE_LINE = re.compile(
    r"^(?:label|title|creator|artist|maker|date|inception|material|medium|height|width|dimensions"
    r"|movement|genre|depicts|location|collection|inventory number|accession number|object number"
    r"|copyright status|rights|credit line|provenance|classification|culture|period|department)\s*:",
    re.IGNORECASE,
)
MIN_PROSE_WORDS = 6
# Captions, label rows and credit lines ("Medium Oil on canvas on board", "Gift of J. Pierpont Morgan, 1907")
# are short and never end like a sentence (shared/audio/guide.ts MAX_CAPTION_WORDS).
MAX_CAPTION_WORDS = 12
SENTENCE_END = re.compile(r"[.!?…。！？][\"'”’）」』]*$")
# Same Han/kana ranges and two-character word estimate as shared/audio/guide.ts.
UNSPACED = re.compile("[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")


class RawFact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str


FACTS = TypeAdapter(list[RawFact])


def is_catalogue_line(text: str) -> bool:
    line = text.strip()
    characters = len(UNSPACED.findall(line))
    words = (
        len(re.findall(r"[^\W_]+", UNSPACED.sub(" ", line))) + (characters + 1) // 2
        if characters
        else len([word for word in WHITESPACE.split(line) if word])
    )
    caption = words <= MAX_CAPTION_WORDS and not SENTENCE_END.search(line)
    return bool(CATALOGUE_LINE.match(normalize(text))) or words < MIN_PROSE_WORDS or caption


def _word_part(char: str, kinds: str = "LMN") -> bool:
    return unicodedata.category(char)[0] in kinds


# Words as convex/lib/docentPrompts.ts reads them: runs of letters, marks and digits, keeping an
# apostrophe that joins letters ("Monet's"), each with its normalized form and its span in the text.
def _words(text: str) -> list[tuple[str, int, int]]:
    words, index = [], 0
    while index < len(text):
        if not _word_part(text[index]):
            index += 1
            continue
        start = index
        while index < len(text) and _word_part(text[index]):
            index += 1
        while index + 1 < len(text) and text[index] in "'’" and _word_part(text[index + 1], "LM"):
            index += 1
            while index < len(text) and _word_part(text[index], "LM"):
                index += 1
        words.append((source_passage(text[start:index]), start, index))
    return words


def _edit_distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ours in enumerate(a, 1):
        current = [i]
        for j, theirs in enumerate(b, 1):
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ours != theirs))
            )
        previous = current
    return previous[-1]


# A copy that silently fixed one typo ("fo their" -> "for their") still names its passage: the
# source's own words are kept, with the typo. Numbers never count as a typo, and short copies must
# match exactly.
def _source_passage_for(source: str, copied: str) -> str | None:
    copy = _words(copied)
    if len(copy) < 8:
        return None
    page = _words(source)
    for start in range(len(page) - len(copy) + 1):
        fixed = 0
        for (ours, _, _), (theirs, _, _) in zip(page[start : start + len(copy)], copy, strict=True):
            if fixed > 1:
                break
            if ours != theirs:
                typo = not re.search("[0-9]", ours + theirs) and _edit_distance(ours, theirs) <= 2
                fixed += 1 if typo else 2
        if fixed <= 1:
            end = page[start + len(copy) - 1][2]
            close = 1 if re.match("[.!?]", source[end:]) else 0
            return source[page[start][1] : end + close]
    return None


# `extracted[i]` holds what the model copied from `sources[i]`; a fact stays only when it is verbatim
# there, and prose ranks ahead of catalogue lines for the sheet's places.
def build_fact_sheet(extracted: list[list[str]], sources: list[dict]) -> list[dict]:
    seen = set()
    facts = []
    for source, copied in zip(sources, extracted, strict=True):
        for raw in copied:
            tidy = normalize(raw)
            if source_passage(tidy) in source_passage(source["text"]):
                text = tidy
            else:
                text = normalize(_source_passage_for(source["text"], tidy) or "")
            if not text or text.lower() in seen:
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
    facts.sort(key=lambda fact: (is_catalogue_line(fact["text"]), -fact["sourceScore"]))
    return [{"id": f"f{i}", **fact} for i, fact in enumerate(facts[:MAX_FACTS], 1)]


# One call per source, as in convex/docent.ts: a source that runs out of tokens stalled on its required
# first fact and gives nothing. Any other failure of the museum's own text leaves the artwork retryable,
# since a retry may read it; a lesser source is left out rather than costing the work its story, unless no
# source gave facts at all. A spend cap always stops the run.
def generate(provider, sources: list[dict], artwork: dict) -> list[dict]:
    target = {k: artwork[k] for k in ("title", "artist", "date", "wikidataId") if k in artwork}
    max_facts = facts_per_source(sources)
    extracted = []
    failures: list[tuple[dict, Exception]] = []
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
        except SpendCap:
            raise
        except (httpx.HTTPError, RuntimeError, ValueError, OSError) as error:
            failures.append((source, error))
            extracted.append([])
            continue
        try:
            raw = FACTS.validate_python(value)
            if not 1 <= len(raw) <= max_facts:
                raise ValueError(f"Expected 1 to {max_facts} facts per source")
        except ValueError as error:
            provider.parse_failures += 1
            failures.append((source, error))
            extracted.append([])
            continue
        extracted.append([fact.text for fact in raw])
    gave_facts = any(extracted)
    essential = next(
        (error for source, error in failures if source.get("firstParty") or not gave_facts), None
    )
    if essential:
        raise essential
    for source, error in failures:
        log.warning("Fact sheet left out %s: %s", source.get("url"), error)
    return build_fact_sheet(extracted, sources)

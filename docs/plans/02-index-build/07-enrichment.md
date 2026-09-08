# Plan 02.07: The enrichment job — sourced fact sheets (Nemotron Super) and validated docent sentences (Nemotron Lightning)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`. Read `NEBIUS_API_KEY`/`TAVILY_API_KEY` from env.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/enrich convex/lib/docentValidator.ts shared/fixtures/docent-validator.json jobs/config/source-scores.json`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (spend; grounding correctness)
- **Depends on**: 02.05 (artworks exist), 04.09 (Convex `docent` module shares the validator and the write mutation), `docs/decisions/004-token-factory-models.md`, `docs/decisions/005-data-sources.md` (source scores), `docs/decisions/007-tavily.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.8: every artwork gets a **fact sheet** — discrete facts each with the URL it came from, sources score-filtered — written once by Nemotron 3 Super, and **docent prose** — three or four English sentences using only those facts, `[{sentence, fact_ids}]`, temperature 0 — written once by Nemotron Nano (now Lightning), validated so any sentence without a valid `fact_ids` is dropped, and cached on the artwork. Precomputed for on-view works at indexed venues in crawl-queue order to a daily budget and for every promoted contribution; everything else generates on first identification (plan 04.09). §8: generated text is grounded or dropped.

## Current state

- Token Factory (verified 2026-09-08): base URL `https://api.tokenfactory.nebius.com/v1/`; `nvidia/nemotron-3-super-120b-a12b` ($0.30/$0.90 per 1M tokens), `nvidia/Nemotron-3_5-Lightning` ($0.06/$0.24); `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }` supported per model; env var names `FACT_SHEET_MODEL`, `DOCENT_MODEL` set by spike 00.04.
- Tavily search for enrichment context: `search(query, { search_depth: 'basic', max_results: 8, include_raw_content: False })` = 1 credit.
- Convex (plan 04.09): `docent.writeEnrichment` internal mutation `{ artworkKey | artworkId, factSheet, docentEn, models: { factSheet, docent } }` sets `factSheet`, `factSheetUpdatedAt`, `docent.en`, `docentUpdatedAt`; `enrich.claimBatch` internal mutation returns up to N artworks needing a sheet (`factSheetUpdatedAt == null`, priority: on-view at indexed venues in queue order, then promoted `source: user` objects) and marks them `enrichClaimedAt` (schema field added in 04.09); `spend.recordSpend`.
- The validator must be identical in Python and TypeScript; `shared/fixtures/docent-validator.json` holds cases `[{ factIds: [...], sentences: [...], expectedKept: [...] }]` created here and consumed by `convex/lib/docentValidator.test.ts` (04.09) and `validator_test.py`.
- `jobs/config/source-scores.json` from spike 00.05: `{ "domains": { "metmuseum.org": 1.0, "wikipedia.org": 0.7, … }, "excluded": ["pinterest.com", …], "default": 0.3, "threshold": 0.5 }`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Run | `uv run python -m artlog_jobs.enrich.run --budget 200 --batch 20` | logs per artwork with token counts |
| One artwork | `uv run python -m artlog_jobs.enrich.run --artwork met:436535 --dry-run` | prints the sheet + sentences, writes nothing |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/enrich` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/enrich/{__init__,run,sources,factsheet,docent,validator,prompts}.py` (+ tests), `jobs/config/source-scores.json`, `shared/fixtures/docent-validator.json`, `jobs/README.md`.

**Out of scope**: the Convex `docent` action and cache-miss path (04.09), corrections (`correctFact`, 04.09), "Right now" (04.09), moderation (04.06).

## Steps

### Step 1: Sources

`sources.py`: `gather(artwork, object) -> list[SourceDoc]`: the owner page (`object.pageUrl`, fetched with `PoliteClient`, text extracted with `trafilatura`-style stripping — use `beautifulsoup4` + a minimal boilerplate cut, ≤ 6,000 chars), the Wikidata entity (`https://www.wikidata.org/wiki/Special:EntityData/<Q>.json` → labels, dates, `P1476`, `P571`, `P186`, `P2048/P2049`, `P276`, `P195`, `P217`, `P6216`; and the English Wikipedia sitelink's summary via `https://en.wikipedia.org/api/rest_v1/page/summary/<title>`), Tavily results for `f'"{title}" {artist} painting'` (8, basic) scored by domain (`source-scores.json`; drop excluded and below threshold). Each `SourceDoc { url, label (domain or site name), score, text }`.

**Verify**: tests with mocked HTTP: scoring, exclusion, char limits.

### Step 2: Fact sheet

`factsheet.py`: prompt (in `prompts.py`) instructs Super to return **only** facts stated in the provided sources, each with the exact source URL it came from, as JSON `{ facts: [{ text, sourceUrl }] }` (json_schema, strict); post-process: drop facts whose `sourceUrl` is not one of the provided URLs (hallucinated URL), assign ids `f1…fn`, attach `sourceLabel`/`sourceScore`, cap at 14 facts, sort by score desc. Record prompt/completion tokens.

**Verify**: tests: unknown URL dropped; ids sequential; cap.

### Step 3: Docent sentences and the shared validator

`docent.py`: prompt Lightning with the fact list (`f1: text (source)`) to write 3–4 English sentences, temperature 0, JSON `{ sentences: [{ sentence, fact_ids }] }`. `validator.py`: `validate(sentences, fact_ids_on_sheet) -> kept` dropping sentences with empty `fact_ids`, any id not on the sheet, duplicate sentences, sentences > 240 chars, or fewer than 4 words; keep at most 4. Generate `shared/fixtures/docent-validator.json` with ≥ 8 cases (all-valid, empty ids, unknown id, duplicate, too long, too many, mixed) and make `validator_test.py` load it.

**Verify**: `validator_test.py` passes on the fixture; `npx vitest run convex/lib/docentValidator` (plan 04.09) passes on the same fixture — run both.

### Step 4: Runner with budget

`run.py`: `claimBatch(N)` → per artwork: gather → fact sheet → docent → validate → `writeEnrichment` → `recordSpend({ tokenFactoryCalls: 2, tavilyCredits: 1 })`; stop when `--budget` artworks or the Convex daily cap (`spend.assertUnderCap` via a query) is reached; `--dry-run` prints without writing; failures leave the artwork unclaimed after 1 h (04.09's `claimBatch` re-claims stale claims). Log per-artwork cost estimate from token counts.

**Verify**: dry run on 3 real artworks prints plausible sheets; a real run of `--budget 20` writes 20 artworks (`npx convex data artworks --limit 5` shows `docent.en`); cost logged (expect < $0.05 per artwork).

## Test plan

`sources_test.py`, `factsheet_test.py`, `docent_test.py`, `validator_test.py` (fixture-driven), `run_test.py` (budget stop, dry-run, failure handling) — all with mocked LLM/HTTP.

## Done criteria

- [ ] Tests pass; `ruff` clean; the shared fixture passes in both languages
- [ ] 20 real artworks enriched on the dev deployment; average cost recorded in `jobs/README.md`
- [ ] No fact without a source URL from the provided set (test + a spot check of 5 real sheets)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- Spike 00.04's model IDs are missing — do not guess IDs; report.
- Super's `json_schema` mode is rejected — fall back to `json_object` + manual validation and report the parse-failure rate.
- Validator drop rate > 40% on the first 20 — report; the prompt needs work before spending more.

## Maintenance notes

- Prompts are versioned strings in `prompts.py`; bump `PROMPT_VERSION` and clear `docentUpdatedAt` (plan 04.09's `invalidateDocent`) when they change materially.
- The daily budget lives in Convex env (`DAILY_TOKEN_FACTORY_CALL_CAP`), not here.

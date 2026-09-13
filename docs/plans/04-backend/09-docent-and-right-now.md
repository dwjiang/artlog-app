# Plan 04.09: Docent text (cache-miss generation with the shared validator), "Right now" via Tavily, and fact corrections

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/docent.ts convex/rightNow.ts convex/enrich.ts convex/lib/docentValidator.ts convex/identify.ts shared/sources/regions.json`

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED (spend; grounding)
- **Depends on**: 04.03 (scheduling hook), 04.04 (flags/spend), 04.06 (`tokenFactory`, `tavily`, `wikidata` clients), `docs/decisions/004-token-factory-models.md`, `docs/decisions/007-tavily.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.8: docent sentences are generated once per artwork from a sourced fact sheet, validated (any sentence whose `fact_ids` is empty or unknown is dropped), cached on `artworks.docent.en`, and rendered with source chips; precomputed by the enrichment job for on-view works, generated on first identification for everything else (card first, sentences 2–3 s later). "Right now": one Tavily search with `include_answer`, `topic: news`, one-month window, region domains, guarded by score and window, first sentence only, cached per `(artistId, region)` for seven days, labeled "From the web". Museums and estates can correct a fact, which invalidates cached sentences. §9: nothing on the card waits for a model call.

## Current state

- `artworks.{factSheet, factSheetUpdatedAt, docent.en, docentUpdatedAt}`; `artistContext` (7-day cache); `scans.{docent, rightNow}`; `museums.region`; `shared/sources/regions.json` (02.02) `{ "<key>": { name, center, domains } }`.
- Clients from 04.06: `tokenFactory.chatJson`, `tavily.search`, `wikidata.getEntity`; flags/spend from 04.04; models `FACT_SHEET_MODEL`, `DOCENT_MODEL`.
- Python enrichment (02.07) shares the validator through `shared/docent/fixtures/docent-validator.json` and calls `enrich.claimBatch` / `docent.writeEnrichment`.
- Convex: schedule from actions with `ctx.scheduler.runAfter(0, internal.fn, args)`; the `scans.get` query joins artwork fields reactively — the app's subscription updates when the artwork's `docent` is written.

## Scope

**In scope**: `convex/lib/docentValidator.ts` (+ fixture test), `convex/docent.ts`, `convex/rightNow.ts`, `convex/enrich.ts` (claims for the Python job), `convex/corrections.ts` (`correctFact`), `convex/schema.ts` (`artworks.enrichClaimedAt?`, `artworks.factSheetNeedsReview?: boolean`, `factCorrections` table), `convex/identify.ts` (two `runAfter` lines after `setResult`), `convex/scans.ts` (`get` joins `artwork.docent.en`, `artwork.factSheet` and `rightNow`), tests.

**Out of scope**: the Python job (02.07), UI (05.02).

## Steps

### Step 1: Shared validator

`docentValidator.ts`: `validateDocent(sentences: { sentence: string; factIds: string[] }[], sheetIds: Set<string>) → kept[]` with exactly the rules of plan 02.07 Step 3 (empty ids, unknown id, duplicates, > 240 chars, < 4 words, max 4). Test loads `shared/docent/fixtures/docent-validator.json` (created by 02.07 — if it does not exist yet, create it here with the same ≥ 8 cases and tell 02.07 to reuse it).

**Verify**: `npx vitest run convex/lib/docentValidator` → all fixture cases pass.

### Step 2: Docent on cache miss

`docent.ts`: `ensure` (internal action) args `{ artworkId, scanId, deviceId }`: if `docent.en` exists → return; `internal.docent.claim` (mutation: sets `enrichClaimedAt` unless claimed < 10 min ago → returns the new generation or `null`); gather sources (owner page via `object.pageUrl` with the same-host rule as 04.06, Wikidata entity summary, Tavily basic search 5 results filtered by `shared/sources/source-scores.json` — copy 02.07's `jobs/config/source-scores.json` to `shared/` and have both read it); `assertUnderCap('tokenFactory')`; `limitDevice('docent', deviceId)`; fact sheet via `FACT_SHEET_MODEL` (drop facts with unknown URLs, cap 14, ids `f1…`); sentences via `DOCENT_MODEL` (temperature 0); validate; `writeEnrichment` (internal mutation: requires the owning `generation`, refuses reviewed or superseded runs, patches artwork fields + `docentUpdatedAt`, clears claim; the action reserves and reconciles spend). `invalidateDocent({ artworkId })` clears `docent`/`docentUpdatedAt` and invalidates in-flight generations. `enrich.ts`: `claimBatch({ limit, after? })` returns a bounded page of claims plus a cursor `{ phase: 'contributions' | 'artworks', cursor: string | null }`. Sweep contributions first, then on-view artworks, passing `after` through empty pages until it is `null`. `releaseClaim({ artworkId, generation })` releases only that generation. See 02.07 for the worker contract.

**Verify**: `docent.test.ts` with stubbed `fetch`: cache hit makes no model call; miss writes sheet + sentences and records spend; concurrent claim is skipped; validator drops a bad sentence; flag/cap paths.

### Step 3: "Right now"

`rightNow.ts`: `fetch` (internal action) args `{ scanId, artistId?, artist: string, venueId?, deviceId }`: `isEnabled('rightNow')` else return. Follow [decision 007](../../decisions/007-tavily.md), including its exact Search call shape and acceptance boundary. Region = museum.region, with a configured country-list fallback; unknown/unconfigured coverage suppresses the card. Cache key `(artistId ?? 'name:' + normalized artist, region)`: hit < 7 days → write `scans.rightNow` (skip when `empty`); coalesce misses, apply `limitDevice('rightNow')`, and atomically reserve one Tavily credit through 04.04 before dispatch. Use explicit basic depth, disabled auto parameters, and domain `filter` mode. Require score ≥ 0.60, a valid nonfuture publication date within 31 days, substantive artist-specific content, current-event evidence, and support for the displayed claim in the actual cited source. Do not automatically cite `results[0]` for a multi-source answer. Unsupported/contradictory claims and abstentions become `empty: true`; cache both successes and empty results for seven days. Require a complete first sentence copied from the actual source, with an explicit event date including the year within 31 days before or after now. Preserve initials and suppress sentences over 200 characters instead of truncating qualifications. Reconcile reported usage without charging the reservation twice. Keep `FLAG_RIGHT_NOW=off` until the acceptance boundary passes the spike's failure cases and held-out review.

**Verify**: `rightNow.test.ts`: flag off by default; cache hit; concurrent misses coalesced; supported answer uses its actual evidence source; low score and synthetic-name nonempty answers → empty cached; missing/malformed/future dates refused; recent archive metadata does not establish event recency; source-contradicted high-score answer refused; unknown region makes no unrestricted request; first-sentence truncation preserves initials. Use the recorded 00.07 responses as regression fixtures and document a held-out review before enabling the flag.

### Step 4: Corrections

`corrections.ts`: `correctFact` (public mutation, `requireDevice`, `limitDevice('correctFact')` — add the limit name in `rateLimits.ts`: 5/day) args `{ artworkId, factId, message, contact }` → insert `factCorrections { artworkId, factId, message, contact, deviceId, createdAt, status: 'open' }`, set `artworks.factSheetNeedsReview = true`, `invalidateDocent`. `review.listCorrections` internal query; `review.replaceFactSheet({ artworkId, factSheet, correctionIds })` resolves up to 100 explicitly addressed correction IDs for that artwork while invalidating old generations. It clears the review hold only when no open reports remain; pass an empty ID list for a sheet edit that addresses no reports.

**Verify**: test: correction clears `docent.en` and flags the sheet.

### Step 5: Wire identify and scans

`identify.ts`: after `setResult` with a `best` → `ctx.scheduler.runAfter(0, internal.docent.ensure, { artworkId, scanId, deviceId })` and `ctx.scheduler.runAfter(0, internal.rightNow.fetch, { scanId, artistId, artist, venueId, deviceId })` (also for `soft` when a best exists? No — only `confident`; the soft card shows runner-ups without prose). `scans.get` returns `docent: artwork.docent?.en`, `factSheet` (for chips: id → `{ sourceUrl, sourceLabel }`), `rightNow`.

**Verify**: `identify.test.ts` with `t.finishAllScheduledFunctions` and stubbed fetch: a confident result leads to `docent.en` on the artwork and `rightNow` on the scan.

## Test plan

`docentValidator.test.ts` (fixture), `docent.test.ts`, `rightNow.test.ts`, `corrections.test.ts`, `identify.test.ts` additions — all with `vi.stubGlobal('fetch')`.

## Done criteria

- [ ] Tests pass (≥ 20 new); tsc/lint; `npx convex dev --once`
- [ ] A live check on the dev deployment: one uncached artwork gets sentences within ~5 s of a confident scan (note the time); "Right now" appears for a famous artist with the flag on
- [ ] `grep -n "temperature" convex/docent.ts` → `0`
- [ ] `docs/plans/README.md` updated

## STOP conditions

- Model IDs missing (00.04) — report.
- Tavily returns no `published_date` for `topic: news` in practice — keep the score guard only and note it in the record.

## Maintenance notes

- The card must never wait on these actions; they are scheduled after the result is written. Keep it that way.
- Prompt versions: `convex/lib/docentPrompts.ts` `PROMPT_VERSION`; mirror 02.07's.

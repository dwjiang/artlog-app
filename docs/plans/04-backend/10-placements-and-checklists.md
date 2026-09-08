# Plan 04.10: Exhibition checklists as time-bounded placements, and placement-proposal review

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/placements.ts convex/checklists.ts jobs/artlog_jobs/ingest_checklist.py`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 04.03 (`proposeFromScan`), 02.01 (Python writer), `docs/decisions/005-data-sources.md` (checklist JSON shape)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3/§4.2: exhibition checklists and loans are ingested as time-bounded placements so a painting on loan is identifiable where it hangs; scan-derived move evidence becomes a placement proposal that needs agreement **and human review**; `multiplicity` decides whether a proposal is a move or a new object; museum data promotes alone; scan evidence never writes `placements` directly; saved records are untouched by any of this.

## Current state

- `placements { objectId, venueId, gallery?, onView, from?, to?, source, confidence, closedAt? }`; `currentPlacement()` picks the active row by window then source rank (`manual > feed > checklist > proposal > crawl > wikidata`; add `contribution` between `proposal` and `crawl` — 04.08 introduced it).
- `placementProposals { objectId, proposedVenueId, kind, scanIds, deviceIds, firstSeenAt, lastSeenAt, status, readyForReview, reviewer?, reviewedAt? }` with `proposeFromScan` upserting and computing `readyForReview = distinct deviceIds ≥ 2` (04.03).
- Checklist JSON shape from spike 00.05: `{ venueKey, exhibition: { title, from: ISO date, to: ISO date, sourceUrl }, gallery?, works: [{ objectKey? | wikidataId? | { title, artist, ownerKey?, accession? } }] }`.

## Scope

**In scope**: `convex/checklists.ts` (`ingestChecklist` internal mutation + `resolveWork` helper), `convex/placements.ts` (`reviewPlacement`, `listProposals`, refine `proposeFromScan`), `convex/lib/placements.ts` (rank update), `jobs/artlog_jobs/ingest_checklist.py` (+ test) converting CSV/JSON into the call, tests, `shared/fixtures/checklist-example.json`.

**Out of scope**: automatic placement promotion (explicitly never), UI.

## Steps

### Step 1: Checklist ingestion

`checklists.ts` `ingestChecklist` (internal mutation) args = the JSON shape above (validated with `v.*`) → for each work resolve the object: by `objectKey`; else by `wikidataId` → artwork `by_wikidataId` → its first non-reverted object (prefer one whose `ownerId` matches `ownerKey` when given); else by `(ownerKey, accession)` via `objects.by_owner_accession`; else by normalized `title+artist` against `artworks` (no index for that: skip and report). For resolved objects: close any existing `checklist` placement with the same `venueId` and overlapping window, insert `{ venueId, gallery, onView: true, from, to, source: 'checklist', confidence: 0.85 }`. Return `{ placed: n, unresolved: [{ input, reason }] }`. Idempotent for re-ingestion of the same checklist.

`ingest_checklist.py`: reads a CSV (`title,artist,owner,accession,wikidata`) or JSON, builds the payload, calls `checklists:ingestChecklist` through `ConvexWriter`, prints the unresolved list. Include `shared/fixtures/checklist-example.json`.

**Verify**: `checklists.test.ts`: each resolution path; overlap replacement; idempotency; `currentPlacement` returns the checklist placement inside the window and the home placement outside (assert via `identify`'s `loadCandidates` on a seeded object).

### Step 2: Proposal readiness and review

`placements.ts`: refine `proposeFromScan` — `readyForReview` also requires `lastSeenAt − firstSeenAt ≥ 1 day` **or** ≥ 3 distinct devices; `kind` from `artworks.multiplicity` (`unique → move`, otherwise `new_object`). `reviewPlacement` (internal mutation, dashboard-run) args `{ proposalId, decision: 'approve' | 'reject', reviewer }`: approve `move` → close the current placement(s) at other venues (`closedAt = now`), insert `{ venueId: proposedVenueId, onView: true, source: 'proposal', confidence: 0.7 }`; approve `new_object` → create object `{ key: 'user:proposal:' + proposalId, artworkId, ownerId: proposedVenueId, source: 'user', sourceId: proposalId, provenance: { contributionIds: [], deviceIds } }`, copy the proposal scans' vectors as `user_scan` rows for the new object, placement at the proposed venue; reject → `status: rejected`. `listProposals({ status })` internal query. Saved `collections` rows are never touched (test asserts a saved snapshot is unchanged after approval).

**Verify**: `placements.test.ts`: readiness rules; approve move closes old + inserts new; approve new_object creates the object with vectors; reject; snapshot unchanged.

## Test plan

`checklists.test.ts`, `placements.test.ts` (convex-test), `ingest_checklist_test.py`.

## Done criteria

- [ ] Tests pass; tsc/lint; `npx convex dev --once`; `uv run pytest -q artlog_jobs/ingest_checklist_test.py`
- [ ] `grep -n "db.insert(\"placements\"\|db.insert('placements'" convex/*.ts` shows inserts only in `checklists.ts`, `placements.ts` (review), `promotion.ts` (contribution) and `ingest.ts` (feeds/crawl) — never in identify/feedback
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The checklist shape from 00.05 differs materially — adapt the validator and report the delta.

## Maintenance notes

- Human review is by design; do not add an auto-approve path.

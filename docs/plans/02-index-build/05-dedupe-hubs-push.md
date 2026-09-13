# Plan 02.05: Deduplicate by owner, flag hubs, and push the corpus into Convex

> **Scope update, 2026-09-12:** The user deferred hub scoring. Its remaining
> work is in [the hub-scoring todo](../../todos/hub-scoring/README.md).
> Skip the deferred step. Exports and imports require no penalty files;
> imported objects receive a neutral hub penalty of `0`.

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/dedupe.py jobs/artlog_jobs/hubs.py jobs/artlog_jobs/push.py convex/ingest.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (a wrong merge conflates two paintings; the push is the first real load on Convex)
- **Depends on**: 02.04; `docs/decisions/002-vector-search-scale.md` (batch sizes)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.7 steps 5–7: merge duplicate records of the same physical painting on `(ownerId, accession)` or on near-identical embeddings with a matching artist, keep both vectors under one object as a multi-view pair, never merge across owners; flag "hub" objects whose embedding is abnormally similar to everything; then push artworks, objects, placements, vectors and descriptors to Convex in resumable batches with hotlinked thumbnails for public-domain works only.

## Current state

- `SCRATCH_DIR` on the operator's Mac holds `metadata/*.jsonl` (02.03) and `features/` shards + `manifest.json` (02.04); the images are already gone.
- `convex/ingest.ts` (02.01) has the upsert mutations keyed by natural keys; `upsertVectors` replaces `(objectKey, modelVersion, source)`; `upsertDescriptors` one per object; `setObjectPenalty`; `counts`.
- Convex limits (verified): ≤ 16,000 docs / 16 MiB per mutation; 1536 floats ≈ 15–25 KB as JSON → **≤ 300 vectors per batch**; descriptors ≤ 24 KB each → ≤ 300 per batch; spike 00.02 measured throughput (use its recommended sizes if smaller).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Dedupe | `uv run python -m artlog_jobs.dedupe --features $SCRATCH_DIR/features --metadata $SCRATCH_DIR/metadata --out $SCRATCH_DIR/merged` | `merges.jsonl`, updated `objects.jsonl` |
| Push full corpus, after import preparation | `uv run python -m artlog_jobs.push --in $SCRATCH_DIR/merged --full` | counts printed |

## Scope

**In scope**: `jobs/artlog_jobs/{dedupe,push}.py` (+ tests), `build_index.py`, `jobs/README.md`.

**Out of scope**: [deferred hub scoring](../../todos/hub-scoring/README.md), calibrator penalties from feedback (04.07).

## Steps

### Step 1: Dedupe

`dedupe.py`: load objects + vectors; (a) group objects with the same `ownerKey` and normalized accession (strip spaces/punctuation, casefold) → merge into the record from the highest-priority source (`met`/`aic` > `wikidata`), record `{ from: key, into: key, rule: 'accession' }`; (b) for remaining objects, build a cosine index per owner (torch matmul on `settings.device` in blocks of 20k; numpy on CPU is acceptable) and merge pairs with cosine ≥ 0.95 **and** matching normalized artist, `rule: 'embedding'`; never merge across different `ownerKey`s or when either has no owner. Output: `merges.jsonl`, updated `objects.jsonl` (merged objects keep `mergedIntoKey`), and a vectors index where merged objects' vectors are re-keyed to the surviving object (`source` per vector preserved).

**Verify**: `dedupe_test.py`: accession merge; embedding merge requires artist match; cross-owner never merges; merged vectors re-keyed.

### Step 2: Hubs — deferred

Moved to [the hub-scoring todo](../../todos/hub-scoring/README.md) at the user's
request on 2026-09-12. The algorithm, storage contract, remaining tests, and
evaluation work are recorded there.

### Step 3: Push

`push.py`: order — museums are already present; `upsertArtworks` (500/batch) → `upsertObjects` (500) → `upsertPlacements` (500) → `upsertVectors` (300, `source: 'corpus'`; two rows for multi-view objects) → `upsertDescriptors` (300) → `setObjectPenalty`; checkpoint per stage and batch; skip objects whose download failed (no vector) but still upsert their metadata; `thumbnailUrl` only when `rightsStatus == public_domain` (assert in code). End with `counts()` and compare to expected; print a report.

**Verify**: `push_test.py` with a fake writer checks ordering, batch sizes, the thumbnail assertion, and resume; a smoke push of 1,000 objects to the dev deployment shows matching `counts()`; `npx convex data vectors --limit 1` shows a 1536-float vector. This smoke push also measures rows/s from the Mac's connection — it is the batch-size evidence spike 00.08 was meant to provide; record it.

### Step 4: Full push and record

**Deferred by the user on 2026-09-13.** The preserved data location and steps for
resuming production upload are in [the production-upload todo](../../todos/production-upload/README.md).
Do not run this step until the user resumes it.

After import preparation accounts for the deferred hub stage, run the full import on the Mac under `caffeinate -i` (the push is bound by Pro's write throughput and the laptop's uplink, so budget hours); record durations, rows/s, counts and Convex dashboard storage (DB and search) in `jobs/README.md`; confirm the dev deployment still serves `health.ping`.

**Verify**: `counts()` equals `stats.json` minus failed downloads; dashboard search storage recorded.

## Test plan

`dedupe_test.py`, `push_test.py`, `build_index_test.py`. Hub tests belong to the deferred todo.

## Done criteria

- [ ] Tests pass; `ruff` clean
- [ ] Full push done; counts and storage recorded; `merges.jsonl` count recorded
- [ ] No `thumbnailUrl` on non-public-domain objects (`npx convex run` a one-off internal query counting them → 0; add `ingest.auditThumbnails` internal query for this)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- Push hits write-size errors at 300 vectors — halve and report.
- Convex search storage after the push exceeds the projection in `docs/decisions/002-vector-search-scale.md` by > 50% — report before continuing.

## Maintenance notes

- Merges are recorded so a rebuild reproduces them (§5.7 step 5); `merges.jsonl` is the audit trail — copy it to `jobs/out/` and keep it with the manifest.
- The first real `identify` runs (plan 04.03) happen against this data; the hub penalty is the only calibrator input that comes from the build.

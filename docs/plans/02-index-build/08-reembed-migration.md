# Plan 02.08: `reembed` — migrate the index to a new embedding-model version without downtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/reembed.py convex/ingest.ts docs/runbooks`

## Status

- **Priority**: P2 (not needed until the model changes; build it before the first migration, not before launch)
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 02.04, 02.05, 04.03 (version gate)
- **Category**: migration
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.4: every vector carries `modelVersion`; a new app ships a new model; `reembed(newVersion)` backfills the new version's vectors from `imageRef` (source image URL for corpus works, page/image URL for crawled works, the consented crop for user works — re-downloaded at polite rates, "days not hours — accepted"); old clients keep matching against the old version until adoption crosses a threshold, then the old vectors are deleted and the minimum supported version is raised. Descriptors are not versioned. `user_scan` vectors regrow.

## Current state

- `vectors` rows are `(objectId, modelVersion, source, vector)` with `by_objectId_modelVersion`; `identify` (04.03) filters by the request's `modelVersion` and gates on `SUPPORTED_MODEL_VERSIONS`.
- `objects.imageRef` is the re-embedding source; user objects' `imageRef` is `storage:<Id<'_storage'>>` (plan 04.08 writes it so); `descriptors.extractedFrom` unchanged.
- `jobs/`: `download.py`, `model.py` (`load_embedder(fakequant_state)`), `embed.py`, `push.py` helpers, checkpoints.

## Scope

**In scope**: `jobs/artlog_jobs/reembed.py` (+ test), `convex/ingest.ts` additions (`listObjectsForReembed({ modelVersion, cursor })` paginated internal query returning objects lacking a vector for that version, with `imageRef`, `source`; `deleteVectorsForVersion({ modelVersion, cursor })` internal mutation deleting ≤ 1,000 per call and returning the next cursor; `markImageRefDead({ objectKey })`), `convex/schema.ts` (`objects.imageRefDead?: boolean`), `docs/runbooks/model-migration.md`.

**Out of scope**: the app-side re-embedding of queued crops after an update (03.06 handles the queue; the phone re-embeds locally), compatibility training (§3 deferred).

## Steps

### Step 1: Planner

`reembed.py --model-version <new> --fakequant <path> --sources corpus,crawl,user`: page `listObjectsForReembed`, group by source; for `user` objects resolve `storage:` refs to URLs through an internal query `storage.urlFor` (add to `ingest.ts`); checkpoint the cursor.

**Verify**: test with a fake client: pagination and grouping.

### Step 2: Download + embed + push

Reuse `download.py` (polite limits per host) and `Embedder` with the **new** fakequant state; push vectors with `upsertVectors` (`source` preserved from the object's source; `modelVersion = new`); dead refs → `markImageRefDead` and skip. `user_scan` vectors are not migrated. Batch/checkpoint as in 02.05.

**Verify**: smoke on 200 objects to the dev deployment adds 200 rows with the new version and leaves old rows intact; the app pinned to the old version still identifies (manual).

### Step 3: Cut-over tooling and runbook

`ingest.deleteVectorsForVersion` + a Python `reembed.py --delete-version <old>` loop. `docs/runbooks/model-migration.md`: (1) export the new CoreML model (03.03) and its fakequant state; (2) run `reembed`; (3) add the new version to `SUPPORTED_MODEL_VERSIONS` **before** the app release; (4) ship the app; (5) watch adoption (App Store Connect); (6) when ≥ 90% (or the operator's threshold), remove the old version from the env var (old clients see "update the app to identify") and run the delete loop; (7) regenerate iPhone reference embeddings for the drift check.

**Verify**: runbook reviewed by the operator; the delete loop tested on the smoke rows.

## Test plan

`reembed_test.py` (planner, dead refs, delete loop cursoring); `convex/ingest.test.ts` additions.

## Done criteria

- [ ] Tests pass; smoke migration + deletion done on dev; runbook exists
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- A user object's crop is missing from storage — mark dead, report count; do not fall back to phone vectors.

## Maintenance notes

- Adoption threshold and timing are operator decisions; never automate the deletion.

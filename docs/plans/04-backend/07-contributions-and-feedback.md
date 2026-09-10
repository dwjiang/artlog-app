# Plan 04.07: Contributions, "Not right?" feedback, resolution, and confirm counting on save

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/contributions.ts convex/feedback.ts convex/collections.ts convex/schema.ts`

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED (shared-state writes; abuse surface)
- **Depends on**: 04.03, 04.04, 04.06 (label evidence), 03.07 (attested writes on the phone — the server side works without it in dev)
- **Category**: feature / security
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.4 step 6 / §4.5 / §4.7: a contribution — the embedding and descriptors as the phone computed them, verified metadata, and a consented ≤ 256 px crop — is written as a private contribution attributed to the device and enters the promotion pipeline. §4.6: every "Not right?" is a labeled hard negative recorded as one `feedback` document; confirm counting rules (untouched title+artist → confirm; edited → neither); per-object `confirmCount`/`rejectCount` and a penalty; guardrails (per-device-per-work caps, unresolved rejections weigh nothing). §8: near-duplicate vectors are rejected as replays.

## Current state

- Schema (01.03): `contributions`, `feedback`, `collections`, `objects.{confirmCount, rejectCount, calibratorPenalty}`; `scans` carries the vector and (for waiting scans) descriptors.
- 04.04: `requireDevice`, `requireAttestedWrite`, `limitDevice('contribute' | 'rejectPerWork' | 'sync')`; storage: `generateUploadUrl` (mutation), `v.id('_storage')`.
- 04.06 writes `scans.labelFlow` with verified fields and evidence; 04.03's `scans.best/runnerUps` carry `probability`; identify's scored candidates include similarity/margin/inliers — persist them: add `scans.candidateSignals?: array({ objectId, similarity, margin, orbInliers, probability, homographyValid })` (schema change in this plan; 04.03's `setResult` must store it — in scope by exception: one field).
- Convex-test supports `vectorSearch` (brute force) so the dedupe check is testable.
- 04.06 shipped without the `false_rejection` hook because `feedback.ts` did not exist yet: after `verifyLabel` writes `labelFlow.stage === 'verified'`, nothing looks for an unresolved `feedback` row on the scan. Wire it in Step 2 next to `markFalseRejection` (compare the verified title + artist with the rejected object's artwork using `convex/lib/textMatch.ts`).

## Scope

**In scope**: `convex/contributions.ts`, `convex/feedback.ts`, `convex/collections.ts` (`saveToCollection`, `listMine`), `convex/schema.ts` (`scans.candidateSignals`, `objects.flaggedForReview: boolean`, `contributions.rejectedReason?`), `convex/identify.ts` (store `candidateSignals`), tests.

**Out of scope**: promotion/agreement (04.08), sync across devices (04.11), UI (05.02/05.03), calibrator retraining (02.09 exports via `feedback.exportForTraining` added here as an internal query).

## Steps

### Step 1: Crop upload and `contribute`

`contributions.ts`:

- `requestCropUpload` (public mutation, `requireDevice`) → `{ uploadUrl }` (`generateUploadUrl`), rate `contribute`.
- `contribute` (public **action**) args `{ scanId, descriptors: bytes, keypoints: bytes, fields: { title: { value, edited }, artist: …, date?, medium?, accession?, creditLine? }, evidence: evidenceKind[], wikidataId?, cropStorageId: id('_storage'), consent: v.literal(true), nonce, assertionBase64 }`:
  1. `internal.contributions.authorize` (mutation): `requireAttestedWrite`, `limitDevice('contribute')`, scan belongs to the device and has `venueId` (must be venue-resolved), `labelFlow.stage === 'verified'` (fields with `edited: false` must equal the verified values; `edited: true` fields get evidence `user_edited`).
  2. Replay/near-duplicate check: `ctx.vectorSearch('vectors', 'by_vector', { vector: scan.vector, limit: 3, filter: modelVersion })` — any `_score ≥ 0.995` → `internal.contributions.reject({ reason: 'duplicate' })` and return `{ status: 'rejected', reason }`; also compare with the device's own contributions at the venue (cosine ≥ 0.995 → duplicate).
  3. Validate the crop's metadata (`ctx.db.system.get('_storage', id)`: `contentType` image/jpeg, `size ≤ 200 KB`) in the mutation; the phone resizes to ≤ 256 px (05.03).
  4. `internal.contributions.insert` → `status: 'private'`, `keypointCount`, `createdAt`, `scanId`, `venueId`, `vector` and `modelVersion` copied from the scan.
  Returns `{ contributionId, status }`.
- `mine` (public query) → the device's contributions with status.

**Verify**: `contributions.test.ts`: attestation required (simulator bypass), rate limit, unverified label rejected, duplicate rejected by vector search, crop size check, happy path `private`.

### Step 2: Rejections

`feedback.ts`:

- `rejectMatch` (public mutation, attested, `limitDevice('rejectPerWork', deviceId, objectId)`) args `{ scanId, objectId }`: the object must be `scans.best` or in `runnerUps`; take signals from `scans.candidateSignals`; insert `feedback { …, venueMismatch: placement venue !== scan venue, resolution: { kind: 'unresolved' } }`; `objects.rejectCount++`; if `rejectCount ≥ 20 && rejectCount / (confirmCount + rejectCount) ≥ 0.3` → `flaggedForReview = true`, `calibratorPenalty = min(0.8, penalty + 0.2)` (never auto-delete).
- `resolveRejection` (public mutation, device must own the feedback) args `{ feedbackId, resolution: { kind: 'runner_up', objectId } | { kind: 'label', contributionId } }` → patch; if the resolved object's current placement venue ≠ scan venue → `internal.placements.proposeFromScan` (04.03/04.10).
- `markFalseRejection` (internal mutation, called by 04.06) → `resolution.kind = 'false_rejection'` and `objects.rejectCount--` (floor 0).
- `exportForTraining` (internal query, paginated) → rows with signals, `venueMismatch`, resolution, `calibratorVersion`.

**Verify**: tests: only best/runner-ups can be rejected; 4th rejection of the same object in a day is rate-limited while another object passes; flag + penalty at the threshold; false rejection decrements.

### Step 3: Save with confirm counting

`collections.ts`: `saveToCollection` (public mutation, `requireDevice`, `limitDevice('sync')`) args `{ localId, scanId?, objectId?, artworkId?, venueId?, visitId?, gallery?, snapshot: snapshotFields, suggested: { title, artist } | null }` → idempotent on `(deviceId, localId)`; insert; when `suggested` and `snapshot.title.trim() === suggested.title.trim() && snapshot.artist.trim() === suggested.artist.trim()` → `objects.confirmCount++` (once per collection row); an edited title or artist increments nothing. `listMine` (public query, paginated). `remove` (soft delete `deletedAt`).

**Verify**: tests: idempotency; confirm increments exactly once; edited → no increment; other device cannot read.

### Step 4: Persist candidate signals in identify

`identify.ts` `setResult` stores `candidateSignals` for `best` + `runnerUps` (similarity, margin, orbInliers, probability, homographyValid).

**Verify**: `identify.test.ts` gains one assertion; `npx vitest run convex/identify` passes.

## Test plan

`contributions.test.ts`, `feedback.test.ts`, `collections.test.ts` (convex-test with `rateLimiter.register(t)`, seeded via `convex/lib/testFactories.ts`).

## Done criteria

- [ ] Tests pass (≥ 18 new); tsc/lint; `npx convex dev --once`
- [ ] Every public mutation/action here that writes shared state calls `requireAttestedWrite` (grep `contribute|rejectMatch` → both do); `saveToCollection` does not (private data)
- [ ] `docs/plans/README.md` updated

## STOP conditions

- `vectorSearch` inside `contribute` exceeds the action budget noticeably (> 300 ms in the bench) — report; a cheaper duplicate check (hash of rounded vector) is an operator decision.

## Maintenance notes

- `candidateSignals` is what the calibrator retrain (02.09/`exportForTraining`) consumes; keep its shape aligned with `FEATURE_NAMES` inputs.
- Thresholds (`0.995`, `20`, `0.3`, `+0.2`) are named constants at the top of each file.

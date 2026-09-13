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

- Schema (01.03): `contributions`, `feedback`, `collections`, `objects.{confirmCount, rejectCount, calibratorPenalty}`; `scans` carries the vector.
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
  1. `internal.contributions.authorize` (mutation): `requireAttestedWrite`, `limitDevice('contribute')`, scan belongs to the device and has `venueId` (must be venue-resolved), `labelFlow.stage === 'verified'` — written by the label flow (04.06) or by museum-site search (04.12), the same shape (fields with `edited: false` must equal the verified values; `edited: true` fields get evidence `user_edited`).
  2. Replay/near-duplicate check: `ctx.vectorSearch('vectors', 'by_vector', { vector: scan.vector, limit: 3, filter: modelVersion })` — any `_score ≥ 0.995` → `internal.contributions.reject({ reason: 'duplicate' })` and return `{ status: 'rejected', reason }`; also compare with the device's own contributions at the venue (cosine ≥ 0.995 → duplicate).
  3. Validate the crop's metadata (`ctx.db.system.get('_storage', id)`: `contentType` image/jpeg, `size ≤ 200 KB`) in the mutation; the phone resizes to ≤ 256 px (05.03).
  4. `internal.contributions.insert` → `status: 'private'`, `keypointCount`, `createdAt`, `scanId`, `venueId`, `vector` and `modelVersion` copied from the scan.
  Returns `{ contributionId, status }`.
- `mine` (public query) → the device's contributions with status.

**Verify**: `contributions.test.ts`: attestation required (simulator bypass), rate limit, unverified label rejected, duplicate rejected by vector search, crop size check, happy path `private`.

### Step 2: Rejections

`feedback.ts`:

- `rejectMatch` (public mutation, attested, `limitDevice('rejectPerWork', deviceId, objectId)`) args `{ scanId, objectId }`: the object must be `scans.best` or in `runnerUps`; take signals from `scans.candidateSignals`; insert `feedback { …, venueMismatch: placement venue !== scan venue, resolution: { kind: 'unresolved' } }`; `objects.rejectCount++`; if `rejectCount ≥ 20 && rejectCount / (confirmCount + rejectCount) ≥ 0.3` → `flaggedForReview = true`, add `0.2` to `objects.rejectionPenalty` and record it in `feedback.penaltyAdded`. Identification combines this with the independent `calibratorPenalty`, capped at `0.8` unless the independent penalty is already higher (never auto-delete).
- `resolveRejection` (public mutation, device must own the feedback) args `{ feedbackId, resolution: { kind: 'runner_up', objectId } | { kind: 'label', contributionId } }` → patch an unresolved row; completed resolutions accept only identical retries. If the resolved object's current placement venue ≠ scan venue → `proposePlacementFromScan` (04.03/04.10).
- `resolveFalseRejections` (inside 04.06's label write) → `resolution.kind = 'false_rejection'`, `objects.rejectCount--` (floor 0), and remove that feedback row's `penaltyAdded` from `objects.rejectionPenalty`.
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
- Thresholds are named constants in `contributions.ts` (`0.995`) and `lib/rejectionPenalty.ts` (`20`, `0.3`, `+0.2`, cap `0.8`).

## Execution record — 2026-09-10

Contracts downstream plans (04.08, 05.02, 05.03, 02.09) rely on:

- Attested payloads live in `shared/attestation/attested-payloads.ts`: `contributionPayload({ scanId, cropStorageId, fields })`
  and `rejectionPayload(scanId, objectId)`; the phone signs the same object through `signPayload` (03.07).
- `contribute({ scanId, descriptors, keypoints, fields, cropStorageId, consent: true, nonce, assertionBase64 })`:
  `evidence` and `wikidataId` are not arguments; both come from the scan's stored `labelFlow`. Every submitted
  `fields.<name>.value` must equal the verified flow's value (`field_mismatch` otherwise), so an edited field is
  sent through `verifyLabel` before contributing; `edited: true` only downgrades that field to `user_edited` and,
  for title or artist, drops the Wikidata binding. Returns `{ contributionId, status, reason?: 'duplicate' }`;
  a first submission is `private` or `rejected`. Retries return the existing contribution for the scan with its
  current status, including `pending` or `promoted`. Crop cleanup deletes only files unreferenced by contributions.
  Own-contribution duplicate checks page through `by_device_venue_model` with a per-query byte budget;
  `devices.lastContributionId` detects concurrent inserts and triggers a fresh check before committing.
  `authorize` verifies the assertion, validates the submission, and commits the rate-limit charge before any
  duplicate search. A later search failure still consumes that authorization; a new public attempt needs a
  fresh assertion. Internal commit retries reuse the authorization. An existing contribution returns before
  searching or charging the contribution budget again.
  Error codes: `invalid_scan`, `scan_restarted`, `label_unverified`, `field_mismatch`, `bad_crop`, `bad_features`,
  `contribution_busy` (retry after repeated concurrent submissions).
- `rejectMatch` returns the existing `feedbackId` for a repeated tap on the same scan and object; the rate limit
  applies to new rows only. `resolveRejection` is device-owned but not attested (05.02 calls it unsigned); a
  `label` resolution must name the device's own contribution for the same scan. Completed resolutions are
  immutable (`invalid_resolution` on a changed answer), with identical retries returning success; a
  `false_rejection` row cannot be re-resolved. False-rejection detection requires normalized title equality; fuzzy title overlap does not discard
  a rejection of a different work.
  Each feedback row records its `penaltyAdded`; false rejections reverse only that addition from the object's
  separate `rejectionPenalty`. Keeping the sum uncapped preserves other votes when reversing feedback at the
  confidence cap. Corpus ingest continues to own `calibratorPenalty`; identification combines both penalties.
- `feedback.exportForTraining({ paginationOpts })` returns full `feedback` documents; `scans.candidateSignals`
  rows are `{ objectId, similarity, margin, orbInliers, probability, homographyValid }` for `best` and every
  runner-up.
- `collections.saveToCollection` confirms only when `objectId` is set, `suggested` is non-null, and both the
  snapshot and the suggestion equal the object's artwork title and artist after trimming. `listMine` is
  paginated (`by_device_savedAt`, newest first, removed rows excluded); `remove({ localId })` is idempotent.
- `evidenceKind` now includes every label evidence kind (`tavily+image`, `weak`, `ocr`) so contribution fields
  keep the evidence they were verified with; `objects.flaggedForReview` is optional (absent means false).

Verification: 68 new tests, 536 backend tests pass (`npm run test:convex -- --maxWorkers=2 --testTimeout=30000`
while the native build was running), `npx tsc --noEmit` and `npm run lint` pass, generated
Convex output is current, and `npx convex dev --once` passes on `usable-owl-256`. Regression coverage includes
retry crop retention, distinct verified titles, concurrent submissions, and 600-row contribution histories with
Convex transaction limits enforced. `npm run ios` builds and opens the app in light mode; end-to-end scanning
remains unverified because the simulator has no camera and the build lacks the CoreML model asset.

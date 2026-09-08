# Plan 04.03: The `identify` action — vector search, ORB verification, calibration, and the live `scans` document

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/ shared/model-version.json`
> Confirm `convex/lib/orb/index.ts`, `convex/lib/calibrator/index.ts`, `convex/lib/auth.ts`, `convex/lib/rateLimits.ts`, `convex/lib/placements.ts` exist (plans 04.01, 04.02, 04.04, 01.03). STOP if any is missing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (the hot path; latency budget ~0.6–1.2 s tap-to-card)
- **Depends on**: 01.03, 04.01, 04.02, 04.04
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

This is the product: one Convex action that takes the phone's vector and ORB features and answers *confident / soft / miss* with the candidates, in about a second, with no cold start (design §4.1, §5.2, §9). Everything on the card comes from it: the match, the runner-ups, the artwork corners, and the `scans` document the app subscribes to for docent text and "Right now" that stream in behind the card.

Design excerpts to implement literally:

- §4.1 step 3: "one Convex vector search over the `vectors` table, filtered only by `modelVersion`, returning the top candidates; their venue, gallery, on-view status, source, rights status and `keypointCount` are loaded as attributes. Those attributes are inputs to the next step, not filters."
- §4.1 step 5: the gallery feature is "the gallery of the visit's last *confident* match within the past fifteen minutes, `unknown` otherwise".
- §5.3 `identify`: "one Convex vector search on `vectors` filtered by `modelVersion` (top ~20); loads the candidates' objects and current placements; ORB matching and RANSAC… the calibrator; returns candidates with probabilities, attributes and the artwork's corners. The embedding stays on the `scans` document. If the venue's `indexStatus` is `building`, marks the scan `waiting` and re-queues it on completion. A *confident* result updates `visits.lastConfidentGallery`. A `modelVersion` below the minimum supported one gets an 'update the app to identify' status instead."
- §4.2 *Moves*: "A verified match at a venue that disagrees with the object's current placement becomes a placement proposal… `multiplicity` decides what is proposed."
- §4.5: never fake confidence; runner-ups shown as "similar works".
- §5.5: thumbnails only for `public_domain` artworks (hotlinked `thumbnailUrl`); otherwise the visitor's own photo (on the phone).

## Current state

- Libraries: `verifyOrb`, `decodeOrbFeatures`, `OrbFormatError` (`convex/lib/orb`); `scoreCandidates`, `decide`, `CALIBRATOR_V1`, `CandidateSignals` (`convex/lib/calibrator`); `currentPlacement` (`convex/lib/placements`); `requireDeviceFromAction`, `limitDevice` (`convex/lib/auth`, `convex/lib/rateLimits`).
- Schema (plan 01.03 + 04.04): `scans` has `localId`, optional `descriptors/keypoints/keypointCount` for waiting scans, `status`, `outcome`, `best`, `runnerUps`, `docent`, `rightNow`; `vectors` has `vectorIndex("by_vector", { vectorField: "vector", dimensions, filterFields: ["modelVersion"] })`; `descriptors` by `by_objectId`; `placements` by `by_objectId`; `placementProposals` by `by_object_venue`; `visits` has `lastConfidentGallery/lastConfidentAt`.
- Verified Convex facts: `ctx.vectorSearch(table, index, { vector, limit ≤ 256, filter: q => q.eq("modelVersion", v) })` is **action-only** and returns `[{ _id, _score }]` (cosine, −1..1); load docs afterwards with `ctx.runQuery`. Default runtime: 64 MiB memory, no `setTimeout`, WebCrypto available. Function args up to 16 MiB. `convex-test` implements `vectorSearch` with brute-force cosine, so the whole action is testable in-memory.
- `shared/model-version.json` gives `modelVersion`, `embeddingDim`, `inputSize`.
- Env (plan 04.04 documented the names): `SUPPORTED_MODEL_VERSIONS` — comma-separated allowlist; default to the JSON's `modelVersion` when unset.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Push | `npx convex dev --once` | success |
| Typecheck / lint | `npx tsc --noEmit` / `npm run lint` | exit 0 |
| Tests | `npm run test:convex` / `npx vitest run convex/identify` | pass |
| Manual call | `npx convex run identify:identify '{...}'` | not usable (needs auth) — use the test harness or the app |

## Scope

**In scope**: `convex/identify.ts` (action + internal helpers), `convex/scans.ts` (queries/mutations on `scans`), `convex/lib/identifyPipeline.ts` (pure orchestration on already-loaded data), `convex/lib/modelVersion.ts`, tests, `convex/lib/testFactories.ts` (seed helpers reused by later plans).

**Out of scope**: docent/"Right now" scheduling (plan 04.09 adds two `ctx.scheduler.runAfter` lines to `identify.ts`), `startVisit` (04.05), feedback (04.07), the phone (03.x), any change to the ORB/calibrator libraries (open a follow-up instead).

## Git workflow

- Current branch; commits `feat(convex): add identify action`, `feat(convex): add scans queries`, `test(convex): cover identify outcomes`.

## Steps

### Step 1: Model-version gate (`convex/lib/modelVersion.ts`)

`supportedModelVersions(): string[]` from `process.env.SUPPORTED_MODEL_VERSIONS` or `[modelVersion.modelVersion]`; `isSupported(v)`; `expectedDim(): number`. Validate vector length equals `embeddingDim` → else `ConvexError({ code: 'bad_vector' })`.

**Verify**: unit tests with `vi.stubEnv`.

### Step 2: `scans` module (`convex/scans.ts`)

- `create` (internal mutation) args `{ deviceId, localId, venueId?, visitId?, gallery?, modelVersion, vector, capturedAt }` → returns existing scan id when `(deviceId, localId)` exists (idempotent; return `{ scanId, existing: true }`), else inserts `status: 'pending'`.
- `setResult` (internal mutation) args `{ scanId, status, outcome?, best?, runnerUps?, calibratorVersion, error?, keepFeatures?: { descriptors, keypoints, keypointCount } }`: patches; when `status === 'waiting'` stores the features; when leaving `waiting`, clears them; when `outcome === 'confident'` and the scan has a `visitId` and `best.gallery` is set, patches `visits.lastConfidentGallery/At`.
- `get` (public query) args `{ scanId }` → the scan for the caller's device (`requireDevice`; other devices' scans → `null`) joined with display data: for `best` and each runner-up: `{ objectId, artworkId, probability, title, artist, date?, medium?, institution?: museum name, thumbnailUrl?: only when artwork.rightsStatus === 'public_domain', rightsStatus, corners? }`. Include `docent`, `rightNow`, `status`, `error`.
- `listWaiting` (internal query) args `{ venueId, cursor? }` paginated over `by_venue_status` (`waiting`).

**Verify**: `npx vitest run convex/scans` → idempotent create; `get` hides other devices' scans; thumbnail omitted for `in_copyright`.

### Step 3: Candidate loading (`convex/identify.ts` internal query `loadCandidates`)

Args `{ vectorIds: id(vectors)[], scores: number[], venueId?, now }`. For each vector row → its object; skip objects with `reverted: true` or `mergedInto` set (follow `mergedInto` once and use the target); group by object keeping the max score and the runner-up score *of a different object*; load artwork (`title, artist, date, rightsStatus, multiplicity, thumbnail via objects.thumbnailUrl`), the object's placements (`by_objectId`) → `currentPlacement(placements, now)`, the descriptors row (`by_objectId`, may be missing → `keypointCount: 0`), and the owner museum name. Return at most 20 objects sorted by score with all attributes and the raw descriptor/keypoint `ArrayBuffer`s. This is one query so the action makes one round trip.

**Verify**: unit test with seeded rows: merged objects collapse; reverted excluded; max 20.

### Step 4: Pure pipeline (`convex/lib/identifyPipeline.ts`)

```ts
export function runPipeline(input: {
  query: OrbFeatures; candidates: LoadedCandidate[]; venueId?: string;
  visit?: { lastConfidentGallery?: string; lastConfidentAt?: number }; now: number; inputSize: number; config?: CalibratorConfig;
}): { decision: Decision<LoadedCandidate>; verifications: Map<objectId, VerifyResult> }
```

- Gallery relation: `visit.lastConfidentAt && now − lastConfidentAt ≤ 15 min` → compare `candidate.placement?.gallery` with `lastConfidentGallery` (`same`/`different`), else `unknown`.
- `atVenue = candidate.placement?.venueId === venueId`; `onView = candidate.placement?.onView ?? null`.
- Run `verifyOrb` for the top 10 by similarity that have descriptors; others get `orbInliers: 0, homographyValid: false`.
- `runnerUpSimilarity`: the next-best different object's similarity (0 when none).
- `objectPenalty = object.calibratorPenalty`; `keypointCount` from descriptors.
- `scoreCandidates` → `decide`.

**Verify**: `npx vitest run convex/lib/identifyPipeline` → fixtures from plan 04.01's synthetic generator: matching descriptors + high similarity + venue → `confident`; same but no homography → `soft`; gallery relation timing (14 vs. 16 minutes); top-10 verification cap.

### Step 5: The action (`convex/identify.ts` `identify`)

Args `{ localId, vector, descriptors: bytes, keypoints: bytes, modelVersion, venueId?, visitId?, capturedAt }`; returns `{ scanId, status, outcome?, best?, runnerUps? }` (same display shape as `scans.get`).

1. `device = requireDeviceFromAction(ctx)`; `limitDevice(ctx, 'identify', device._id)`.
2. `isSupported(modelVersion)` else create the scan with `status: 'unsupported_version'` and return.
3. Validate vector length; `decodeOrbFeatures` (map `OrbFormatError` → `ConvexError({ code: 'bad_features' })`).
4. `scans.create`; if `existing` and status is `identified`, return the stored result (idempotent retry from the phone).
5. `ctx.vectorSearch('vectors', 'by_vector', { vector, limit: 32, filter: q => q.eq('modelVersion', modelVersion) })`.
6. `loadCandidates`; load the visit (internal query) and the museum's `indexStatus` when `venueId` given.
7. `runPipeline`.
8. If outcome is not `confident` and the venue's `indexStatus.status ∈ {queued, building}` → `setResult({ status: 'waiting', keepFeatures })` and return `status: 'waiting'` with the soft candidates (the app shows "Indexing this museum — N of M").
9. Else `setResult({ status: 'identified', outcome, best (with corners from the verification), runnerUps (top 5 others), calibratorVersion })`.
10. If `confident` and `venueId` and `best.placement?.venueId !== venueId` → `internal.placements.proposeFromScan({ objectId, proposedVenueId: venueId, scanId, deviceId, multiplicity })` (define this internal mutation here: upsert by `by_object_venue`, append ids, `kind = multiplicity === 'unique' ? 'move' : 'new_object'`, `readyForReview = distinct deviceIds ≥ 2`; plan 04.10 extends it).
11. Return.

`rerunWaiting` (internal action) args `{ venueId }`: pages `scans.listWaiting`, and for each scan with stored features re-runs steps 5–9 with `force: true` (skips the waiting branch). Scheduled by `museums.setIndexStatus` (plan 04.05) when a crawl completes.

**Verify**: `npx vitest run convex/identify` — seed with `convex/lib/testFactories.ts` (`seedMuseum`, `seedArtworkWithObject({ vector, descriptors, placement })`, `seedDevice`, `asDevice(t)`): confident path returns corners and updates the visit's gallery; unsupported version; bad features; waiting path when `building`; `rerunWaiting` resolves a waiting scan after status flips; idempotent re-call returns the same `scanId`; rate limit trips on the 21st burst call.

### Step 6: Latency probe

Add `convex/identify.bench.test.ts` (vitest, skipped in CI via `it.skip` unless `BENCH=1`) that seeds 2,000 vectors and 20 descriptor rows and times the action end-to-end in convex-test; print the number. The real measurement inside Convex is plan 00.02/00.03's job; this only catches gross regressions.

**Verify**: `BENCH=1 npx vitest run convex/identify.bench` prints a time; `npm run test:convex` passes with it skipped.

## Test plan

Files: `convex/lib/modelVersion.test.ts`, `convex/scans.test.ts`, `convex/lib/identifyPipeline.test.ts`, `convex/identify.test.ts`, `convex/identify.bench.test.ts`. Use `convexTest(schema, modules)` with `rateLimiter.register(t)` and `t.withIdentity({ subject: '<authUserId>|<session>' })` matching the device seeded by `seedDevice`.

## Done criteria

- [ ] `npx convex dev --once` succeeds; `npx tsc --noEmit`, `npm run lint`, `npm run test:convex` exit 0; ≥ 20 new tests
- [ ] `grep -n "vectorSearch" convex/identify.ts` → exactly 2 call sites (identify, rerunWaiting) or 1 shared helper
- [ ] `grep -n "filter(\|\.filter(" convex/identify.ts convex/scans.ts` → no `.filter(` on `ctx.db.query` chains (indexes only)
- [ ] `scans.get` never returns a `thumbnailUrl` for non-public-domain artworks (test exists)
- [ ] No files outside scope modified; README status updated

## STOP conditions

- `ctx.vectorSearch` rejects `limit: 32` or the `modelVersion` filter — report the error.
- `loadCandidates` exceeds the query read limit in tests with 20 candidates × 18 KB descriptors (it should not; limit is 16 MiB) — report.
- The calibrator or ORB API differs from the signatures named above — do not patch those libraries here; report.
- Convex-test's `vectorSearch` mock ignores the filter (it should apply it) — report and keep the filter in code.

## Maintenance notes

- Plan 04.09 adds docent/"Right now" scheduling after step 9; plan 04.07 adds `confirmCount` handling in `saveToCollection`, not here.
- The top-10 verification cap and `limit: 32` are the latency levers; change them with a bench number.
- Reviewers: check `runPipeline` is pure (no ctx), that `waiting` keeps features and resolution clears them, and that other devices can never read a scan.

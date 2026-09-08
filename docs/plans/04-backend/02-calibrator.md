# Plan 04.02: Implement the match calibrator as a versioned pure-TypeScript library under `convex/lib/calibrator/`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/lib/calibrator vitest.config.mts`
> If `convex/lib/calibrator/` already exists, STOP and reconcile.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (pure logic; initial weights are declared placeholders)
- **Depends on**: `docs/plans/01-foundation/01-verification-baseline.md`, `docs/plans/01-foundation/03-convex-project-and-schema.md`
- **Category**: feature (greenfield)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Nearest-neighbor search always returns *something*; deciding whether the best candidate is a real match is its own step. The design replaces per-museum thresholds with one small learned model — logistic regression over a fixed feature vector — that returns a match probability, plus two hard rules (textured works need a homography; low-texture works need a stricter similarity bar and venue agreement). Three outcomes: *confident*, *soft*, *miss*. This library is that model, as versioned JavaScript inside the `identify` action, with hand-set prior weights that the training job (plan 02.09) later replaces.

From `docs/design/art-identifier.md`:

- §4.1 step 5: inputs are "the similarity score, the margin to the runner-up, the candidate-set size, whether the candidate is placed at the user's venue and in the user's current gallery — defined as the gallery of the visit's last *confident* match within the past fifteen minutes, `unknown` otherwise — whether it is on view, the candidate's `keypointCount`, and the ORB inlier count".
- §4.3: "Two thresholds on that probability give *confident*, *soft* and *miss*… The ORB inlier count is an input and, for textured works, a hard requirement: no consistent homography, no *confident* match. Objects whose `keypointCount` is below the low-texture threshold… for them *confident* instead requires a stricter similarity bar, a margin over the runner-up, and a venue that agrees with the current placement." Also: "Per-object overrides remain for hubs… and for works with high rejection ratios" and retrains are "a versioned artifact".
- §4.6: per-object `confirmCount`/`rejectCount` feed "a per-object penalty the calibrator reads".

## Current state

- `convex/lib/` may contain `orb/` (plan 04.01) — independent of this plan.
- No calibrator exists. `convex/schema.ts` (plan 01.03) defines `objects.calibratorPenalty` (number, 0–1) and `descriptors.keypointCount`; this plan consumes those numbers but does not read the database.
- Test tooling: vitest via `npm run test:convex` (plan 01.01).
- Conventions (`AGENTS.md`): camelCase Convex filenames, co-located `*.test.ts`, no speculative abstraction — one model type (logistic regression) now; a GBM is out of scope until the training job proves it is needed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Convex tests | `npm run test:convex` | all pass |
| Single dir | `npx vitest run convex/lib/calibrator` | all pass |
| Push check | `npx convex dev --once` | success |

## Scope

**In scope** (create only):

- `convex/lib/calibrator/features.ts` — input type, `FEATURE_NAMES`, `featurize()`
- `convex/lib/calibrator/weights.ts` — `CALIBRATOR_V1` versioned config (weights, bias, thresholds, rule constants)
- `convex/lib/calibrator/calibrate.ts` — `scoreCandidates()`, `decide()`
- `convex/lib/calibrator/index.ts` — barrel
- `convex/lib/calibrator/*.test.ts`
- `shared/calibrator/README.md` — one page documenting the training-output JSON format the job in plan 02.09 must emit (feature order = `FEATURE_NAMES`)

**Out of scope** (do NOT touch):

- `convex/identify.ts` (plan 04.03 wires this in), `convex/schema.ts`.
- Any training code (plan 02.09) or retraining action `retrainCalibrator` (plan 04.07).
- The ORB library (plan 04.01) — this plan only consumes `inlierCount`/`verified` numbers passed in by the caller.

## Git workflow

- Current workspace branch; do not push unless told.
- Conventional Commits, scope `convex`: `feat(convex): add match calibrator v1`, `test(convex): cover calibrator decisions`.

## Steps

### Step 1: Feature vector (`features.ts`)

```ts
export type GalleryRelation = 'same' | 'different' | 'unknown';

export type CandidateSignals = {
  similarity: number;            // cosine similarity from vector search, 0..1
  runnerUpSimilarity: number;    // similarity of the next-best *different object*, or 0
  candidateCount: number;        // size of the candidate set returned by search
  atVenue: boolean;              // candidate's current placement venue === scan venueId
  gallery: GalleryRelation;      // vs. the visit's last confident gallery (§4.1)
  onView: boolean | null;        // null when unknown
  keypointCount: number;         // stored with the candidate's descriptors
  orbInliers: number;            // from verifyOrb(); 0 when verification was skipped
  homographyValid: boolean;      // verifyOrb().verified
  objectPenalty: number;         // objects.calibratorPenalty, 0..1
};

export const FEATURE_NAMES = [
  'similarity', 'margin', 'logCandidateCount', 'atVenue', 'gallerySame', 'galleryDifferent',
  'onView', 'logKeypointCount', 'logInliers', 'homographyValid', 'objectPenalty',
] as const;

export function featurize(s: CandidateSignals): Float64Array  // length FEATURE_NAMES.length, in that order
```

Definitions: `margin = max(0, similarity − runnerUpSimilarity)`; `logCandidateCount = ln(1 + candidateCount)`; booleans → 0/1; `gallerySame = gallery === 'same'`, `galleryDifferent = gallery === 'different'` (unknown → both 0); `onView` null → 0; `logKeypointCount = ln(1 + keypointCount)`; `logInliers = ln(1 + orbInliers)`. Clamp `similarity` and `objectPenalty` into `[0, 1]`; throw `RangeError` on non-finite inputs.

**Verify**: `npx vitest run convex/lib/calibrator/features` → order test (`featurize` output index i corresponds to `FEATURE_NAMES[i]` — test by setting one signal at a time), clamping, and the `RangeError` case pass.

### Step 2: Versioned weights (`weights.ts`)

```ts
export type CalibratorConfig = {
  version: string;                       // 'lr-v1'
  featureNames: readonly string[];       // must equal FEATURE_NAMES
  weights: readonly number[];            // same length
  bias: number;
  thresholds: { confident: number; soft: number };
  lowTextureKeypoints: number;           // keypointCount below this → low-texture rule
  textured: { minInliers: number };
  lowTexture: { minSimilarity: number; minMargin: number; requireVenueAgreement: boolean };
};

export const CALIBRATOR_V1: CalibratorConfig = {
  version: 'lr-v1',
  featureNames: FEATURE_NAMES,
  weights: [12.0, 20.0, -0.3, 1.2, 0.8, -0.4, 0.3, 0.1, 1.5, 1.5, -3.0],
  bias: -14.0,
  thresholds: { confident: 0.85, soft: 0.45 },
  lowTextureKeypoints: 80,
  textured: { minInliers: 15 },
  lowTexture: { minSimilarity: 0.93, minMargin: 0.04, requireVenueAgreement: true },
};
```

These weights are **priors, not trained values** — say so in a one-line comment. They are chosen so that a strong match (similarity 0.90, margin 0.10, 20 candidates, at venue, same gallery, on view, 300 keypoints, 40 inliers, valid homography, no penalty) scores ≈ 0.999 and a weak one (similarity 0.75, margin 0.02, off venue, unknown gallery, 5 inliers, no homography) scores ≈ 0.10. Plan 02.09 replaces them with trained values as `CALIBRATOR_V2`.

**Verify**: `npx vitest run convex/lib/calibrator/weights` → `featureNames` deep-equals `FEATURE_NAMES` and `weights.length === FEATURE_NAMES.length`; the two anchor examples above land in the stated ranges (`> 0.99` and `< 0.2`).

### Step 3: Scoring and decision (`calibrate.ts`)

```ts
export type ScoredCandidate<T> = {
  candidate: T;
  probability: number;
  features: Float64Array;
  eligibleForConfident: boolean;       // hard rules satisfied
  reasons: string[];                   // e.g. ['textured:no-homography']
};
export type Decision<T> = {
  outcome: 'confident' | 'soft' | 'miss';
  best: ScoredCandidate<T> | null;
  runnerUps: ScoredCandidate<T>[];     // remaining, sorted by probability desc, max 5
  calibratorVersion: string;
};

export function sigmoid(x: number): number
export function scoreCandidates<T>(items: { candidate: T; signals: CandidateSignals }[], config?: CalibratorConfig): ScoredCandidate<T>[]
export function decide<T>(scored: ScoredCandidate<T>[], config?: CalibratorConfig): Decision<T>
```

`scoreCandidates`: `probability = sigmoid(w·featurize(signals) + bias)`; `eligibleForConfident` per §4.3:

- textured (`keypointCount >= lowTextureKeypoints`): `homographyValid && orbInliers >= textured.minInliers`; else push reason `textured:no-homography` or `textured:few-inliers`.
- low-texture: `similarity >= lowTexture.minSimilarity && margin >= lowTexture.minMargin && (!requireVenueAgreement || atVenue)`; reasons `low-texture:similarity`, `low-texture:margin`, `low-texture:venue`.

Sort by probability descending (stable; tie-break by similarity).

`decide`: `best = scored[0] ?? null`. `confident` iff `best.probability >= thresholds.confident && best.eligibleForConfident`. Else `soft` iff `best.probability >= thresholds.soft`. Else `miss` (with `best` still returned so the soft card can show "Maybe one of these?" — the caller decides what to display). `runnerUps = scored.slice(1, 6)`.

**Verify**: `npx vitest run convex/lib/calibrator/calibrate` → the cases in the test plan pass.

### Step 4: Barrel and the training-format note

`index.ts` re-exports everything public. Write `shared/calibrator/README.md` (≤ 40 lines): the training job must emit `{ "version": "lr-vN", "featureNames": [...], "weights": [...], "bias": n, "thresholds": {...}, "lowTextureKeypoints": n, "textured": {...}, "lowTexture": {...} }` with `featureNames` exactly equal to `FEATURE_NAMES`; a human copies it into `weights.ts` as a new `CALIBRATOR_VN` constant and switches the default; the test in Step 2 catches order drift.

**Verify**: `npx tsc --noEmit` → 0; `npm run lint` → 0; `npx convex dev --once` → success.

## Test plan

`convex/lib/calibrator/{features,weights,calibrate}.test.ts` (vitest, no `convexTest`):

- Feature order and clamping (Step 1).
- Prior anchors (Step 2).
- Monotonicity: raising `similarity`, `margin`, or `orbInliers` (others fixed) never lowers probability; raising `objectPenalty` never raises it.
- Hard rules: a textured candidate with `probability > 0.95` but `homographyValid = false` → `soft`, reason `textured:no-homography`; low-texture candidate at 0.96 similarity off-venue → not confident, reason `low-texture:venue`.
- Unknown gallery is neutral: probability equals the value with both gallery features zero.
- Ordering and runner-ups: five candidates → `runnerUps.length === 4`, sorted desc; `decide([])` → `miss` with `best: null`.
- Determinism: same inputs → identical output object (deep equal).

## Done criteria

- [ ] `npx tsc --noEmit` exits 0; `npm run lint` exits 0
- [ ] `npm run test:convex` exits 0 with ≥ 12 tests under `convex/lib/calibrator/`
- [ ] `grep -n "priors, not trained" convex/lib/calibrator/weights.ts` → 1 match
- [ ] `shared/calibrator/README.md` exists and names `FEATURE_NAMES` order
- [ ] `npx convex dev --once` succeeds
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `convex/lib/calibrator/` already exists.
- The anchor examples in Step 2 cannot be made to land in range with the given weights by adjusting only `bias` by ±2 — report the numbers rather than redesigning the feature set.
- Plan 01.03's schema names the penalty or keypoint fields differently (`objects.calibratorPenalty`, `descriptors.keypointCount`) — you do not read them here, but note the mismatch for plan 04.03.

## Maintenance notes

- Changing `FEATURE_NAMES` is a breaking change for stored `feedback` rows (plan 04.07 records the probability and version) and for the training job; add features by appending and bump the version.
- Thresholds are part of the versioned config on purpose: retraining may move them. Never read thresholds from env vars.
- Reviewers should check that `decide` cannot return `confident` without `eligibleForConfident` — it is the one safety property that matters (§4.5: "never fake confidence").
- Deferred: GBM model, per-venue calibration, the evaluation harness (§3 deferred list).

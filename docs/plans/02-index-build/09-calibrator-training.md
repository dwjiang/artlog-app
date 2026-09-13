# Plan 02.09: Train the match calibrator on augmented samples and emit `calibrator-lr-v2.json`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/calibrator convex/lib/calibrator shared/calibrator shared/calibrator/fixtures/calibrator-features.json`

## Status

- **Priority**: P1 (before museum testing; the v1 priors are placeholders)
- **Effort**: L
- **Risk**: MED (feature parity with the TypeScript calibrator is the whole point)
- **Depends on**: 02.05 (index pushed), 04.02 (feature definition), 04.01 (ORB parameters)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.3: the calibrator is "trained initially on augmented corpus samples (crop, glare, perspective, frame, low light) with positives and hard negatives drawn from the index" and later retrained from real feedback. §5.5: training uses only public-domain works (and consented contributions). Until this lands, `identify` runs on hand-set priors (plan 04.02) that were never fitted to anything.

## Current state

- `convex/lib/calibrator/features.ts` defines `FEATURE_NAMES` (11 features, fixed order) and `featurize`; `shared/calibrator/README.md` defines the training-output JSON.
- The index is in Convex; vectors and descriptors can be exported for training via `ingest.exportVectors({ modelVersion, cursor })` and `ingest.exportDescriptors({ cursor })` (add both to `convex/ingest.ts` in this plan — internal queries, 500/page).
- ORB verification parameters in TS (04.01): ratio 0.8, max distance 64, RANSAC threshold 5 px, `minInliers` 15; keypoint cap 500; the Python `cv2` equivalents must use the same numbers.

## Scope

**In scope**: `jobs/artlog_jobs/calibrator/{__init__,augment,sample,features,verify,train,report}.py` (+ tests), `shared/calibrator/fixtures/calibrator-features.json` (parity fixture consumed by `convex/lib/calibrator/features.test.ts` — add that one test), `convex/ingest.ts` (two export queries), `jobs/README.md`.

**Out of scope**: updating `weights.ts` (a human does it with the emitted JSON — note in done criteria), the feedback-based retrain action (04.07), the evaluation harness (§3 deferred).

## Steps

### Step 1: Sample and augment (local run on `settings.device`)

`sample.py`: pick 5,000 `public_domain` objects with vectors and descriptors, stratified by source; download their images to scratch (reuse `download.py`; delete them once the augmented features are written, as in 02.04). `augment.py`: for each image produce 4 variants with seeded randomness: random crop 70–100% + perspective warp ±15°, glare (soft white ellipse, alpha 0.3–0.6), low light (gamma 1.6–2.2 + noise), frame (10–25 px border in wood/black) + slight blur; then `letterbox` → embed (`Embedder`) → `extract_orb`.

**Verify**: `augment_test.py` produces deterministic outputs for a seed; visual spot-check of 20 variants saved under `jobs/out/augment-samples/` (not committed).

### Step 2: Candidates, verification and features

`features.py`: load all index vectors (export queries → numpy; ~300k × 1536 floats fits in 2 GB), for each augmented query take cosine top-32 (numpy matmul on GPU/CPU), run ORB verification (`cv2.BFMatcher(NORM_HAMMING).knnMatch(k=2)` + ratio 0.8 + `cv2.findHomography(RANSAC, 5.0)`; inliers = mask sum; `homographyValid` = inliers ≥ 15 and the quad sanity rule from plan 04.01), and compute the 11 features exactly as `featurize` does. Venue/gallery/onView signals are simulated (documented): for the positive candidate `atVenue = True` with p=0.85, gallery `same` p=0.5 / `unknown` p=0.4 / `different` p=0.1; for negatives `atVenue = True` p=0.1 (same-museum confusions), gallery mostly `unknown`. `objectPenalty` from the pushed penalties. Label: positive iff candidate object == source object or merged into it. Write `shared/calibrator/fixtures/calibrator-features.json` with 10 `{ signals, expectedFeatures }` rows produced by the Python `featurize` so the TS test proves parity.

**Verify**: `features_test.py` on tiny synthetic data; `npx vitest run convex/lib/calibrator/features` passes the parity fixture.

### Step 3: Train and choose thresholds

`train.py`: hold out 20% by source object; `sklearn.linear_model.LogisticRegression(class_weight='balanced', C=1.0, max_iter=1000)` on standardized-then-unstandardized features (fold the scaler into weights so the TS side stays a plain dot product); apply the hard rules from plan 04.02 in evaluation; choose `thresholds.confident` as the lowest probability with precision ≥ 0.99 on held-out (after rules) and `thresholds.soft` where recall of the true object in top-1 ≥ 0.9; keep `lowTextureKeypoints`, `textured.minInliers`, `lowTexture.*` from v1 unless the report shows a better value (sweep 60/80/100 and 10/15/20). Emit `jobs/out/calibrator-lr-v2.json` in the README's format with `version: 'lr-v2'`.

**Verify**: `train_test.py` on synthetic separable data emits a valid JSON with `featureNames == FEATURE_NAMES`; the real run prints held-out precision/recall at both thresholds.

### Step 4: Report

`report.py` writes `jobs/out/calibrator-report.md`: dataset sizes, confusion at each outcome, calibration curve (10 bins), feature weights, threshold rationale, low-texture rule evaluation. Copy the summary numbers into `docs/decisions/009-calibrator-v2.md` (short record).

**Verify**: the record exists; the JSON is attached to the record as a code block.

## Test plan

`augment_test.py`, `features_test.py`, `train_test.py`, parity fixture test in TS.

## Done criteria

- [x] Tests pass in both languages; `ruff` clean
- [x] `calibrator-lr-v2.json` emitted; held-out precision at `confident` ≥ 0.99 recorded
- [x] Operator-authorized adoption copied the exact artifact into `convex/lib/calibrator/weights.ts` as `CALIBRATOR_V2` and switched the default; the feature-order test guards it
- [x] `docs/plans/README.md` status row updated

Execution, 2026-09-12: the real 5,500-object fit passed against the verified
10,000-painting dev index. All 22,000 augmented queries produced 435,600 rows with
zero image skips. On 4,400 held-out queries, confident precision was 99.9313%,
accepted recall 99.8636%, and candidate-level AUC 0.999966. TypeScript reproduced
the Python outcome counts exactly. The artifact, threshold rationale, limitations,
and validation are recorded in [decision 009](../../decisions/009-calibrator-v2.md).
Adoption, 2026-09-13: the operator authorized the separate change. The exact trained
artifact is now `CALIBRATOR_V2`, the default on dev and production. The adopted
default reproduces all held-out outcome counts; 864 backend tests, TypeScript,
and ESLint pass. A new physical-iPhone scan on dev recorded `lr-v2` and confidently
identified Wheat Field with Cypresses.

## STOP conditions

- Positive/negative separation is poor (held-out AUC < 0.9) — report with the report file; do not ship v2.
- Parity fixture fails in TS — the two `featurize` implementations differ; fix the Python side to match TS (TS is the source of truth) and report.

## Maintenance notes

- Retrains from real feedback (04.07 `retrainCalibrator`) reuse `train.py` with feedback rows instead of augmentations; keep the JSON contract stable.

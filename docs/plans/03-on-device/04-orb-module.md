# Plan 03.04: ORB descriptors and capture triage on the phone with `react-native-fast-opencv`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/lib/orb src/lib/capture package.json`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW–MED (00.06 device extraction/packing passed; Python parity still needs verification)
- **Depends on**: 03.01, 04.01 (wire format + encoder), `docs/decisions/006-native-modules.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.1 step 2 / §5.1: "in the same pass the phone extracts ORB keypoints and descriptors from the letterboxed crop (OpenCV, ~300–500 keypoints, ~11–18 KB)"; §4.4 step 1: triage checks blur and highlights on the crop before uploading anything ("Dodge the glare"). Both need pixel access on the phone; OpenCV gives both.

## Current state

- `stages.ts` (03.01) defines `OrbExtractor` and `Triage`; stubs in `default-stages.ts`.
- Wire format and encoder: `convex/lib/orb/features.ts` exports `encodeOrbFeatures({ count, descriptors: Uint8Array, keypoints: Float32Array })` (plan 04.01); the app may import it (`@convex/lib/orb` alias or relative path) — it is pure TS. Cross-language fixture `shared/orb/fixtures/orb-features-v1.json` (02.01).
- Verified `react-native-fast-opencv` 1.0.1 facts: New Architecture only; `Mat.createFromBase64(b64)`, `Mat.createFromBuffer('uint8', h, w, channels, buffer)`; `OpenCV.cvtColor(src, dst, ColorConversionCodes.COLOR_BGR2GRAY)`; `OpenCV.ORB_create(nfeatures)`; `OpenCV.detectAndCompute(detector, image, mask?) → { keypoints: KeyPointVector, descriptors: Mat }`; `keypointVector.toArray()` → array of `{ x, y, size, angle, response, octave }`; `mat.toBuffer('uint8') → { rows, cols, channels, buffer: Uint8Array }`; also `Laplacian`, `meanStdDev`, `threshold`, `countNonZero`, `resize`. Install `npx expo install react-native-fast-opencv`; no config plugin; dev build required. Spike 00.06 measured 2.0 ms reported median extraction at both 300 and 500 caps on iPhone 16 Pro, with 300/498 actual points and correct descriptor/keypoint byte counts. Retain cap 500; verify a common fixture against Python. Read metadata before releasing native objects (the initial spike probe failed by reading a released Mat).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `npx expo install react-native-fast-opencv` | exit 0 |
| Rebuild | `npx expo prebuild --platform ios --clean && npx expo run:ios --device` | app runs |
| Tests | `npm run test:app` | pass |

## Scope

**In scope**: `package.json`, `src/lib/orb/{extract,pack}.ts` (+ tests), `src/lib/capture/triage.ts` (+ test for thresholds logic), `src/lib/capture/default-stages.ts` (real `orb` and `triage`), `src/lib/image/read-crop.ts` (JPEG → base64/`Mat` helper), `tsconfig.json` (`@convex/*` path alias if not present).

**Out of scope**: the Convex matcher (04.01), rectangle warp (03.02), any change to the wire format.

## Steps

### Step 1: Load a crop into a Mat

`read-crop.ts`: `loadGray(cropUri): Promise<{ mat: Mat; width; height }>` — read the file as base64 (`new File(cropUri).base64()` from `expo-file-system`), `Mat.createFromBase64`, convert to gray; release intermediates.

**Verify**: device log shows `512×512` for a pipeline crop.

### Step 2: ORB extraction in the wire format

`extract.ts`: `extractOrb(cropUri, maxKeypoints = modelVersion.orbMaxKeypoints)`: gray Mat → `ORB_create(maxKeypoints)` → `detectAndCompute` → descriptors `toBuffer('uint8').buffer` (length `count*32`; assert) → keypoints via `toArray()` → `pack.ts`'s `packKeypoints(kps) → Float32Array` (`[x, y, size, angle]` per keypoint, same order) → `encodeOrbFeatures({ count, descriptors, keypoints })` → `{ descriptors: ArrayBuffer, keypoints: ArrayBuffer, count }`. Release Mats.

**Verify**: `pack.test.ts` (jest): packing order and byte length; `extract.test.ts` with a mocked OpenCV module asserts the assert-on-length; on device, extracting from `jobs/fixtures/test-painting.jpg` (letterboxed) logs `count` and the first 32 descriptor bytes — compare by hand with `shared/orb/fixtures/orb-features-v1.json` (expect the same count ± 5% and ≥ 80% identical descriptor rows; record the numbers in the PR).

### Step 3: Triage

`triage.ts`: on the gray Mat downscaled to 256×256: blur score = variance of `Laplacian` (`meanStdDev` → σ²); glare = fraction of pixels ≥ 250 (`threshold` + `countNonZero`). `check()` returns `{ ok: false, reason: 'blur', message: 'Hold steady and try again' }` when variance < `BLUR_THRESHOLD` (start at 60; tune on device), `{ ok: false, reason: 'glare', message: 'Dodge the glare' }` when glare > 4%; else ok. Thresholds are exported constants; the decision function `decide({ blurVariance, glareFraction })` is pure and tested.

**Verify**: `triage.test.ts` covers both failures and success; on device, a deliberately blurred shot returns `blur`, a flash-lit glossy print returns `glare`.

### Step 4: Wire stages and measure

`default-stages.ts`: `orb = { extract: extractOrb }`, `triage = { check }`. Log stage timings from the pipeline on device: ORB ≤ 80 ms at 500 keypoints on the oldest test device (00.06 measured 2.0 ms reported median on iPhone 16 Pro; verify the integrated pipeline and any older test device).

**Verify**: a full capture on device now reaches `identify` (03.03 present) and returns a result for a painting present in the index.

## Test plan

`pack.test.ts`, `extract.test.ts`, `triage.test.ts` (jest); device checks recorded in the PR.

## Done criteria

- [ ] Device: full pipeline sends ~20–30 KB and gets a result; timings logged
- [ ] Descriptor agreement with the Python fixture recorded (≥ 80% identical rows)
- [ ] Tests, tsc, lint pass; `docs/plans/README.md` updated

## STOP conditions

- `react-native-fast-opencv` fails to build on RN 0.86 after one clean rebuild — report; the fallback (a local Expo module wrapping the `OpenCV` pod exposing `extractOrb` and `triage`) is a scope change for the operator.
- Descriptor agreement < 50% — the JPEG decode differs from Python's; report and compare gray images pixel-wise before changing anything.

## Maintenance notes

- Keep `packKeypoints` and the Python `orb.py` byte-for-byte aligned; the fixture test is the tripwire.
- Triage thresholds are product tuning; record device results when changing them.

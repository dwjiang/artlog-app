# Plan 03.02: Live rectangle detection that gates the shutter, and the perspective warp + letterbox

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- modules/vision-rect src/lib/capture src/components/scan`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (native; Nitro plugin API; parity with the Python letterbox)
- **Depends on**: 03.01, `docs/decisions/006-native-modules.md` (detector parameters, Nitro plugin recipe)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.1 step 1: rectangle detection runs live on preview frames; the shutter is enabled only once a stable quadrilateral is found; the viewfinder says what to change; on capture the phone prefers the inner rectangle when it covers ≥ 40% of the outer, perspective-warps the quad, resizes the long side to the fixed input size and letterboxes to a square with the image-mean color — "the same function, down to the resize filter, that the index build uses". §11: the user never draws the crop by hand.

## Current state

- `src/lib/capture/stages.ts` (03.01) defines `Warper` and `Quad`; `default-stages.ts` has a throwing `warper` stub; `scan-screen.tsx` accepts `shutterEnabled` and passes `currentQuad`.
- Python reference (plan 02.01 `letterbox.py`): RGB; resize so the long side equals `size` with **bilinear** sampling; paste centered on a `size×size` canvas filled with the resized image's per-channel mean; output written as JPEG q95 on the phone (PNG in Python — parity is measured, not assumed).
- Verified native facts: VisionCamera 5 native frame-processor plugins are Nitro HybridObjects (`nitrogen` codegen, `nitro.json`, spec `X.nitro.ts` with `call(frame: Frame)`, Swift `class HybridX: HybridXSpec` reading `frame.sampleBuffer`), called from `useFrameOutput`'s worklet via `NitroModules.createHybridObject`. Apple Vision: `VNDetectRectanglesRequest` (`minimumConfidence`, `minimumAspectRatio`, `maximumAspectRatio`, `minimumSize`, `maximumObservations`, `quadratureTolerance`), results `VNRectangleObservation` with normalized `topLeft/topRight/bottomRight/bottomLeft`; `CIPerspectiveCorrection` (`inputTopLeft`… in image coordinates) on `CIImage`. Spike 00.06 recorded the parameters that worked and the achieved fps.
- Expo local modules use the `ModuleDefinition` DSL (`npx create-expo-module@latest <name> --local --platform apple`); a Nitro module for the frame plugin plus an Expo module for the still-image warp is acceptable, or one Nitro module for both — follow the 00.06 record.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Scaffold (Nitro) | `npm i -D nitrogen && npx nitrogen` (inside `modules/vision-rect/`) | generated specs |
| Rebuild | `npx expo prebuild --platform ios --clean && npx expo run:ios --device` | app runs |
| Tests | `npm run test:app` | pass |

## Scope

**In scope**: `modules/vision-rect/**` (native module; `nitro.json`, `src/*.nitro.ts`, `ios/*.swift`, podspec), `src/lib/capture/rectangle.ts` (+ test), `src/lib/capture/default-stages.ts` (real `warper`), `src/components/scan/scan-screen.tsx` (frame output + shutter gating + guidance text), `src/components/scan/viewfinder-overlay.tsx` (quad outline + guidance label), `shared/fixtures/letterbox/` (one test image + the Python letterboxed PNG for the parity check), `jobs/scripts/letterbox-parity.py` (compares a phone-produced letterbox to Python).

**Out of scope**: embedding/ORB stages (03.03/03.04), any change to `jobs/artlog_jobs/letterbox.py` (if parity fails, STOP).

## Steps

### Step 1: Native detection on frames

`modules/vision-rect/`: hybrid object `VisionRect` with `detect(frame: Frame): RectObservation[]` (worklet-callable; returns ≤ 3 observations `{ confidence, corners: [[x,y]×4] normalized, isInner?: boolean }`) running `VNDetectRectanglesRequest` on `frame.sampleBuffer` with the 00.06 parameters (defaults if the record has none: `minimumConfidence 0.6`, `minimumAspectRatio 0.3`, `maximumAspectRatio 1.0`, `minimumSize 0.2`, `maximumObservations 3`, `quadratureTolerance 20`), orientation-corrected to the preview's display orientation; throttled natively to every 3rd frame.

**Verify**: on device, logging from the worklet shows observations while pointing at a framed picture; fps ≥ 10.

### Step 2: Stability tracker and guidance (pure TS)

`rectangle.ts`: `RectTracker` with `push(observations, frameSize, now)` → `{ quad: Quad | null; stable: boolean; guidance: 'move-closer' | 'fit-whole-painting' | 'straighten' | 'hold-still' | 'searching' }`: choose the largest observation; stable when the max corner displacement over the last 400 ms is < 2% of the frame diagonal; guidance: area < 25% of frame → `move-closer`; any corner within 2% of the frame edge → `fit-whole-painting`; opposite-edge length ratio > 1.3 → `straighten`; unstable → `hold-still`; none → `searching`. Message strings live in `viewfinder-overlay.tsx` ("Move closer", "Get the whole painting in frame", "Straighten up", "Hold still", "Point at a painting").

**Verify**: `rectangle.test.ts` covers each guidance branch and the stability window.

### Step 3: Capture-time inner/outer choice and warp + letterbox

`VisionRect.warpAndLetterbox(photoPath: string, quad: Quad | null, size: number): Promise<{ cropPath: string; usedQuad: Quad; meanColor: [r,g,b] }>` (async, background queue): load the still; if `quad` is null or the still-resolution detection finds a better pair, run detection on the still; prefer the inner rectangle when its area ≥ 40% of the outer's; `CIPerspectiveCorrection` with corners scaled to pixel coordinates; render to `CGImage`; resize so the long side = `size` using a `CGContext` draw with `interpolationQuality = .medium` (bilinear-class); compute per-channel mean of the resized pixels; draw centered onto a `size×size` context filled with that mean; write JPEG q95 to `Paths.cache/crops/<uuid>.jpg`; return. `default-stages.ts`: `warper = { warpAndLetterbox: (uri, quad, size) => VisionRect.warpAndLetterbox(uri, quad, size).then(r => ({ cropUri: r.cropPath })) }`.

**Verify**: on device, a captured framed painting yields a square crop with the canvas filling the square (inner preference visible); `jobs/scripts/letterbox-parity.py --phone <crop.png> --source <image> --size 512` (export a PNG from the device via the share sheet for this check) reports mean absolute pixel difference ≤ 2/255 and identical pad color ± 1.

### Step 4: Gate the shutter

`scan-screen.tsx`: `useFrameOutput` calls `VisionRect.detect(frame)` and posts observations to JS (`useRunOnJS`) into `RectTracker`; `shutterEnabled = stable`; `viewfinder-overlay.tsx` draws the quad (Reanimated shared values for smoothness) and the guidance label; haptic `impactAsync(Light)` when the state flips to stable.

**Verify**: on device, the shutter greys out until the quad is stable; guidance text changes as you move; capture produces the crop and the pipeline proceeds to the next stub.

## Test plan

`rectangle.test.ts` (jest, ≥ 8 cases); native parts verified on device; parity script run once and its output pasted into the PR.

## Done criteria

- [ ] Device: live quad, guidance, gated shutter, warped letterboxed crop
- [ ] Letterbox parity ≤ 2/255 mean abs diff against Python on the fixture
- [ ] `npm run test:app`, `npx tsc --noEmit`, `npm run lint` pass
- [ ] `docs/plans/README.md` updated

## STOP conditions

- Parity > 2/255 after trying `.medium` and `.low` interpolation — report the numbers; changing the Python side is a cross-plan decision.
- Detection fps < 8 on the oldest test device even at every 3rd frame — report; the fallback is detection on the still only.

## Maintenance notes

- The 40% inner-rectangle rule and tracker thresholds are product tuning; keep them as named constants at the top of `rectangle.ts` / the Swift file.

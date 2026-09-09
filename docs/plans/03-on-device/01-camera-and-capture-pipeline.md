# Plan 03.01: Camera (VisionCamera 5), library import, and the capture pipeline orchestrator

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- src/lib/capture src/components/scan app.json package.json`
> Read `docs/decisions/006-native-modules.md` first: it fixes the package versions and whether VisionCamera 5 is a go.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (00.06 device camera/QR gates passed; barcode arm64 simulator support remains open)
- **Depends on**: 01.04 (dev client), 04.03 (identify action), `docs/decisions/006-native-modules.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §3: "Scan with the live camera or import from the photo library"; §4.1 step 1–2 and §5.1 "Scan": on capture the phone warps, resizes and letterboxes the crop, runs triage, embeds, extracts ORB, and sends ~20 KB to `identify` — or queues it offline. This plan puts the camera on screen and builds the orchestrator that chains those stages, with the native stages (rectangle warp 03.02, CoreML 03.03, ORB 03.04) plugged in by their own plans. Library imports carry EXIF location and time (§4.4).

## Current state

- [Decision 006](../../decisions/006-native-modules.md) pins the tested packages. Its combined iPhone build delivers 1280×720 frames at 30 fps, decodes QR on device and captures a 4224×2376 JPEG. Barcode scanner 5.2.3’s ML Kit dependency excludes arm64 simulator builds, so select and verify a QR path before relying on simulator validation.

- `src/components/scan/scan-screen.tsx` is a placeholder (plan 01.02); `src/app/(tabs)/(scan)/index.tsx` renders it headerless.
- Dev client and `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription` exist (01.04).
- Convex: `api.identify.identify` action (04.03) with args `{ localId, vector, descriptors, keypoints, modelVersion, venueId?, visitId?, capturedAt }`; `useAction` from `convex/react`; actions fail if the connection drops mid-flight (the offline queue in 03.06 is the retry path).
- Verified VisionCamera 5 facts (2026-09-08; confirm versions in the 00.06 record): packages `react-native-vision-camera@5`, `react-native-nitro-modules`, `react-native-nitro-image`, `react-native-vision-camera-worklets` (uses `react-native-worklets`, already installed), `react-native-vision-camera-barcode-scanner`; `<Camera device="back" isActive outputs={[...]} />`; `useFrameOutput({ onFrame(frame) { 'worklet'; …; frame.dispose() } })`; `useBarcodeScannerOutput({ barcodeFormats: ['qr-code'], onBarcodeScanned })`; photo capture through the photo output API documented at `https://visioncamera.margelo.com/docs/guides/taking-photos` (names in the 00.06 record); no config plugin. `expo-image-picker` ~57: `launchImageLibraryAsync({ mediaTypes: ['images'], exif: true, quality: 1 })` → `assets[0].{ uri, width, height, exif }`; plugin option `photosPermission`. `expo-haptics`, `expo-crypto` (`randomUUID()`).
- HIG rules (repo skill `expo-native-ui`): hide headers for a full-screen camera; request camera permission eagerly, photo-library permission lazily.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `npx expo install react-native-vision-camera react-native-nitro-modules react-native-nitro-image react-native-vision-camera-worklets react-native-vision-camera-barcode-scanner expo-image-picker expo-haptics expo-crypto` | exit 0 |
| Rebuild dev client | `npx expo prebuild --platform ios --clean && npx expo run:ios --device` | app on a device (camera needs hardware) |
| Typecheck / lint / tests | `npx tsc --noEmit` / `npm run lint` / `npm run test:app` | exit 0 |

## Scope

**In scope**: `package.json`, `app.json` (`plugins` += `["expo-image-picker", { "photosPermission": "…" }]`), `src/lib/capture/{pipeline,stages,exif,ids}.ts` (+ tests), `src/lib/capture/use-qr-scanner.ts`, `src/components/scan/scan-screen.tsx` (camera + shutter + import button; guidance overlay comes in 05.01), `src/components/scan/camera-permission.tsx`.

**Out of scope**: rectangle detection/warp (03.02), embedding (03.03), ORB/triage (03.04), venue (03.05), offline queue persistence (03.06 — this plan calls an interface), result UI (05.02), label capture UI (05.03).

## Steps

### Step 1: Packages and a camera that shows a preview

Install; rebuild the dev client on a physical device. `camera-permission.tsx`: requests camera permission on mount (`Camera.requestCameraPermission()` / the V5 permission hook) and renders a short explanation + "Open Settings" when denied. `scan-screen.tsx`: full-bleed `<Camera device="back" isActive={isFocused} outputs={outputs} />` (pause when the tab is not focused), a shutter button (64 pt, bottom center, `Haptics.selectionAsync()` on press), an "Import" button (`photo` SF symbol) bottom-left. Shutter is disabled until plan 03.02 reports a stable quad (until then: always enabled, gated by a `shutterEnabled` prop defaulting to `true`).

**Verify**: on device, the preview renders at full screen; the shutter takes a photo and logs its path; import opens the library.

### Step 2: Pipeline interfaces (`stages.ts`) and orchestrator (`pipeline.ts`)

```ts
export type Quad = [[number, number], [number, number], [number, number], [number, number]];
export interface Warper { warpAndLetterbox(photoUri: string, quad: Quad | null, size: number): Promise<{ cropUri: string }> }
export interface Triage { check(cropUri: string): Promise<{ ok: true } | { ok: false; reason: 'blur' | 'glare'; message: string }> }
export interface Embedder { embed(cropUri: string): Promise<Float32Array>; modelVersion: string }
export interface OrbExtractor { extract(cropUri: string): Promise<{ descriptors: ArrayBuffer; keypoints: ArrayBuffer; count: number }> }
export type CaptureInput = { photoUri: string; quad: Quad | null; source: 'camera' | 'library'; capturedAt: number; venueId?: string; visitId?: string };
export type CapturePayload = { localId: string; vector: number[]; descriptors: ArrayBuffer; keypoints: ArrayBuffer; modelVersion: string; venueId?: string; visitId?: string; capturedAt: number; cropUri: string };
export type CaptureResult =
  | { kind: 'retake'; reason: 'blur' | 'glare'; message: string }
  | { kind: 'sent'; scanId: string; response: IdentifyResponse }
  | { kind: 'queued'; localId: string };
```

`runCapture(input, deps: { warper, triage, embedder, orb, identify: (p) => Promise<IdentifyResponse>, isOnline: () => boolean, enqueue: (p) => Promise<void> }, opts: { inputSize, modelVersion })`: warp → triage (return `retake` on failure) → embed (round floats to 5 decimals when serializing) → ORB → payload with `localId = randomUUID()` → if online, call `identify` and on a network error `enqueue` and return `queued`; if offline, `enqueue`. Never throws for expected failures; logs stage timings (`performance.now()`) and returns them in `CaptureResult` for the dev overlay.

Default `deps` for the app live in `src/lib/capture/default-stages.ts` and start as **throwing stubs** with the message "implemented by plan 03.0N" — replaced by 03.02–03.04.

**Verify**: `src/lib/capture/pipeline.test.ts` (jest) with fake stages: happy path sends; triage failure returns `retake` without embedding; offline → `queued`; network error after embedding → `queued` with the same `localId`; timings present.

### Step 3: Library import with EXIF

`exif.ts`: `extractCaptureMeta(exif: Record<string, unknown> | null | undefined) → { lat?: number; lng?: number; capturedAt?: number }` handling both flat iOS keys (`GPSLatitude`, `GPSLatitudeRef`, `GPSLongitude`, `GPSLongitudeRef`, `DateTimeOriginal` "YYYY:MM:DD HH:MM:SS") and nested `{GPS}`/`{Exif}` dictionaries; `capturedAt` defaults to `Date.now()` when missing. The Import button: `launchImageLibraryAsync({ mediaTypes: ['images'], exif: true, quality: 1 })` → `runCapture({ photoUri, quad: null, source: 'library', capturedAt, … })` after plan 03.05's `resolveVenueAt(lat, lng)` (until then, `venueId` undefined).

**Verify**: `exif.test.ts` covers both shapes, hemisphere signs, and missing data.

### Step 4: QR scanner hook

`use-qr-scanner.ts`: `useQrScanner(enabled: boolean, onCode: (url: string) => void)` returning a camera output from `useBarcodeScannerOutput({ barcodeFormats: ['qr-code'], onBarcodeScanned })` when enabled, debounced to one callback per distinct value per 3 s, only accepting `http(s)` URLs. Not mounted on the scan screen yet (05.03 mounts it on the label screen).

**Verify**: `npx tsc --noEmit` → 0; the hook's debounce logic is extracted into a pure function with a test.

### Step 5: Wire the shutter

On shutter: take the photo (V5 photo output), `runCapture({ photoUri, quad: currentQuad ?? null, source: 'camera', capturedAt: Date.now(), venueId, visitId })` with `identify` = `useAction(api.identify.identify)`, `isOnline` from `expo-network`'s `useNetworkState().isInternetReachable`, `enqueue` = the 03.06 queue (stub: logs and resolves). On `sent` → `router.push('/result/<scanId>')`; on `queued` → `router.push('/result/local-<localId>')` (05.05 renders the waiting state); on `retake` → show the message inline with a "Retake" affordance (haptic warning).

**Verify**: on device with stub stages the screen shows the stub error message (expected until 03.02–03.04); with the tests green and `npx tsc --noEmit` at 0.

## Test plan

`pipeline.test.ts`, `exif.test.ts`, `use-qr-scanner.test.ts` (pure debounce), all jest; camera itself is verified manually on a device.

## Done criteria

- [ ] Dev client rebuilds and the camera preview + shutter + import work on a physical device
- [ ] `npm run test:app` passes with ≥ 8 new tests; `npx tsc --noEmit`, `npm run lint` exit 0
- [ ] `grep -n "implemented by plan 03.0" src/lib/capture/default-stages.ts` → 3 stubs (warper/triage+orb/embedder)
- [ ] No files outside scope modified; `docs/plans/README.md` updated

## STOP conditions

- The 00.06 record says VisionCamera 5 is a no-go — use its fallback (`expo-camera` + still-image detection) and report that this plan's Steps 1 and 4 changed.
- The dev client fails to build after adding the Nitro packages, after one clean rebuild — report the error.

## Maintenance notes

- Stage interfaces are the contract for 03.02–03.04; keep them in `stages.ts` only.
- Vector serialization (5 decimals) affects payload size (~12 KB for 1536 floats); revisit if the upload budget matters on cellular.

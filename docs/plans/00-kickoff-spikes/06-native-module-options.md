# Spike 00.06: Prove the native stack on RN 0.86 — VisionCamera 5, rectangle detection, OpenCV ORB, App Attest, MapKit search, CoreML bundling

> **Executor instructions**: Time-boxed investigation (2 days) on a throwaway
> git worktree branch of this repo (not on the main workspace branch). The
> deliverable is a decision record; code written here is disposable and is
> re-done properly by the `03-on-device/*` plans. Update the status row in
> `docs/plans/README.md` when done.
>
> **Drift check**: `ls docs/decisions/006-native-modules.md` must not exist.

## Status

- **Priority**: P0 (gates every `03-on-device/*` plan)
- **Effort**: M–L (2 days; needs a physical iPhone)
- **Risk**: MED (three third-party native packages are untested on RN 0.86)
- **Depends on**: `docs/plans/01-foundation/04-dev-client-and-eas.md` (a dev build works)
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §6 and §11 ("Native plumbing eats the schedule") name three native pieces — live rectangle detection with a perspective warp, a CoreML runner, and OpenCV for ORB — plus App Attest and MapKit local search, "all in the dev client". Research on 2026-09-08 changed the picture in ways the design has not absorbed:

- **VisionCamera is now V5** (5.2.3): Nitro-based, peers `react-native-nitro-modules` + `react-native-nitro-image`; `useFrameProcessor` is gone → `useFrameOutput({ onFrame(frame) { 'worklet'; …; frame.dispose() } })` with `<Camera device="back" isActive outputs={[frameOutput]} />`; frame processors need `react-native-vision-camera-worklets`, which runs on **`react-native-worklets`** (the package this repo already has at 0.10.1; VC5 was developed against 0.9.1). QR scanning moved to `react-native-vision-camera-barcode-scanner` (`useBarcodeScannerOutput({ barcodeFormats: ['qr-code'], onBarcodeScanned })`). No Expo config plugin; `NSCameraUsageDescription` goes in `ios.infoPlist` (plan 01.04 did this). **RN 0.86 compatibility is unstated** (built against 0.85.3).
- **Native frame-processor plugins in V5 are Nitro HybridObjects** (`nitrogen` codegen; Swift `class HybridRectangleDetector: HybridRectangleDetectorSpec { func call(frame: any HybridFrameSpec) }` reading `frame.sampleBuffer`). No existing package exposes `VNDetectRectanglesRequest`.
- **`react-native-fast-opencv` 1.0.1** (July 2026): New Architecture only, "tested only on RN 0.85 and later"; exposes `ORB_create`, `detectAndCompute → { keypoints: KeyPointVector, descriptors: Mat }`, `BFMatcher_create`, `knnMatchBF`, `findHomographyFromMatches`, `Mat.createFromBase64`, `Mat.createFromBuffer`, `mat.toBuffer('uint8')`; no Nitro dependency; its worklets docs still reference `react-native-worklets-core`.
- **App Attest: Expo ships `@expo/app-integrity` ~57.0.1** (`isSupported`, `generateKeyAsync()`, `attestKeyAsync(keyId, challenge)`, `generateAssertionAsync(keyId, challenge)`, base64 results, SHA-256 of the challenge string computed natively); needs the `com.apple.developer.devicecheck.appattest-environment` entitlement (plan 01.04 set it); not supported on the Simulator.
- **Expo Modules API**: the `ModuleDefinition` DSL is the documented default at SDK 57; macros (`@ExpoModule`, `@JS`) ship in `expo-modules-core` 57 but are undocumented. Scaffold: `npx create-expo-module@latest <name> --local --platform apple`.
- **CoreML bundling**: CocoaPods `resources` are not compiled by Xcode → precompile with `xcrun coremlcompiler compile Model.mlpackage <out-dir>` and ship the `.mlmodelc` directory via the local module's podspec `s.resources`; load with `Bundle(for: Module.self).url(forResource:withExtension:"mlmodelc")` and `MLModelConfiguration().computeUnits = .all`.
- **MapKit**: no RN package exposes `MKLocalSearch`; a local module with `MKLocalPointsOfInterestRequest(center:radius:)` + `pointOfInterestFilter` + `MKLocalSearch(request:).start()` is needed (verify the minimum iOS version; a fetched page said iOS 16).
- `expo-image-manipulator` cannot pad (its `extent()` is web-only) → letterboxing must happen in Swift.

## Questions to answer

1. Does a dev build with `react-native-vision-camera@5`, `react-native-nitro-modules`, `react-native-nitro-image`, `react-native-vision-camera-worklets`, `react-native-vision-camera-barcode-scanner` compile and run on RN 0.86.3 / Expo 57 with `react-native-worklets` 0.10.1? Does `useFrameOutput` deliver frames at ≥ 20 fps at 1280×720 with an empty worklet? Does QR scanning work?
2. Can a local Nitro hybrid object run `VNDetectRectanglesRequest` on `frame.sampleBuffer` at ≥ 10 fps with `minimumConfidence 0.6`, `minimumAspectRatio 0.3`, `maximumObservations 3`, and return the quad to the worklet? Battery/thermal after 5 minutes? Inner-vs-outer rectangle behavior on three framed paintings (photos on a screen are fine for the spike)? Can the same Swift code do `CIPerspectiveCorrection` + resize + letterbox on a captured still in < 100 ms?
3. Does `react-native-fast-opencv` 1.0.1 build on RN 0.86? ORB `detectAndCompute` time on a 512×512 letterboxed crop at 300 and 500 keypoints on the oldest available iPhone; can descriptors and keypoints be pulled out as bytes/floats (`toBuffer`, `toJSValue`) in the wire format of plan 04.01?
4. `@expo/app-integrity` on a device: `isSupported`, key generation, `attestKeyAsync` returns a base64 CBOR object; decode it on a laptop and confirm `fmt: "apple-appattest"`, the RP ID hash equals SHA-256 of `TEAMID.app.artlog.ios`, and the environment (development vs production) for a dev build.
5. A minimal local Expo module (DSL) exposing `searchPointsOfInterest(lat, lng, radiusMeters)` via `MKLocalPointsOfInterestRequest` filtered to `.museum`; does it return names + websites (`MKMapItem.url`)? Minimum iOS.
6. A `.mlmodelc` shipped through a local module podspec survives the build and loads on device (use any small public `.mlpackage`, e.g. a MobileNet from Apple's model gallery, for this test).
7. Convex Auth Sign in with Apple via a custom `ConvexCredentials` provider verifying `expo-apple-authentication`'s `identityToken` with `jose` against `https://appleid.apple.com/auth/keys` — confirm `jose` runs in Convex's default runtime and the token's `aud` is the app bundle id (feeds plan 04.11).

## Method

`git worktree add ../artlog-spike-native -b spike/native-modules` from the repo; do everything there; copy only the decision record and any small snippet worth keeping into `spikes/native-modules/notes/` on the main branch. Install packages with `npx expo install`; `npx expo prebuild --clean && npx expo run:ios --device`. Time with `performance.now()` around calls; fps via a counter in the worklet reported once per second with `useRunOnJS`. Delete the worktree at the end.

## Deliverable

`docs/decisions/006-native-modules.md`: go/no-go per package with versions, measured fps/latency tables, the rectangle-detector parameters that worked, the ORB cap recommendation (300 vs 500), the App Attest findings, MapKit minimum iOS, CoreML bundling confirmation, the Apple-sign-in feasibility, and **fallbacks** for each no-go: `expo-camera` (QR via `onBarcodeScanned`, no live rectangles → detect on the captured still with Vision) if VC5 fails; a custom Expo module wrapping the `OpenCV` pod for ORB if fast-opencv fails.

## Done criteria

- [ ] Decision record exists with all seven answers (or explicit unknowns)
- [ ] Spike branch deleted; nothing native committed to the workspace branch
- [ ] `docs/plans/README.md` status row updated, and the `03-on-device/*` rows annotated "blocked on 00.06" are unblocked with the chosen options

## STOP conditions

- No physical iPhone — questions 2–4 cannot be answered; report and mark provisional.
- Both VC5 and fast-opencv fail to build after one round of the usual fixes (pod cache clean, `use_frameworks!` toggle) — report exact errors; picking the fallback is the operator's call.

## Maintenance notes

- Package versions pinned in the record are the ones plans 03.01–03.05 install; bump them only with a rebuild test.

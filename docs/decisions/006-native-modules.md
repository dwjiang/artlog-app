# 006 — Native modules on Expo 57 / React Native 0.86

Status: **spike complete; downstream acceptance gates recorded**, 2026-09-09. Based on commit
`fa1a14c`, in the disposable `spike/native-modules` worktree. No native spike code
has been copied into the product app.

## Decisions and remaining gates

| Question | Result | Decision / next gate |
|---|---|---|
| 1. VisionCamera 5 + worklets + QR | Runs together on iPhone: 1280×720 frames at 30 fps; QR URL decoded. | Go for VC5 on device. Barcode 5.2.3 is a **no-go for the installed arm64 simulator**, below. |
| 2. Vision rectangles, warp, letterbox | Live Vision runs at 30 calls/s; every-third-frame run sustains approximately 10 calls/s for five minutes. Still-image warps take 25–39 ms. The 40% inner-selection heuristic produces a visibly wrong crop. | Go for Nitro/Vision plumbing; **reject the inner-selection heuristic**. Full-resolution captured-image warp latency and preprocessing parity remain open. |
| 3. fast-opencv ORB | Runs on RN 0.86.3: 300/500 caps both report 2.0 ms median extraction on a 512×512 crop; descriptor/keypoint sizes match the wire shape. | Go for fast-opencv 1.0.1; retain cap **500**. Python parity remains a 03.04 acceptance test. |
| 4. App Attest | Supported; generated key, attestation and assertion on iPhone. CBOR/RP ID/environment decoded; assertion signature verified with Node WebCrypto. | Go for `@expo/app-integrity`. Correct the environment and assertion-hashing assumptions below. |
| 5. MapKit local search | Local Expo DSL module returns names, coordinates and website URLs on iPhone. Museum-only filter misses SFMOMA itself. | Go for MapKit; combine museum and natural-language candidates, then deduplicate. |
| 6. CoreML resource bundling | Precompiled MobileNetV2 survives CocoaPods resources, loads and predicts on iPhone. | Go for `s.resources` + `Bundle(for:)` with the tested static linkage. |
| 7. Native Apple login / Convex | Native sign-in returned a token; `jose` verified its Apple signature, issuer and bundle-ID audience in a local Convex default-runtime action. Wrong audience was rejected. | Go for native Apple + default-runtime verification; provider account linking and session creation remain 04.11 integration tests. |

The native mechanisms for plans 03.01–03.05 and 03.07 are selected. Their
implementation tests must still cover the gates listed here: simulator QR
support, artwork boundary selection, full-resolution warp latency, preprocessing
and ORB parity, and product-bundle attestation. Plan 04.11 can use default-runtime
verification; actual provider account linking and session creation remain 04.11 tests.

## Environment and exact versions

Physical device: iPhone 16 Pro (`iPhone17,1`), iOS 26.6 (23G71), the only available
iPhone. Host: Apple silicon, Xcode 26.6 (17F113). Project minimum iOS: 16.4.
The spike uses **`app.artlog.spike`**, team `J4UW2CVVY4`, with development signing
(`get-task-allow=true`). It does not prove provisioning for `app.artlog.ios`.

| Package / tool | Tested version |
|---|---|
| Expo / React Native / React | 57.0.20 / 0.86.3 / 19.2.3 |
| expo-dev-client / react-native-worklets | 57.0.18 / 0.10.1 |
| react-native-vision-camera | 5.2.3 |
| react-native-vision-camera-worklets | 5.2.3 |
| react-native-vision-camera-barcode-scanner | 5.2.3 |
| react-native-nitro-modules / nitrogen | 0.37.1 / 0.37.1 |
| react-native-nitro-image | 0.15.2 |
| react-native-fast-opencv / FastOpenCV-iOS pod | 1.0.1 / 1.0.4 |
| @expo/app-integrity / expo-apple-authentication | 57.0.1 / 57.0.1 |
| Convex / @convex-dev/auth / jose | 1.45.0 / 0.0.95 / 6.2.12 |

Use these versions when reproducing the spike, then rebuild before accepting a
version change. `npx expo install --check` now suggests newer Expo patch versions
(Expo 57.0.21, UI 57.0.17, glass-effect 57.0.2, Router 57.0.20); those versions
were not tested here. The versioned [Expo 57 reference](https://docs.expo.dev/versions/v57.0.0/)
confirms the RN 0.86 / React 19.2.3 baseline and minimum iOS 16.4.

## Build findings

`npx expo prebuild --platform ios --clean` and CocoaPods installation completed.
The first `expo run:ios --device` build failed because a wildcard provisioning
profile lacked App Attest and Sign in with Apple. A subsequent Xcode build with
an explicit spike bundle identifier and provisioning updates succeeded:

```sh
xcodebuild -workspace ios/artlog.xcworkspace -scheme artlog \
  -configuration Debug -destination 'id=<paired-device-UDID>' \
  -derivedDataPath ios/build -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration build
```

The resulting signed app includes both capabilities; all native probes below
come from that app. No dependency patches or `use_frameworks!` workaround were
needed for the device build. The VC5 hook files inspected during diagnosis
match their downloaded 5.2.3 package copies.

The generic simulator build also reports `BUILD SUCCEEDED`, but its executable
is **x86_64**. `react-native-vision-camera-barcode-scanner` pins
`GoogleMLKit/BarcodeScanning 9.0.0` (MLKitBarcodeScanning 8.0.0). Its generated
CocoaPods configuration excludes `arm64` for `iphonesimulator`, propagating to
the app. Installation on a fresh iOS 26.5 simulator fails with
`Failed to find matching arch`. Booting that simulator with `--arch=x86_64`
also fails: its only supported architecture is arm64. Consequently
`npm run ios -- --port 8084 --localhost` could not launch this combined stack.
Do not record that simulator compilation as runtime success.

QR package choice remains open: test an updated package with arm64 simulator
support, or evaluate a local iOS Vision barcode request. If later device integration fails, the planned fallback is `expo-camera` with
`onBarcodeScanned` and still-image Vision detection. No fallback has been
implemented or accepted by this spike.

## Camera and rectangle measurements

The successful rerun waited for camera permission, kept the frame-resolution
and QR-format options stable, and cleared Metro's stale transform cache. The
physical camera delivered **1280×720** frames, reported as
`yuv-420-8-bit-full` (the session config reports `yuv-420-8-bit-video`).
Measurements below use approximately one-second reporting windows:

| Phase | Windows | Camera fps, median (range) | Vision calls/s, median (range) | Per-window mean Vision ms, median (range) |
|---|---:|---|---|---|
| Empty worklet, 8 s | 8 | 30.0 (29.9–30.0) | — | — |
| Every frame, 10 s | 9 | 30.0 (30.0–31.0) | 30.0 (30.0–31.0) | 7.2 (7.1–7.7) |
| Every third frame, 10 s | 9 | 30.0 (29.9–31.0) | 10.0 (9.7–10.0) | 9.1 (6.7–9.5) |
| Every third frame, 300 s | 296 | 30.0 (29.9–30.9) | 10.0 (9.7–10.0) | 9.9 (5.8–18.3) |

The throughput gates pass on this phone. The spike resets its frame counter
each reporting window, causing some 9.7 calls/s windows at stride three; use a
separate continuous stride counter in the implementation. Maximum individual
Vision call during the five-minute run was 20 ms. There were no frame-drop logs,
and 24 windows had rectangle hits; those hits do not establish canvas accuracy.
Short empty/every-frame phases initially faced a scene with no rectangle hits.

Native thermal state remained **fair** at all eleven readings from 0 to 300 s.
The unplugged phone reported **50%** battery throughout. This is one debug-build
run from an already-warm starting state, with coarse battery readings, not a
power measurement or proof on older supported iPhones.

QR scanning decoded `https://example.com/artlog-native-spike` from a code shown
on the Mac, with 207 callbacks during the measured run. Production must dedupe
repeated scans. Full frame windows, thermal readings and aggregation details are
in [device-retry.log](../../spikes/native-modules/notes/device-retry.log) and
[device-retry-results.json](../../spikes/native-modules/notes/device-retry-results.json).

The Swift frame entry point must cast `any HybridFrameSpec` to
`any NativeFrame` before reading its optional `sampleBuffer`. Map
`frame.orientation` and `frame.isMirrored` into the Vision request, and dispose
every frame. One Nitro hybrid can provide synchronous frame detection and
background-queue Promise methods for still detection/warping; both compiled.
Use `scheduleOnRN` from worklets 0.10.1 to report observations.

Still-image probes ran on the iPhone, from four 1280-pixel Wikimedia photographs:

| Photograph | Strict observations / detection ms | Loose observations / detection ms | Strict warp total ms | Visual assessment |
|---|---|---|---|---|
| Orsay, two visitors | 2 / 101 (first call) | 2 / 8 | 39: detect 5, warp 21, letterbox/JPEG 11 | **Wrong:** inner selection crops the sky and loses the lower painting. |
| Alte Pinakothek, Saal IX | 0 / 22 | 3 / 8 | No rectangle | Strict minimum size rejects the smaller paintings. |
| Alte Pinakothek, Room XIII | 1 / 12 | 5 / 11 | 34: detect 9, warp 2, letterbox/JPEG 21 | Full selected painting retained, including its frame. |
| Rijksmuseum, Abraham | 0 / 35 | 3 / 17 | No rectangle | Loose detections alone do not establish a correct artwork crop. |

These are individual debug-build samples, not latency distributions. Successful
totals include image loading and JPEG output; they do not establish <100 ms for
a full-resolution camera capture. The successful camera rerun saved a
4224×2376 JPEG with orientation `right` in 490 ms, but no rectangle was found
in that scene, so its warp latency remains unknown. The Orsay/Room XIII still
warps were repeated at 25/32 ms respectively; the Orsay selection remained wrong.
Three later automatic captures completed in 325/299/295 ms, each at
4224×2376, and each found no rectangle. The first saved capture was inspected
and was nearly black, so framing was not established; these are not valid
three-painting quality trials. See [capture trial log](../../spikes/native-modules/notes/camera-capture-trials.log).
Controlled, visibly framed captures are still required in 03.02.

Strict parameters: confidence 0.6, aspect ratio 0.3–1.0, minimum size 0.2,
maximum observations 3, quadrature tolerance 20. Loose parameters changed
confidence to 0.3, minimum size to 0.1 and maximum observations to 6. Treat both
as starting points, **not accepted production tuning**.

The Orsay outer area was 25.3% of the image and the chosen inner area 10.5%
(41.5% of the outer), so it passed the proposed 40% test while selecting an
internal painting feature. Require evidence that an inner candidate represents
the canvas boundary before replacing the outer quad; an area threshold alone
is insufficient. Visual outputs and source attribution are in the
[probe notes](../../spikes/native-modules/notes/README.md).

The spike used mean-color padding and CGContext `.medium` interpolation. It
does not establish parity with the index preprocessing. The selected embedding
export's [decision 001](001-embedding-model-export.md) uses **black** letterboxing;
plan 03.02 must resolve that existing mismatch against the active index contract
before accepting parity. Do not infer pixel equivalence from `.medium`.

## ORB result and API corrections

The initial `bad any cast` error came from logging `gray.rows` after
`gray.release()`. Saving dimensions before release fixed the probe; extraction
and packing now run successfully on the phone.

Both caps used the same 512×512 letterboxed Room XIII crop, six extraction
iterations each. Reported "median" is the upper middle sample of those six;
read/decode/grayscale happened once per cap, and packing reports the last run.

| Cap | Actual points | First / reported median / minimum extraction ms | Read + gray ms | Pack ms | Descriptor / keypoint bytes |
|---|---:|---|---:|---:|---|
| 300 | 300 | 4.6 / 2.0 / 1.9 | 13.5 | 0.2 | 9,600 / 4,800 |
| 500 | 498 | 2.0 / 2.0 / 1.9 | 5.8 | 0.3 | 15,936 / 7,968 |

These measurements establish native extraction and byte access, not matching
quality or Python descriptor equivalence. They are debug-build samples on the
only available phone, the iPhone 16 Pro.

Installed 1.0.1 types expose `keypoints.toArray()`, **not**
`OpenCV.toJSValue(keypoints)`. `descriptors.toBuffer('uint8')` returns an object
`{ rows, cols, channels, buffer: Uint8Array }`; extract `.buffer` before using
its length/bytes. Pack keypoints as little-endian Float32 `[x,y,size,angle]`,
preserving descriptor row order: 32 descriptor bytes + 16 keypoint bytes per
point. Thus 300/500 points occupy 14,400/24,000 binary bytes before transport
encoding. Read needed metadata before releasing all native objects.

Keep the existing `shared/model-version.json` cap of **500**: measured extraction
is comfortably below the 80 ms budget at both caps, with no observed latency
reason to reduce the feature budget. Plan 03.04 must compare a common fixture
against Python and exercise the production encoder. If later integration fails,
the fallback remains a local Expo module wrapping OpenCV's ORB implementation.

## App Attest

Measured: `isSupported=true`; key generation 43 ms; attestation 1,642 ms
(7,744 base64 characters / 5,808 bytes); assertion 23 ms (188 characters /
141 bytes). Decoded attestation: `fmt=apple-appattest`, counter 0, RP ID hash
matches SHA-256 of **`J4UW2CVVY4.app.artlog.spike`**. AAGUID is `appattest` plus
seven zero bytes: **production**, consistent with the actual signed entitlement.
Development signing does not automatically make this a sandbox attestation.
Retest against `TEAMID.app.artlog.ios` when that product bundle is provisioned.

The assertion has 37 bytes of authenticator data, counter 1, and a 71-byte DER
ECDSA signature. The public key from the attestation leaf certificate verifies
the assertion with the original challenge string. The
[public fixture](../../spikes/native-modules/notes/app-attest-assertion.json)
contains no private key or Apple account token.

For `clientData = nonceString + "." + payloadJson`, compute:

```text
clientDataHash = SHA256(UTF8(clientData))
nonce = SHA256(authenticatorData || clientDataHash)
crypto.subtle.verify(ECDSA/SHA-256, publicKey, DER_to_P1363(signature), nonce)
```

Measured with Node WebCrypto: verifying `nonce` succeeds; passing the unhashed
concatenation (as the original 04.04 plan specified) fails; changing the payload
fails. See [results](../../spikes/native-modules/notes/app-attest-results.json).
This follows Apple's [assertion validation procedure](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
and the [node-app-attest implementation](https://github.com/uebelack/node-app-attest/blob/main/src/verifyAssertion.js).
Expo 57.0.1 itself hashes the challenge string once before calling DeviceCheck,
as documented by [AppIntegrity](https://docs.expo.dev/versions/v57.0.0/sdk/app-integrity/).

This is a native generation and signature smoke test, not complete server-side
attestation validation: certificate-chain trust, attestation nonce, challenge
consumption, device registration and replay rejection still belong to 04.04 /
03.07. Use the fixture to keep synthetic tests aligned with a real assertion.

## MapKit and CoreML

`MKLocalPointsOfInterestRequest` is iOS **14.0+**, per Xcode 26.6 SDK headers;
`.museum` is iOS 13.0+. Neither raises this project's iOS 16.4 floor. The Expo
DSL module uses async `MKLocalSearch(request:).start()` and returns `name`,
`placemark.coordinate`, optional `url`, category and distance.

At the fixed SFMOMA coordinate, an 800 m museum search returned six entries
in 401 ms, all with URLs, including two Contemporary Jewish Museum entries.
SFMOMA itself was absent. A natural-language `art gallery` query returned 25
entries in 514 ms, including SFMOMA classified as a landmark. **Run the text
query even when museum results are nonempty**, then deduplicate/filter local
candidates; neither category completeness nor URL presence is guaranteed.
No live-location permission/GPS test was performed.

Apple's MobileNetV2 `.mlmodel` was precompiled using `xcrun coremlcompiler
compile`, then placed under the local Expo module's `ios/Models`. Podspec
`s.resources = ['Models/*.mlmodelc']` copied the directory intact.
`Bundle(for: CoremlProbeModule.self)` resolved to the app bundle with the tested
static linkage. Load with `MLModelConfiguration.computeUnits = .all` succeeded
in 536.4 ms; one warmed prediction on a synthetic 224×224 pixel buffer took
1.18 ms. This confirms bundling/loading, not the selected C-RADIO model's
performance or compatibility across Xcode/compiler versions.

## Apple sign-in feasibility

The isolated local deployment `local-daniel_jiang-artlog` at `127.0.0.1:3210`
ran an internal action without `"use node"`. Results are in
[convex-runtime.json](../../spikes/native-modules/notes/convex-runtime.json):
Apple JWKS HTTP 200, three RSA/RS256 keys, synthetic RS256 verification passes,
wrong audience/issuer/expiry reject, and a synthetic token naming a real Apple
`kid` fails signature verification through `createRemoteJWKSet`.
`ConvexCredentials({ id: 'apple-native', authorize })` also imports and creates
a credentials provider. This directly tests the relevant crypto/network
capabilities of the [default Convex runtime](https://docs.convex.dev/functions/runtimes).

The native Apple sign-in sheet completed and returned a 798-character identity
token. A second internal action verified that real token against Apple's remote
JWKS in the default runtime: **RS256**, issuer **`https://appleid.apple.com`**,
audience **`app.artlog.spike`**, nonempty subject. Verification with audience
`app.artlog.ios` correctly rejected it. Only these non-account results are saved
in [convex-real-apple.json](../../spikes/native-modules/notes/convex-real-apple.json);
the token, subject and email are excluded from the evidence.

This establishes real native-token feasibility and observed bundle-ID audience.
An authenticated Convex session/account-link flow was not driven. Plan 04.11
must fix the product verifier audience to `app.artlog.ios`; the spike audience
must not be accepted by the product.

## Completion and remaining verification

- TypeScript and lint pass in the disposable worktree after the probe fixes.
- Local Convex push, runtime probe and code generation pass.
- Physical iPhone debug build, install, camera/QR, ORB and five-minute thermal
  verification pass. Device UI was exercised in light mode.
- The generic simulator build succeeded as x86_64; combined-stack simulator
  installation and `npm run ios` runtime verification failed as explained above.
- Full-resolution captured-artwork warp, three-painting live boundary quality,
  Python/pixel parity, product-bundle App Attest and Apple account/session integration
  remain explicit downstream acceptance tests, not successful spike results.
- Disposable `../artlog-spike-native` worktree and `spike/native-modules` branch
  were deleted after evidence collection. The spike app was uninstalled, its
  Metro server stopped, and the temporary Apple token removed. No native spike
  implementation was copied into the product app.

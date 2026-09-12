# Embedding model export (plan 03.03)

Produces the CoreML package the app ships and the index build's weights, from the recipe in
[decision 001](../../docs/decisions/001-embedding-model-export.md): C-RADIOv3-B, DINOv2 adaptor
summary, 512×512 RGB input scaled by 1/255 inside CoreML, fp16 compute, symmetric per-channel
int8 on the 53 two-dimensional Linear weights, unnormalized 1536-float output. `export_coreml.py`
asserts that its recipe constants match `shared/model-version.json`; any change to either is a
new `modelVersion` and an index migration (plan 02.08).

Requires Apple silicon macOS, Xcode 26, `uv`, and about 3 GB of disk (a 546 MB checkpoint under
`cache/`, ~1 GB under `out/`; both ignored). The app and module require iOS 17.0, matching the
exported model; Expo applies `ios.deploymentTarget` from `app.json` during prebuild.

## Export, package, fetch

```sh
cd scripts/model
uv sync                                          # once; Python 3.11 with the pinned torch/coremltools
uv run pytest -q                                 # tiny-model contract tests
uv run python export_coreml.py --out out/        # out/CRadioV3B.mlpackage, fakequant_state.pt, model-manifest.json
```

`model-manifest.json` records the model version, input/output names, the weight-file and
package hashes and the tool versions. A faithful re-export reproduces
`weightsSha256 = f6f6d2d8c75ed755718114cdbff2dcbf262527b5974c2eefa2916d8533c7b6a7`, the spike's
int8 weight file byte for byte (verified 2026-09-10 with torch 2.7.0 / coremltools 9.0). The
`fakequant_state.pt` next to it is the PyTorch checkpoint with the phone's dequantized weights;
plan 02.04's index build loads it so index vectors carry the same int8 rounding as the phone.

For an index-only rebuild, copy `out/fakequant_state.pt` to
`spikes/coreml-export/artifacts/fakequant_state.pt` at the repository root. Exporting is sufficient;
leave the published `model-asset.json` pin unchanged.

For a new release or a local compiled-asset test, run `./package-model.sh` from `scripts/model`.
It compiles the model and creates `out/CRadioV3B-<version>.zip`. The ZIP includes a manifest with
the export time and duration, so it has a new checksum even when the weight file matches.
The model is **not committed**. `package-model.sh` writes `model-asset.json` with the release
asset URL and its sha256; `npm run model:fetch` (also the `eas-build-pre-install` hook) downloads
that zip, checks the hash and the `modelVersion` against `shared/model-version.json`, and unzips
it into `modules/coreml-embed/ios/Models/` (ignored). Re-running is a no-op while the folder's
`.asset-sha256` matches.

The fetch uses the GitHub release-asset API. Public assets can be downloaded without credentials;
when available, it uses `GH_TOKEN` (or `GITHUB_TOKEN`) from the shell/build environment or the
existing `gh auth login` session. While this repository is private, authentication is required.
For EAS builds of the private repository, set `GH_TOKEN` as a **secret** in
each build environment you use, with a fine-grained GitHub token granting this repository
**Contents: read**. EAS's GitHub integration does not supply this token to build scripts. The
downloader needs only Node 22.13+ (already required by SDK 57) before dependency installation;
`gh` is optional when a token is supplied. Run `npm run test:model-fetch` from the repository
root for the public/private download, symlinked CLI and asset-install regression tests.

The [pinned model release](https://github.com/dwjiang/artlog-app/releases/tag/model-c-radiov3-b-int8-512-dinov2-v1)
is published. Its archive matches `model-asset.json`; the pre-install hook was verified from an
empty model directory with token authentication and no `gh` CLI or installed dependencies.

For future model versions, publish the asset once (from the repository root):

```sh
gh release create "model-$(node -p "require('./scripts/model/model-asset.json').modelVersion")" \
  scripts/model/out/CRadioV3B-*.zip --title "CoreML model $(node -p "require('./shared/model-version.json').modelVersion")" \
  --notes "Compiled C-RADIOv3-B int8 package for the coreml-embed module"
```

To test a locally packaged asset, override the download URL:
`MODEL_ASSET_URL=file://$PWD/scripts/model/out/CRadioV3B-<version>.zip npm run model:fetch`.
Rebuild the dev client after fetching (`npx expo prebuild --platform ios --clean && npx expo run:ios`);
the podspec ships `Models/*.mlmodelc` as a CocoaPods resource.

## Checking the phone path without a phone

`modules/coreml-embed/ios/Embedder.swift` has no Expo dependency, so the Mac harness runs the
exact decode → BGRA pixel buffer → prediction → normalize path against the fetched model:

```sh
swiftc -O -framework CoreML -framework ImageIO \
  modules/coreml-embed/ios/Embedder.swift modules/coreml-embed/scripts/mac-harness.swift -o /tmp/coreml-embed-harness
/tmp/vision-rect-harness letterbox jobs/fixtures/test-painting.jpg 512 /tmp/crop.png   # see modules/vision-rect/scripts
/tmp/coreml-embed-harness modules/coreml-embed/ios/Models /tmp/crop.png > /tmp/harness.json
cd scripts/model && uv run python verify_export.py --embeddings /tmp/harness.json
```

`verify_export.py` embeds the same crop files with the PyTorch fake-quant model (MPS fp16) and
prints the mean/minimum cosine, exiting non-zero below plan 02.04's 0.99 / 0.97 thresholds.
Decision 001 measured the iPhone's Neural Engine output equal to the Mac's `CPU_AND_NE` output
on all 200 calibration images, so a Mac harness pass is the model-numerics half of the device
check; only latency and memory need the phone.

The on-device reference for the drift check comes from the app itself: Settings → dev tools →
**Export calibration embeddings** (dev builds only) downloads `jobs/calibration/urls.txt`,
letterboxes each image with the production vision-rect module, embeds it, and shares
`iphone-embeddings.json` (`{ url: number[] }`, normalized) plus `iphone-report.json`. Commit
the embeddings as `jobs/calibration/iphone-embeddings.json` whenever the export changes.

## Results, 2026-09-10 (Apple M5 Pro, macOS 26.5, Xcode 26.6)

| Check | Result |
| --- | --- |
| Export | `weightsSha256` equals decision 001's int8 package; 53 quantized weights; 20 s after the cached download |
| Asset | `CRadioV3B-c-radiov3-b-int8-512-dinov2-v1.zip` 112 MB; `.mlmodelc` 114 MB |
| Mac harness, 200 calibration crops (PNG) vs PyTorch fake-quant MPS fp16 | mean cosine 0.99704, min 0.99268 (decision 001 measured 0.99701 / 0.99292 on its black-letterbox pixels) |
| Same crops after a JPEG q0.95 round trip (the phone's crop file format) | mean 0.99689, min 0.99268 against PyTorch; 0.99891 / 0.98993 against the PNG embeddings |
| Mac `CPU_AND_NE` latency | load 2.7 s cold, ~60–70 ms per 512×512 crop |
| Unsigned Release archive | `artlog.app` 170 MB, of which the model is 114 MB (under the 200 MB target) |
| iPhone 17 Pro simulator, CPU only | warm-up load 408 ms, first predict 1.9 s; later predictions ~1.1 s |
| In-app calibration export on the simulator (download → vision-rect letterbox → JPEG crop → embed) | 200 vectors keyed by the exact `urls.txt` set, median 972 ms each, shared as a 6.5 MB JSON; cosine vs the Mac harness PNG vectors mean 0.99560, min 0.98288 (CPU compute plus the JPEG crop; the phone's Neural Engine matches the Mac's) |

Not yet measured here: physical-iPhone warm-up and latency (decision 001: ~4.1 s load, 66.6 ms
per prediction on the iPhone 16 Pro), and the on-device calibration export the index drift check
will read; the paired iPhone was offline on 2026-09-10.

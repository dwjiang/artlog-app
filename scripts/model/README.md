# Embedding model export

Produces the CoreML package the app ships and the index build's weights. The
[accepted recipe](../../docs/experiments/README.md#embedding-model) is C-RADIOv3-B, DINOv2 adaptor
summary, 512×512 RGB input scaled by 1/255 inside CoreML, fp16 compute, symmetric per-channel
int8 on the 53 two-dimensional Linear weights, and a final fp16 layer that L2-normalizes the
1536-float summary and projects it to an unnormalized 512-float output with `projection.npz`.
`export_coreml.py` asserts that its recipe constants match `shared/model/model-version.json`; any
change to either is a new `modelVersion` and an index rebuild.

A new `modelVersion` also moves the cosine scale, so retune every similarity cutoff with it:
`IMAGE_MATCH_COSINE` (app and `convex/lib/labelVerify.ts`), `DUPLICATE_COSINE`,
`MULTI_VIEW_DUPLICATE_COSINE`, `AGREEMENT_MIN_COSINE`, `REPLAY_COSINE`,
`EMBEDDING_MERGE_COSINE` (`scripts/data/pipeline/dedupe.py`), and the calibrator's
weights and low-texture rule (refit with the [jobs guide](../data/README.md#calibrator-training)).

`projection.npz` is the corpus PCA with square-root whitening: each of the top 512 components is
divided by λ^¼. Square-root whitening limits amplification of the phone's int8/fp16 noise at the
drift gate. Refit it only together with a new `modelVersion`:

```sh
uv run python fit_projection.py --features "$HOME/Documents/Artlog Data/jobs/scratch/merged"
```

Requires Apple silicon macOS, Xcode 26, `uv`, and about 3 GB of disk (a 546 MB checkpoint under
`cache/`, ~1 GB under `out/`; both ignored). The app and module require iOS 17.0, matching the
exported model; Expo applies `ios.deploymentTarget` from `app.json` during prebuild.

## Export, compile, track

For physical-iPhone latency, memory and compute-device measurements, use the
[benchmark harness](benchmark/README.md) with the exported package.

```sh
cd scripts/model
uv sync                                          # once; Python 3.11 with the pinned torch/coremltools
uv run pytest -q                                 # tiny-model contract tests
uv run python export_coreml.py --out out/        # out/CRadioV3B.mlpackage, fakequant_state.pt, model-manifest.json
```

`model-manifest.json` records the model version, input/output names, the weight-file and
package hashes and the tool versions. A faithful re-export reproduces
`weightsSha256 = 426326043e6f6b58d8f8c27ae975335d34f3d6dfa2d2e58731384963cf5a216f`, the tracked
weight file byte for byte with torch 2.7.0 / coremltools 9.0. The
`fakequant_state.pt` next to it is the PyTorch checkpoint with the phone's dequantized weights;
the index build loads it so index vectors carry the same int8 rounding as the phone.

For an index-only rebuild, exporting is sufficient: jobs load
`scripts/model/out/fakequant_state.pt` at the repository root by default. Use
`--fakequant` to select a different export path. Leave the tracked iOS model unchanged.

The compiled model is **committed through Git LFS** under `modules/coreml-embed/ios/Models/`.
`.gitattributes` tracks every file inside `*.mlmodelc` with LFS; `model-manifest.json` stays in
ordinary Git so reviewers can inspect the recipe and weights checksum.

Install LFS before cloning (`brew install git-lfs && git lfs install`). For an existing checkout,
run `git lfs install` and `git lfs pull` from the repository root. Normal checkouts materialize
the model from the LFS cache; Conductor worktrees on the same Mac share that cache. A new model
version, separate clone, or uncached CI checkout needs a download. Private repositories use your
GitHub repository credentials.

`npm run model:check` rejects missing files, unresolved LFS pointers, a manifest that differs
from `shared/model/model-version.json`, and weights that do not match the manifest's SHA-256.
It runs before `npm run ios` and as `eas-build-pre-install`, using only Node 22.13+ before
dependency installation. Run `npm run test:model` for its regression tests.

EAS CLI uploads include the materialized model files through `.easignore`; the pre-install
hook validates them without Git or a separate model-download token. Run `git lfs pull` before
uploading from a checkout that skipped LFS. CI must materialize LFS before invoking EAS
(for GitHub Actions, enable `lfs: true` on `actions/checkout`). For builds sourced from GitHub
ZIP/tar archives, enable repository Settings → Archives → **Include Git LFS objects in archives**;
the pre-install check rejects pointer-only archives.

To replace the compiled model after exporting, run these commands from the repository root:

```sh
scripts/model/compile-model.sh
npm run model:check
git add modules/coreml-embed/ios/Models
git lfs status
```

The compiler validates a temporary package before replacing the tracked model directory.
Commit the model, manifest, and any recipe/version changes together; a normal `git push`
uploads the LFS objects. Rebuild the dev client after changing the model
(`npx expo prebuild --platform ios --clean && npm run ios`); the podspec ships `Models/*.mlmodelc`
as a CocoaPods resource.

## Checking the phone path without a phone

`modules/coreml-embed/ios/Embedder.swift` has no Expo dependency, so the Mac harness runs the
exact decode → BGRA pixel buffer → prediction → normalize path against the tracked model:

```sh
swiftc -O -framework CoreML -framework ImageIO \
  modules/coreml-embed/ios/Embedder.swift modules/coreml-embed/scripts/mac-harness.swift -o /tmp/coreml-embed-harness
/tmp/vision-rect-harness letterbox scripts/data/fixtures/test-painting.jpg 512 /tmp/crop.png   # see modules/vision-rect/scripts
/tmp/coreml-embed-harness modules/coreml-embed/ios/Models /tmp/crop.png > /tmp/harness.json
cd scripts/model && uv run python verify_export.py --embeddings /tmp/harness.json
```

`verify_export.py` embeds the same crop files with the PyTorch fake-quant model (MPS fp16) and
prints the mean/minimum cosine, exiting non-zero below the 0.99 / 0.97 thresholds.
The Mac harness checks model numerics on shared calibration inputs. Use the physical-iPhone
benchmark to check device numerics, latency and memory.

The on-device reference for the drift check comes from the app itself: Settings → dev tools →
**Export calibration embeddings** (dev builds only) downloads `shared/model/calibration/urls.txt`,
letterboxes each image with the production vision-rect module, embeds it, and shares
`iphone-embeddings.json` (`{ url: number[] }`, normalized) plus `iphone-report.json`. Commit
the embeddings as `scripts/data/calibration/iphone-embeddings.json` whenever the export changes.

The committed `iphone-embeddings.json` contains phone summary vectors passed through the
exported fp16 projection. The Mac harness checks the projection's Neural Engine numerics;
the physical-iPhone benchmark checks the complete model on device.

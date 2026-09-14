# Physical-iPhone CoreML benchmark

Measures compilation, loading, 50 warmed predictions, sampled process memory,
thermal state and `MLComputePlan` preferred devices in a separate light-mode
iPhone app. It also exports vectors for the 200 shared calibration images.
This retains the device harness from the
[original investigation](https://github.com/dwjiang/artlog-app/tree/9693725420d34ee7bd81079f3e801b076e1c6789/spikes/coreml-export)
and consumes the [maintained model export](../README.md).

## Prepare

Export the model first using `scripts/model/export_coreml.py`. Its default
`scripts/model/out/CRadioV3B.mlpackage` is the benchmark's default input;
`--model` can select another compatible package with a 1,536-value `embedding`
output and 448×448 or 512×512 RGB input.

From this directory:

```sh
uv sync --locked
uv run python calibration.py --size 512
```

Preparation reads the shared URLs in `shared/model/calibration/urls.txt` and
source-byte hashes in `scripts/data/calibration/image-hashes.json`. It downloads missing
images into `artifacts/images/`, verifies cached bytes, and writes hashed raw RGB
buffers to `artifacts/calibration-512/`. Requests are spaced at least one second
apart; temporary failures have bounded retries and respect `Retry-After`.
Reruns reuse verified source images. It does not fetch the old 2,000-image
retrieval index or change the shared calibration references.

Pixels use the historical reference's EXIF handling, bicubic resize and centered
black padding. They isolate model numerics; they do not test the production
camera's mean-color, bilinear preprocessing. The existing reference embeddings
and report remain together under `scripts/data/calibration/`.

## Build and run on an iPhone

Requires macOS, Xcode, a paired physical iPhone and development signing. Locate
the device with `xcrun xctrace list devices`, then supply its UDID and your team:

```sh
export COREML_BENCH_DEVICE='your-iphone-udid'
export COREML_BENCH_TEAM='your-development-team-id'
xcodebuild -project BenchApp/BenchApp.xcodeproj -scheme BenchApp \
  -configuration Release -destination "id=$COREML_BENCH_DEVICE" \
  -derivedDataPath artifacts/device-build -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$COREML_BENCH_TEAM"
xcrun devicectl device install app --device "$COREML_BENCH_DEVICE" \
  artifacts/device-build/Build/Products/Release-iphoneos/BenchApp.app
uv run python bench.py --device "$COREML_BENCH_DEVICE" \
  --size 512 --units cpuAndNeuralEngine --out artifacts/iphone/run-001
```

Unlock the phone before running. The runner copies the package and prepared
pixels into BenchApp's Documents directory, launches the app, retrieves its log,
report and embeddings, and verifies the weights hash, requested configuration
and complete finite embedding set. `--out` must name a new directory so prior
measurements are not overwritten. Use `--units all` for a separate compute-unit
comparison; prepare with `--size 448` when testing a 448-input package.

Every run starts a new process, warms up five times and preserves all 50 timed
samples. Use a nominal thermal state for comparisons. Process memory samples
are not a guaranteed peak and do not include all Neural Engine service memory.
Compute-plan preferences are not an execution trace. These measurements do not
establish camera recognition accuracy or performance on unmeasured devices.

## Local checks

```sh
uv run pytest -q
xcodebuild -project BenchApp/BenchApp.xcodeproj -scheme BenchApp \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath artifacts/build CODE_SIGNING_ALLOWED=NO
```

Tests mock downloads and device commands. The unsigned build proves compilation;
only a physical-iPhone run establishes device measurements.

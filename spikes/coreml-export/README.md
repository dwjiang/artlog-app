# C-RADIOv3-B CoreML investigation

Spike [00.01](../../docs/plans/00-kickoff-spikes/01-coreml-export-and-neural-engine.md).
Read the [decision and measured results](../../docs/decisions/001-embedding-model-export.md)
before using an export in the app or building an index. This is an isolated
investigation, not an Expo native module.

## Reproduce the export

Requires Apple silicon macOS, Xcode 26, `uv`, and approximately 4 GB of free disk
space. Run from the repository root:

```sh
cd spikes/coreml-export
uv venv --python 3.11
uv pip sync requirements.txt
.venv/bin/python -c 'import torch; from wrapper import build; m = build(); print(m(torch.rand(1, 3, 512, 512)).shape)'
.venv/bin/python export.py --size 512 --precision fp16
.venv/bin/python export.py --size 512 --weights int8
.venv/bin/python export.py --size 512 --weights int4
.venv/bin/python export.py --size 448 --precision fp16
.venv/bin/python export.py --size 448 --weights int8
```

The result is `torch.Size([1, 1536])`. Each package and JSON export manifest lands
in `artifacts/`. The int8 exports share `artifacts/fakequant_state.pt` and assert
that their reconstructed states are identical. The source revision and checkpoint
SHA-256 are pinned in `wrapper.py`; a changed upstream checkpoint is rejected.
The first run downloads the 546 MB checkpoint containing adaptor heads.

`--frontend export` provides the alternate `torch.export` conversion route if
tracing fails. Only tracing was necessary for the recorded exports. Inputs are
fixed-size RGB pixels (`image`), scaled by 1/255 inside CoreML; RADIO applies its
own normalization. Output `embedding` is an **unnormalized** float32 `(1, 1536)`
DINOv2 summary. Normalize it before cosine retrieval.

## Exact quantization and preprocessing contract

`export.py:quantize` selects the **53 exported two-dimensional Linear weights**
and quantizes them using coremltools 9.0, symmetric signed int8, per output
channel (axis 0). Positional embeddings, normalization parameters, biases and
other constants retain fp16 precision. The unused spatial adaptor is removed by
conversion; it is still present in the PyTorch state dictionary.

Quantization starts from CoreML's fp16 constants. Its symmetric int8 codes cover
−127…127 with zero point 0. Scales and materialized weights have fp16 rounding.
The fake-quant checkpoint comes **from the actual CoreML dequantization ops**,
converted back to float32, rather than a separate approximate rounding formula.
All remaining floating state is fp16-round-tripped. The matching-weight test and
the cross-resolution equality check protect this contract. This implementation
uses coremltools' internal MIL loader and materialization API, pinned to 9.0.

Load the reference on a GPU as follows (CPU fp16 produced NaNs in this spike):

```python
import torch
from wrapper import ARTIFACTS, build

model = build()
model.load_state_dict(torch.load(ARTIFACTS / "fakequant_state.pt", weights_only=True))
model = model.to("mps").half().eval()  # use "cuda" for the future GPU build
model.radio.input_conditioner.dtype = torch.float16
```

MPS fp16 is measured; CUDA must still be checked on the job hardware. Do not use
the CPU's nonfinite fp16 output as an index reference. The ordinary RADIO dtype
attribute needs the explicit assignment even after `Module.half()`.

`calibration.py:letterbox` applies EXIF orientation, RGB conversion, bicubic resize
with Python's `round` dimension rule, and centered black padding. Every runtime
receives the same resulting pixels. The Swift app uses prepared raw RGB bytes
and verifies their SHA-256 before packing BGRA pixel buffers, avoiding an extra
OS image resize or color conversion during this numerical experiment. This does
not verify the future camera module's preprocessing.

4-bit means a separate per-weight-tensor, 16-entry k-means palette through
`palettize_weights`; it is not linear int4 quantization. It failed the provisional
accuracy check and is not the chosen recipe.

## Calibration and drift

The committed URL list contains **200** paintings, measured on Mac and iPhone
at both resolutions. `manifest.json` records each object's public-domain flag,
classification, source URL and downloaded-byte hash. Images and weights are
ignored. The separate 2,000-image retrieval index is still being collected.

To collect or resume the full disjoint sets:

```sh
.venv/bin/python calibration.py collect
.venv/bin/python calibration.py prepare --size 512
.venv/bin/python calibration.py prepare --size 448
```

Collection uses the Met's paginated v1.1 search, deterministic hash ordering,
public-domain painting filtering and image-byte/URL deduplication. A single
session spaces request starts at least one second apart. Intermittent HTTP 403,
429, server errors and connection failures get at most four attempts with
15/30/60-second cooldowns. A longer `Retry-After` is honored; waits over five
minutes stop the run for a later resume. HTTP 401 stops immediately, and missing
objects (404/410) are skipped.

Search pages, metadata and image downloads are cached under `artifacts/`.
`collection-state.json` saves the frozen candidate order, accepted images and
next object after each completed object using atomic replacement. Re-running
the same command resumes at a failed object without repeating earlier requests.
Persistent failures leave the published lists intact. Successful completion
writes 200 calibration URLs and 2,000 different index URLs. `prepare` downloads
missing images from the chosen list and writes hashed `.rgb` buffers and
manifests under `artifacts/`.

```sh
.venv/bin/python drift_check.py --size 512 --torch-device mps
.venv/bin/python drift_check.py --size 448 --torch-device mps
```

The report compares fp32 PyTorch, fp16 PyTorch with recovered int8 weights, and
each CoreML variant with `CPU_AND_NE` on macOS. It rejects zero/nonfinite vectors.
Reports record the sample count; acceptance belongs in the decision record. When `index-urls.txt`
exists, it must contain exactly 2,000 unique URLs disjoint from calibration;
the index is embedded once using the recovered weights and cached with a
weight/URL signature. Agreement@1 compares query variants against that **same**
index and the fp32 query's top result. It measures numerical agreement, not
ground-truth retrieval recall.

## iPhone benchmark

The SwiftUI app is separate from the product app and always uses light mode.
It compiles a package, times model loading, warms up five times, measures 50
predictions and exports embeddings for every prepared calibration image. It
records `MLComputePlan` preferred devices, estimated operation costs, thermal
state, process RSS after load and a sampled RSS maximum. Prediction timings
include extracting the 1,536 values. RSS samples are not a guaranteed peak and
do not measure all memory allocated by the Neural Engine service.

Find your device and use your Apple development team:

```sh
xcrun devicectl list devices
export COREML_BENCH_DEVICE='your-paired-device-identifier'
export COREML_BENCH_TEAM='your-development-team-id'
xcodebuild -project BenchApp/BenchApp.xcodeproj -scheme BenchApp \
  -configuration Release -destination "id=$COREML_BENCH_DEVICE" \
  -derivedDataPath artifacts/device-build -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$COREML_BENCH_TEAM"
xcrun devicectl device install app --device "$COREML_BENCH_DEVICE" \
  artifacts/device-build/Build/Products/Release-iphoneos/BenchApp.app
.venv/bin/python bench.py --device "$COREML_BENCH_DEVICE" --size 512 \
  --weights int8 --units cpuAndNeuralEngine
```

Unlock the phone before running. `bench.py` transfers the package and raw pixels
into **BenchApp's** Documents directory, launches it, retrieves the reports, and
checks the returned weight hash against the local export. The unattended runner
passes `--exit-after-run`; launching from Xcode without that flag leaves the
one-screen result visible. Device reports and vectors go to `artifacts/iphone/`.

Repeat for `(448, fp16)`, `(448, int8)`, `(512, fp16)`, `(512, int8)`, and
`(512, int4)`, with both `--units all` and `--units cpuAndNeuralEngine`. Keep the
device at nominal thermal state, start a new process per case, and preserve all
50 samples. No iPhone 12–15 measurements are implied by a result from an iPhone 16
Pro. `MLComputePlan` reports the compiler's preferred assignment, not an Instruments
trace proving which unit executed every operation.

Check the iPhone reference against the GPU and macOS outputs:

```sh
.venv/bin/python drift_check.py --size 512 --torch-device mps \
  --iphone artifacts/iphone/cradio-v3b-dino-512-int8-cpuAndNeuralEngine-embeddings.json
```

The embedding file must have a sibling `*-report.json`; size, model-weight hash,
compute configuration, URL set and vector dimensions are validated. The committed
`calibration/iphone-embeddings.json` and `iphone-report.json`, when present, are
the full 200-image 512/int8 reference. The committed report keeps
timings and assignment counts; full per-operation reports remain in
`artifacts/iphone/`. Keep the reference embeddings and report together.

## Checks

```sh
.venv/bin/python -m pytest -q
xcodebuild -project BenchApp/BenchApp.xcodeproj -scheme BenchApp \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath artifacts/build CODE_SIGNING_ALLOWED=NO
```

The tests cover paced requests, retry limits and cooldowns, collection resumption,
cosine/nearest-neighbor semantics, invalid vectors, letterbox pixels, and equality
between compressed CoreML constants and the recovered PyTorch checkpoint.
The real-model drift runs validate every measured output for
finite values. No Expo package, application route or product model-version file
is changed by this spike.

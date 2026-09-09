# 001 Embedding model export

Date: 2026-09-08 · Status: **accepted**

## Decision

Adopt **512 × 512 input, 1,536-dimensional DINOv2 adaptor summary, symmetric
per-channel int8 Linear weights and fp16 compute** for plans 03.03 and 02.04.
`modelVersion`: **`c-radiov3-b-int8-512-dinov2-v1`**. The full 200-image MPS/iPhone
drift gate passes. Plan 02.04 must repeat the drift check on its CUDA hardware
before generating the full catalog index.

On the available iPhone 16 Pro, the 512/int8 package predicts in about **67 ms**
with `CPU_AND_NE`. Its minimum cosine against PyTorch with the recovered weights
is **0.99292** on **200** paintings. Its top-1 agreement with fp32 queries is
**94.5%** on a disjoint 2,000-image index. The latest load costs approximately
**4.1 seconds**.
Reject the tested 4-bit palette: its mean cosine against fp32 is approximately
**0.740**, far below the drift target. Other 4-bit recipes were not investigated.

The Met API initially returned intermittent HTTP 403. After adding serial
request pacing, retry cooldowns and resumable checkpoints, the full 2,200-image
collection completed in approximately 130 minutes with no retries or 403s.
All 200 calibration images and the disjoint 2,000-image index are now evaluated
at both resolutions. All ten planned device configurations were measured on the
initial subset; both int8 CPU + NE cases were rerun on the full calibration set.

## Environment and reproducibility

- Host: MacBook Pro, Apple M5 Pro, 64 GB RAM, macOS 26.5.2; Xcode 26.6 (17F113).
- Device: physical iPhone 16 Pro (`iPhone17,1`), iOS 26.6 (23G71).
- Python 3.11.16, PyTorch 2.7.0, torchvision 0.22.0, timm 1.0.15,
  coremltools 9.0. All dependencies are pinned in the
  [requirements file](../../spikes/coreml-export/requirements.txt).
- RADIO source: `c0f37017930e9dda53f93424cf4bf39fc51f287e`.
- Checkpoint: `c-radio_v3-b_half.pth.tar`; SHA-256
  `530b0e827b1d409ca3b175466e11062885baedd823ec5dae3a88348e76d4c398`.
- Model loading, including the initial source/weight download: **27.953 s**.
  Loaded PyTorch model: **114,531,040 parameters**, including the unused spatial
  adaptor; this is not the size of the exported summary-only graph.
- Both 448 and 512 return `(1, 1536)`. RADIO reports preferred resolution 512.
  Initial CPU fp32 forwards took 173.6 and 227.1 ms respectively; these are
  shape smoke checks, not phone benchmarks.

The [NVIDIA model card](https://huggingface.co/nvidia/C-RADIOv3-B) and
[pinned RADIO source](https://github.com/NVlabs/RADIO/tree/c0f37017930e9dda53f93424cf4bf39fc51f287e)
identify the checkpoint and adaptor interface. The export uses the tensor wrapper
in [wrapper.py](../../spikes/coreml-export/wrapper.py), internal RADIO
normalization, and fixed-size CoreML RGB image input scaled by 1/255.

Reproduce from `spikes/coreml-export/`:

```sh
uv venv --python 3.11
uv pip sync requirements.txt
.venv/bin/python export.py --size 512 --precision fp16
.venv/bin/python export.py --size 512 --weights int8
.venv/bin/python export.py --size 512 --weights int4
.venv/bin/python export.py --size 448 --precision fp16
.venv/bin/python export.py --size 448 --weights int8
```

The [runbook](../../spikes/coreml-export/README.md) contains the exact device,
calibration and drift commands. No weights, images, compiled app or `.mlpackage`
are committed; they live under the ignored `artifacts/` directory.

## Export evidence

All five packages convert through `torch.jit.trace` to an iOS 17 ML Program.
No unsupported conversion op was encountered; `torch.export` was not needed.
Fixed-shape tracing warnings about resolution branches are expected because each
package accepts only its declared resolution. The 200-image macOS runs returned
finite, nonzero embeddings for every variant.

| Input | Weights | Package MB | Export seconds |
| --- | --- | ---: | ---: |
| 448 | fp16 | 212.926 | 3.941 |
| 448 | int8 | 119.482 | 3.567 |
| 512 | fp16 | 212.926 | 3.883 |
| 512 | int8 | 119.482 | 4.136 |
| 512 | int4 | 72.469 | 9.743 |

Sizes above are decimal MB of `.mlpackage` files, not compressed App Store size.
They exceed the planning estimates because the export includes the DINOv2
summary MLP and retains the positional table in fp16.

## iPhone latency, memory and operation assignment

Release build of the isolated SwiftUI BenchApp, light mode. Each row is a fresh
app process: compile the package, time `MLModel` initialization, warm up five
times, then measure 50 predictions on the first prepared painting. Predictions
include extracting the output array. Calibration embeddings follow timing.

| Input | Weights | Units | Median ms | Load ms | Loaded / sampled max RSS MB | Preferred non-ANE / unassigned ops |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 448 | fp16 | All | 44.17 | 4180 | 288.2 / 306.8 | 2 / 442 |
| 448 | fp16 | CPU + NE | 44.25 | 4250 | 261.0 / 270.0 | 2 / 442 |
| 448 | int8 | All | 41.24 | 3492 | 222.3 / 291.6 | 2 / 442 |
| 448 | int8 | CPU + NE | 41.09 | 3493 | 168.5 / 178.0 | 2 / 442 |
| 512 | fp16 | All | 70.34 | 4302 | 328.8 / 328.8 | 2 / 442 |
| 512 | fp16 | CPU + NE | 70.09 | 4383 | 261.4 / 272.5 | 2 / 442 |
| 512 | int4 | All | 66.62 | 3359 | 196.3 / 236.4 | 2 / 442 |
| 512 | int4 | CPU + NE | 66.73 | 3006 | 121.5 / 132.9 | 2 / 442 |
| 512 | int8 | All | 65.86 | 3521 | 249.8 / 257.8 | 2 / 442 |
| 512 | int8 | CPU + NE | 65.85 | 3812 | 168.6 / 180.1 | 2 / 442 |

The table above preserves the original 26-image runs. The full calibration uses
a different first painting; follow-up int8 measurements are:

| Input | Units | Median ms | Load ms | Loaded / sampled max RSS MB | Images exported |
| --- | --- | ---: | ---: | ---: | ---: |
| 448 | CPU + NE | 41.28 | 3250 | 168.4 / 180.9 | 200 |
| 512 | CPU + NE | 66.64 | 4127 | 168.9 / 183.1 | 200 |

These runs retain the same 312 Neural Engine, 2 CPU and 442 unassigned operation
counts. Both original and follow-up samples are saved in `iphone.json`.

All measured rows remained at nominal thermal state (0 → 0). “Loaded / sampled
max RSS” is process resident memory, not guaranteed peak memory or total Neural
Engine allocation. Samples are taken after loading and predictions, including
the later compute-plan/calibration phase; the harness also hashes the weight
file. A continuous Instruments memory trace was **not measured**. Compilation
time is separate from load time in the machine-readable results.

`MLComputePlan` prefers the Neural Engine for the main graph and CPU for input
`mul` (1/255 scaling) and `cast` (fp16). Unassigned operations are counted
separately; in the selected int8 run they are 389 constants and 53 weight
dequantization expressions. They are not classified as CPU fallback. These are compiler
assignments, not an Instruments execution trace. The exact summary and all 50
timings per completed row are retained in
[iphone.json](../../spikes/coreml-export/results/iphone.json).

| Other target devices | Latency / load / memory / op assignment |
| --- | --- |
| iPhone 12, 13, 14, 15; other iPhone 16 models | Not measured: no additional physical devices available |
| Xcode model-editor Performance report | Not measured: results use the independent app and `MLComputePlan` |

## Accuracy and drift

The [calibration URL list](../../spikes/coreml-export/calibration/urls.txt)
contains 200 paintings; the [index URL list](../../spikes/coreml-export/calibration/index-urls.txt)
contains 2,000 different paintings. The
[manifest](../../spikes/coreml-export/calibration/manifest.json) covers all 2,200
unique Met paintings with `isPublicDomain=true`. Filtering checks painting
classification and deduplicates URLs and downloaded bytes. All source hashes
were verified. The [Met API](https://metmuseum.github.io/) supplies
`primaryImageSmall` and the public-domain flag.

The reference comparison is PyTorch **MPS** fp32 versus MPS fp16 with the actual
CoreML-dequantized weights. Here fp32 describes execution after loading the
published half-precision checkpoint, not recovery of original training weights.
Every runtime receives the same bicubic-resized,
centered black letterbox pixels. The iPhone validates raw RGB bytes by SHA-256;
the future camera preprocessing path is not covered.

| Input | Compared pair | Mean cosine | Minimum cosine | Images |
| --- | --- | ---: | ---: | ---: |
| 448 | PyTorch fp32 ↔ fakequant fp16 | 0.998907 | 0.997714 | 200 |
| 448 | PyTorch fp32 ↔ macOS CoreML fp16 | 0.996967 | 0.992700 | 200 |
| 448 | PyTorch fp32 ↔ macOS CoreML int8 | 0.995966 | 0.990785 | 200 |
| 448 | PyTorch fakequant fp16 ↔ macOS CoreML int8 | 0.996978 | 0.992746 | 200 |
| 448 | PyTorch fakequant fp16 ↔ iPhone CoreML int8 | 0.996978 | 0.992746 | 200 |
| 512 | PyTorch fp32 ↔ fakequant fp16 | 0.998920 | 0.998140 | 200 |
| 512 | PyTorch fp32 ↔ macOS CoreML fp16 | 0.997007 | 0.993080 | 200 |
| 512 | PyTorch fp32 ↔ macOS CoreML int8 | 0.996012 | 0.991329 | 200 |
| 512 | PyTorch fp32 ↔ macOS CoreML 4-bit | 0.740254 | 0.158753 | 200 |
| 512 | PyTorch fakequant fp16 ↔ macOS CoreML int8 | 0.997011 | 0.992918 | 200 |
| 512 | PyTorch fakequant fp16 ↔ iPhone CoreML int8 | 0.997011 | 0.992918 | 200 |

The iPhone int8 outputs equal the macOS `CPU_AND_NE` outputs on all 200 images
at both resolutions. Earlier 26-image 512/fp16 All and 512/4-bit iPhone runs also
matched their corresponding macOS outputs exactly; the 4-bit result was the same
with All and CPU + NE. Those earlier 4-bit phone runs had mean/minimum cosine
0.760775 / 0.530246 against fp32. All measured vectors are finite and nonzero. The tested 4-bit package takes approximately 67 ms
on iPhone, providing no prediction-speed advantage over int8 while substantially
degrading numerical agreement.
For int8, minimum cosine exceeds 0.99 at both resolutions. MPS is a local GPU proxy;
**CUDA/Nebius drift is not measured** and must be verified before a real index
build. Full CPU fp16 and CPU fp16 autocast both produced NaNs on the initial
smoke-test image; the first observed nonfinite Linear output was block 1's
attention projection.
MPS fp16 and autocast were finite. This is a measured execution-backend
difference, not evidence that CUDA will behave the same way.

At each resolution, all query variants search the **same 2,000-image index**,
embedded once with the recovered int8 weights in MPS fp16. Agreement@1 measures
whether a variant selects the same neighbor as the PyTorch fp32 query:

| Query variant | 448 agreement@1 | 512 agreement@1 |
| --- | ---: | ---: |
| PyTorch fakequant fp16 | 96.0% | 95.5% |
| macOS CoreML fp16 | 93.0% | 93.5% |
| macOS CoreML int8 | 93.0% | 94.5% |
| iPhone CoreML int8 | 93.0% | 94.5% |
| macOS CoreML 4-bit | Not exported | 25.0% |

At 512, int8 changes the top neighbor for 11 of 200 queries; at 448, it changes
14. These are numerical disagreements on this mini-index, not measured errors
against recognition labels. The fp16 result also uses the fixed fakequant index,
so the table does not establish that int8 has better ground-truth recall.

| Evaluation coverage | Result |
| --- | --- |
| All 200 calibration images | Measured at 448 and 512; int8 minimum cosine exceeds 0.99 |
| At least 50 on-device reference images | All 200 calibration images exported at both resolutions |
| Agreement@1 on a disjoint 2,000-image mini-index | Measured at both resolutions; 512/int8 reaches 94.5% |
| True recognition recall on museum captures | Not measured: this spike compares numerical agreement |

The committed [iPhone embeddings](../../spikes/coreml-export/calibration/iphone-embeddings.json)
and [reference report](../../spikes/coreml-export/calibration/iphone-report.json)
are the **200-image, 512/int8, CPU_AND_NE** reference. Plan 02.04 can reuse
these calibration inputs and the accepted recipe. Its build hardware must
still pass the CUDA drift check.

## Exact fake-quant recipe

[export.py:quantize](../../spikes/coreml-export/export.py) compresses the 53
exported two-dimensional Linear weights with coremltools 9.0's
`OpLinearQuantizerConfig(mode="linear_symmetric", dtype="int8", granularity="per_channel")`.
It maps each fp16 CoreML constant to its original PyTorch parameter and checks
equality before compression. Positional weights, biases, normalization and other
constants remain fp16. This narrower scope is intentional: quantizing every
converted constant would include transformed positional tensors that are not
interchangeable with the original PyTorch state.

The index checkpoint is reconstructed from CoreML's actual
`constexpr_affine_dequantize` output, then stored as float32 tensors in
`artifacts/fakequant_state.pt`. This preserves fp16 scale/materialization
rounding; applying `round(w / s) * s` independently to fp32 source weights is not
the same recipe. The exporter verifies identical states at 448 and 512.
The [quantization test](../../spikes/coreml-export/export.test.py) checks signed
int8 storage, output-channel axis, zero point and recovered weight equality.
See Apple's [compression API](https://apple.github.io/coremltools/docs-guides/source/opt-quantization-api.html).

## Consequences and open questions

- Keep `embeddingDim=1536` and `inputSize=512`. `shared/model-version.json` does
  not exist yet; this spike does not create it because the assumed numbers are
  unchanged. Plan 01.03 owns that file.
- The model version string identifies this source, head,
  53-weight quantization scope and preprocessing. A changed recipe needs a new
  version before building any vectors.
- Choose 512/int8: it meets the measured latency/drift bounds and preserves
  the model's preferred resolution. The 448/int8 variant is faster; its numerical
  top-1 agreement is 93.0% versus 94.5% at 512 on this sample. The effect of
  resolution on recognition recall remains unmeasured.
- Loading exceeds plan 03.03's 1.5-second warm-up target before warm-up
  predictions are included. Investigate startup loading on the chosen device
  baseline; do not promise immediate readiness from these latency numbers.
- The 119.5 MB int8 package leaves less headroom for the whole-app size target
  than the design's ~90 MB estimate. App Store compression and whole-app size
  are not measured by this spike.
- Reject this 4-bit recipe; do not use its smaller package to solve app size.
- Plans 02.04 and 03.03 can use this export recipe and reference set. Verify
  CUDA drift on the index job hardware and camera preprocessing on device;
  this spike used identical prepared pixels for its numerical comparisons.

## Verification

- Twenty-seven focused Python tests pass; the pinned Python environment is consistent.
- Both 448 and 512 real-model shape checks pass; all five real CoreML models
  return finite, nonzero outputs on 200 images. Int8 passes the 0.99 drift gate;
  the tested 4-bit recipe fails. Both 2,000-image retrieval evaluations completed.
- The committed sets contain exactly 200 + 2,000 disjoint, unique paintings,
  and all 2,200 downloaded-image hashes match the manifest. The preparation
  command was also run against the complete committed lists.
- BenchApp builds for iOS in Release, signs, installs, and runs on the physical
  iPhone in light mode. Product Expo code is unchanged; `npm run ios` launches
  the unrelated starter app, so verification uses this native benchmark.
- After integrating plan 01.01, `npx tsc --noEmit`, `npm run lint`, and
  `npm run test:app -- --runInBand` pass; `npm run test:convex` exits successfully
  with no tests present. The spike's pytest runner remains separate from the
  app-wide verification baseline.
- Weights, downloaded images, Python environment and generated native build
  output are ignored; the diff and referenced local paths were checked.

# 001 Embedding model export

Date: 2026-09-08 · Status: **provisional; full calibration and retrieval gate blocked**

## Decision

Retain **512 × 512 input, 1,536-dimensional DINOv2 adaptor summary, symmetric
per-channel int8 Linear weights and fp16 compute** as the candidate for the next
stage. Candidate `modelVersion`: **`c-radiov3-b-int8-512-dinov2-v1`**.
This is not approval to build the full index or claim the full accuracy gate passed.

On the available iPhone 16 Pro, the 512/int8 package predicts in about **66 ms**
with `CPU_AND_NE`. Its minimum cosine against PyTorch with the recovered weights
is **0.99475** on **26** paintings. Loading costs approximately **3.5–3.8 seconds**.
Reject the tested 4-bit palette: its mean cosine against fp32 is approximately
**0.761**, far below the drift target. Other 4-bit recipes were not investigated.

The Met API returned HTTP 403 after 26 usable images. Consequently, the required
200-image calibration and 2,000-image nearest-neighbor comparison remain
unmeasured. This subset supports a provisional choice, not a recall conclusion.

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
package accepts only its declared resolution. The 26-image macOS runs returned
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
| 512 | fp16 | CPU + NE | 70.09 | 4383 | 261.4 / 272.5 | 2 / 442 |
| 512 | int8 | All | 65.86 | 3521 | 249.8 / 257.8 | 2 / 442 |
| 512 | int8 | CPU + NE | 65.85 | 3812 | 168.6 / 180.1 | 2 / 442 |
| 512 | fp16 | All | Not measured: device relocked during run | — | — | — |
| 512 | int4 | Both | Not measured: device locked before these cases | — | — | — |

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

The [URL list](../../spikes/coreml-export/calibration/urls.txt) and
[manifest](../../spikes/coreml-export/calibration/manifest.json) contain 26 unique
Met paintings with `isPublicDomain=true`. Filtering also checks painting
classification and deduplicates downloaded bytes. The
[Met API](https://metmuseum.github.io/) supplies `primaryImageSmall` and the
public-domain flag. Full collection stopped on access refusal; no replacement
dataset was silently substituted.

The reference comparison is PyTorch **MPS** fp32 versus MPS fp16 with the actual
CoreML-dequantized weights. Here fp32 describes execution after loading the
published half-precision checkpoint, not recovery of original training weights.
Every runtime receives the same bicubic-resized,
centered black letterbox pixels. The iPhone validates raw RGB bytes by SHA-256;
the future camera preprocessing path is not covered.

| Input | Compared pair | Mean cosine | Minimum cosine | Images |
| --- | --- | ---: | ---: | ---: |
| 448 | PyTorch fp32 ↔ fakequant fp16 | 0.998867 | 0.998191 | 26 |
| 448 | PyTorch fp32 ↔ macOS CoreML fp16 | 0.996820 | 0.995000 | 26 |
| 448 | PyTorch fp32 ↔ macOS CoreML int8 | 0.995733 | 0.993348 | 26 |
| 448 | PyTorch fakequant fp16 ↔ macOS CoreML int8 | 0.996814 | 0.994915 | 26 |
| 448 | PyTorch fakequant fp16 ↔ iPhone CoreML int8 | 0.996814 | 0.994915 | 26 |
| 512 | PyTorch fp32 ↔ fakequant fp16 | 0.998870 | 0.998242 | 26 |
| 512 | PyTorch fp32 ↔ macOS CoreML fp16 | 0.996842 | 0.994606 | 26 |
| 512 | PyTorch fp32 ↔ macOS CoreML int8 | 0.995795 | 0.993510 | 26 |
| 512 | PyTorch fp32 ↔ macOS CoreML 4-bit | 0.760775 | 0.530246 | 26 |
| 512 | PyTorch fakequant fp16 ↔ macOS CoreML int8 | 0.996845 | 0.994753 | 26 |
| 512 | PyTorch fakequant fp16 ↔ iPhone CoreML int8 | 0.996845 | 0.994753 | 26 |

The iPhone int8 outputs equal the macOS `CPU_AND_NE` outputs on this subset.
Minimum cosine exceeds 0.99 at both resolutions. MPS is a local GPU proxy;
**CUDA/Nebius drift is not measured** and must be verified before a real index
build. Full CPU fp16 and CPU fp16 autocast both produced NaNs on the first image;
the first observed nonfinite Linear output was block 1's attention projection.
MPS fp16 and autocast were finite. This is a measured execution-backend
difference, not evidence that CUDA will behave the same way.

| Required larger evaluation | Result |
| --- | --- |
| All 200 calibration images | Not measured: Met API HTTP 403; only 26 cached valid images |
| At least 50 on-device reference images | Not measured at required count: all 26 available images were exported |
| Agreement@1 on a disjoint 2,000-image mini-index | Not measured: collection blocked before the index set existed |
| True recognition recall on museum captures | Not measured: this spike compares numerical agreement |

The committed [iPhone embeddings](../../spikes/coreml-export/calibration/iphone-embeddings.json)
and [reference report](../../spikes/coreml-export/calibration/iphone-report.json)
are explicitly this **26-image, 512/int8, CPU_AND_NE** run. They do not fulfill
plan 02.04's 200-image input requirement.

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
- The tested candidate's version string is reserved for this source, head,
  53-weight quantization scope and preprocessing. A changed recipe needs a new
  version before building any vectors.
- Prefer 512/int8 provisionally: it meets the measured latency/drift bounds and
  preserves the model's preferred resolution. The 448/int8 variant is faster,
  but its retrieval tradeoff is unknown without the larger evaluation.
- Loading exceeds plan 03.03's 1.5-second warm-up target before warm-up
  predictions are included. Investigate startup loading on the chosen device
  baseline; do not promise immediate readiness from these latency numbers.
- The 119.5 MB int8 package leaves less headroom for the whole-app size target
  than the design's ~90 MB estimate. App Store compression and whole-app size
  are not measured by this spike.
- Reject this 4-bit recipe; do not use its smaller package to solve app size.
- Resume the 200 + 2,000 Met collection when authorized API access works, rerun
  both sizes and the device references, then decide whether the candidate can
  be accepted. The spike is recorded as blocked until that evidence exists.

## Verification

- Nine focused Python tests pass; the pinned Python environment is consistent.
- Both 448 and 512 real-model shape checks pass; all five real CoreML models
  pass the 26-image finite-output/drift check on macOS.
- BenchApp builds for iOS in Release, signs, installs, and runs on the physical
  iPhone in light mode. Product Expo code is unchanged; `npm run ios` launches
  the unrelated starter app, so verification uses this native benchmark.
- `npx tsc --noEmit` fails on pre-existing CSS declarations in
  `src/components/animated-icon.web.tsx` and `src/constants/theme.ts`; neither
  file was changed. ESLint is not configured, so lint was not run. The spike's
  isolated pytest runner does not establish the app-wide plan 01.01 baseline.
- Weights, downloaded images, Python environment and generated native build
  output are ignored; the diff and referenced local paths were checked.

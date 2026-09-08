# Spike 00.01: Export C-RADIOv3-B (DINOv2 summary head) to CoreML and measure it on the Neural Engine

> **Executor instructions**: This is a time-boxed investigation (2 days). Its
> deliverable is a decision record, not product code. Follow the steps, record
> numbers as you go, and stop at the time box even if questions remain — an
> honest "unknown" is a valid answer. When done, update the status row in
> `docs/plans/README.md`.
>
> **Drift check**: `ls docs/decisions/001-embedding-model-export.md` must not exist.

## Status

- **Execution (2026-09-08)**: IN PROGRESS. See
  [decision 001](../../decisions/001-embedding-model-export.md): five exports,
  all ten physical iPhone benchmark configurations, and full 200-image Mac/iPhone
  drift at both resolutions measured. The int8 drift gate passes. Paced,
  resumable Met collection is downloading the disjoint 2,000-image index for
  the remaining nearest-neighbor comparison.
- **Priority**: P0 (gates 03.03 and 02.04; also fixes `embeddingDim`/`inputSize`)
- **Effort**: M (2 days)
- **Risk**: MED (export may hit unsupported ops; ANE may reject parts of the graph)
- **Depends on**: none (a physical iPhone and a Mac with Xcode 26 are required)
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

The whole identification path assumes the phone embeds every scan with C-RADIOv3-B on the Neural Engine in ~0.1–0.3 s using the same numerics as the index build (design §4.1 step 2, §5.1, §5.7, §11 "phone and index embeddings drift apart"). Nobody has exported this model yet. If the export fails, is slow, or drifts from the PyTorch build, the design's model choice, input size, or quantization changes before any index is built.

## Facts established during planning (verified 2026-09-08)

- `nvidia/C-RADIOv3-B` on Hugging Face: 98.3M parameters, NVIDIA Open Model License (commercial use permitted), `model.safetensors` (fp32 backbone, **no adaptor heads**), `c-radio_v3-b_half.pth.tar` (546 MB, contains `_heads.dino_v2` and `_feature_projections.dino_v2`). Load with adaptors via `torch.hub.load('NVlabs/RADIO', 'radio_model', version='c-radio_v3-b', adaptor_names=['dino_v2'])`.
- Dimensions: backbone summary = **2304** (three 768-wide teacher CLS tokens concatenated via `summary_idxs`); DINOv2 adaptor summary = **1536**; spatial features 768. Adaptor input is the single DINOv2 CLS token, not the 2304 concat. Use the adaptor summary (1536); it is the instance-retrieval head the design wants and is smaller than the backbone summary.
- Input: 0–1 RGB floats, normalization is internal (`InputConditioner`, OpenAI-CLIP mean/std); `preferred_resolution` 512×512; H/W must be multiples of 16; `pos_embed` is interpolated at run time from a 128×128 grid.
- coremltools 9.0: `torch.jit.trace` path is the mature one; `ct.convert(traced, convert_to="mlprogram", compute_precision=ct.precision.FLOAT16, inputs=[ct.ImageType(name="image", shape=(1,3,S,S), scale=1/255.0, bias=[0,0,0], color_layout=ct.colorlayout.RGB)], minimum_deployment_target=ct.target.iOS17)`; int8 weights via `cto.coreml.linear_quantize_weights(mlmodel, OptimizationConfig(global_config=OpLinearQuantizerConfig(mode="linear_symmetric", dtype="int8", granularity="per_channel")))`; 4-bit via `palettize_weights`. Dict outputs are untraceable — wrap the model to return a tensor.
- Sizes: fp16 ≈ 197 MB, int8 ≈ 98 MB, 4-bit ≈ 49 MB (+LUTs).
- Measuring ANE: Xcode → open the `.mlpackage` → Performance tab → pick the connected device and compute units (reports median latency and per-op unit assignment); or `MLComputePlan` (iOS 17.4+) programmatically.
- No int8 checkpoint is published. "The int8 weights the phone runs" therefore means **our** per-channel symmetric int8 quantization; the index build must apply the identical fake-quantization to the PyTorch weights (`w_q = round(w / s) * s`, per output channel) before embedding, so both sides share numerics. The drift check validates this.

## Questions to answer

1. Does the traced DINOv2-adaptor wrapper convert cleanly to an ML Program at 448 and 512? Which ops, if any, fall back to CPU/GPU on device?
2. Neural Engine latency (median of 50 after warm-up) at 448 and 512, fp16 weights vs int8 weights, on every iPhone you can borrow (target iPhone 12 through 16); load time; peak memory while loaded.
3. Recall cost of int8 and 4-bit: cosine similarity between CoreML output and PyTorch fp32 output on 200 calibration images; nearest-neighbor agreement@1 on a 2,000-image mini-index (does the top-1 change?).
4. Drift between the CoreML model (int8 weights, fp16 compute) and PyTorch with fake-quantized weights in fp16: cosine ≥ 0.99 on the 200-image set?
5. Final `modelVersion` string, `inputSize`, `embeddingDim`, and the exact reproducible export commands for plan 03.03.

## Method

Work under `spikes/coreml-export/` (commit the scripts; never commit weights or `.mlpackage` — add `spikes/**/artifacts/` to `.gitignore`).

### Step 1: Environment and model load

`uv venv && uv pip install torch torchvision timm coremltools==9.0 huggingface_hub numpy pillow`. Load with `torch.hub.load(..., adaptor_names=['dino_v2'])`; write `wrapper.py`:

```python
class DinoSummary(torch.nn.Module):
    def __init__(self, radio): super().__init__(); self.radio = radio
    def forward(self, x):            # x: (1,3,S,S) in 0..1
        out = self.radio(x)          # dict when adaptors are set
        return out['dino_v2'].summary  # (1, 1536)
```

Assert the output shape is `(1, 1536)` at 512 and 448. Record load time and parameter count.

**Verify**: `python -c "from wrapper import build; m=build(); print(m(torch.rand(1,3,512,512)).shape)"` → `torch.Size([1, 1536])`.

### Step 2: Export (fp16) and quantize (int8, 4-bit)

`export.py --size 512 --precision fp16 | --weights int8 | --weights int4` producing `artifacts/cradio-v3b-dino-{size}-{variant}.mlpackage`. Also produce `fakequant_state.pt`: the per-channel int8-quantized weights round-tripped back to fp32 (the job in plan 02.04 will load this). Record model file sizes.

**Verify**: three `.mlpackage` bundles exist for 512 (and fp16+int8 for 448); `coremltools`'s `MLModelValidator`/`MLModelComparator` reports no NaN outputs.

### Step 3: On-device latency and memory

Open each `.mlpackage` in Xcode; run the Performance report on each connected iPhone with compute units `All` and `CPU and Neural Engine`. Record median prediction time, load time, and per-op unit assignment (count ops not on ANE). Separately, build the tiny Swift test app in `spikes/coreml-export/BenchApp/` (one screen: load model, run 50 predictions on a bundled image, print median and `mach_task_basic_info` resident size) to confirm numbers outside Xcode's harness.

**Verify**: a table `device × size × variant → latency ms, load ms, memory MB, ops-not-on-ANE`.

### Step 4: Accuracy and drift

`calibration/` = 200 public-domain painting images (Met CC0 `primaryImageSmall` URLs listed in `calibration/urls.txt`; download at run time, do not commit images). `drift_check.py`: embeds with (a) PyTorch fp32, (b) PyTorch fp16 with fake-quantized int8 weights, (c) CoreML int8 (run via `coremltools` on macOS with `compute_units=CPU_AND_NE` — note macOS ANE ≠ iPhone ANE; also run on-device via the BenchApp exporting embeddings as JSON for 50 images). Report mean/min cosine for each pair and top-1 agreement on the 2,000-image mini-index (2,000 more Met images, embedded once with (b)).

**Verify**: numbers for cos(a,b), cos(b,c-mac), cos(b,c-iphone); top-1 agreement %.

### Step 5: Decision record

Write `docs/decisions/001-embedding-model-export.md`:

```
# 001 Embedding model export
Date · Status: accepted
## Decision
inputSize=…, embeddingDim=1536, weights=int8 per-channel symmetric, compute=fp16, modelVersion="…"
## Evidence (tables from steps 2–4)
## Consequences
- shared/model-version.json values; whether 4-bit is viable; devices below the latency bar
- The fake-quant recipe the index build must apply (file + function name)
## Open questions
```

Update `shared/model-version.json` **only if** the numbers differ from `1536 / 512` (plan 01.03 already assumes those); if you change them, say so in the record and in `docs/plans/README.md`.

## Done criteria

- [x] `docs/decisions/001-embedding-model-export.md` exists with every table filled or marked "not measured (reason)"
- [x] `spikes/coreml-export/{wrapper.py,export.py,drift_check.py,README.md}` committed; artifacts ignored
- [x] Reproducible export command recorded (used verbatim by plan 03.03)
- [x] Drift cosine between PyTorch-fakequant and on-device CoreML reported; if < 0.99, the record names the mitigation tried (fp16-only weights, per-tensor vs per-channel, 448 vs 512)
- [x] `docs/plans/README.md` status row updated

## STOP conditions

- No physical iPhone available — report; Xcode's macOS ANE numbers are not a substitute for the decision (record them as provisional).
- `torch.hub.load` cannot fetch the `.pth.tar` (auth or network) — report.
- Conversion fails on an op after trying both `torch.jit.trace` and `torch.export` — report the op name; do not rewrite the model.

## Maintenance notes

- Any change to `inputSize`, quantization, or head invalidates the whole index: the record's `modelVersion` string must change with it (plan 02.08 is the migration path).
- Keep the calibration URL list; plan 02.04 reuses it as the per-build drift check.

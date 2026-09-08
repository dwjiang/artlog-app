# Plan 02.04: The GPU build job — scratch download, C-RADIOv3-B embedding with the phone's numerics, ORB extraction, drift check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/download.py jobs/artlog_jobs/embed.py jobs/artlog_jobs/drift_check.py jobs/artlog_jobs/build_index.py`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (numerics must match the phone; downloads are the slow, flaky part)
- **Depends on**: 02.01, 02.03; `docs/decisions/001-embedding-model-export.md` (spike 00.01: fake-quant recipe, calibration set, CoreML reference embeddings)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.7 steps 3–4: images are streamed through a scratch bucket that dies with the run, embedded with **the phone's weights** (the int8 checkpoint the CoreML export was made from, dequantized to fp16) at the fixed input size and letterbox, ORB descriptors extracted from the same letterboxed input, `keypointCount` recorded, and a drift check against on-device embeddings gates every run. No image outlives the build (§5.5).

## Current state

- `jobs/` has `letterbox.py`, `orb.py`, `model_version.py`, `PoliteClient`, checkpoints (02.01); `metadata/*.jsonl` from 02.03 in scratch.
- Spike 00.01 produced: `spikes/coreml-export/{wrapper.py,export.py}`, the fake-quantization recipe (`fakequant_state.pt`: per-channel symmetric int8 round-tripped weights), `calibration/urls.txt` (200 Met CC0 images) and on-device reference embeddings `calibration/iphone-embeddings.json` (`{ url: [1536 floats] }`) exported by its bench app.
- Verified model facts: load via `torch.hub.load('NVlabs/RADIO', 'radio_model', version='c-radio_v3-b', adaptor_names=['dino_v2'])`; call returns a dict; `out['dino_v2'].summary` is `(B, 1536)`; input 0–1 RGB, normalization internal; input size from `shared/model-version.json` (512) is a multiple of 16.
- Rate limits: Met CDN — keep ≤ 20 req/s; AIC IIIF — 1 req/s, `AIC-User-Agent` header; Commons — ≤ 2 concurrent, ≥ 1 s spacing, standard sizes only for thumbs but originals via `Special:FilePath` (originals can be large: cap at 1024 px after download; prefer `?width=1280` thumbs, a standard size, to save bandwidth).
- Nebius: `gpu-l40s-a 1gpu-8vcpu-32gb`, eu-north1, scratch via `--volume s3://artlog-scratch:/mnt/scratch:rw`, lifecycle expiry 3 days (spike 00.08).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Download | `uv run python -m artlog_jobs.download --metadata $SCRATCH_DIR/metadata --out $SCRATCH_DIR/images` | resumable; progress log |
| Drift check | `uv run python -m artlog_jobs.drift_check --reference calibration/iphone-embeddings.json` | prints mean/min cosine; exit 0 iff ≥ 0.99/0.97 |
| Embed | `uv run python -m artlog_jobs.embed --images $SCRATCH_DIR/images --out $SCRATCH_DIR/features` | `vectors-*.npy`, `descriptors-*.bin`, `manifest.json` |
| Whole build | `jobs/scripts/launch-job.sh artlog_jobs.build_index --gpu -- --stage download,drift,embed` | job completes |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/download_test.py artlog_jobs/embed_test.py artlog_jobs/drift_check_test.py` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/{download,model,embed,drift_check,build_index}.py` (+ tests), `jobs/calibration/` (copy `urls.txt` and the iPhone reference JSON from the spike), `jobs/README.md` (build runbook section).

**Out of scope**: dedup/hub/push (02.05); the CoreML export itself (03.03 scripts it from the spike); any change to `letterbox.py`/`orb.py` (if they need to change, STOP — the phone side must change too).

## Steps

### Step 1: Download to scratch, per-source checkpoints

`download.py`: reads `objects.jsonl`; per source a `PoliteClient` with the limits above; saves `images/<objectKey>.jpg` resized to ≤ 1024 px long side (JPEG q90) — never the original; checkpoint per source (`done`, `failed` with reason); retries 3× with backoff; a `--limit N` for smoke runs. Dead links are recorded in `failed.jsonl` (they become objects without vectors; 02.05 skips them).

**Verify**: `download_test.py` with a local HTTP fixture server: resize, checkpoint resume after a simulated crash, 429 handling. Smoke: `--limit 50` on Nebius CPU writes 50 files.

### Step 2: Model loader with the phone's numerics

`model.py`: `load_embedder(fakequant_state_path) -> Embedder` — `torch.hub.load(... adaptor_names=['dino_v2'])`, load `fakequant_state.pt` into the backbone (`load_state_dict(strict=False)`; assert every quantized tensor name matched), `.half().cuda().eval()`; `Embedder.embed(batch: Tensor[B,3,S,S] in 0..1) -> np.ndarray[B,1536] float32` (L2-normalized). Batch size 64 (128 if memory allows).

**Verify**: `embed_test.py` (CPU, tiny input, `fakequant` fixture with two tensors) asserts shape and normalization; a GPU smoke on Nebius prints throughput (images/s).

### Step 3: Drift check (gates every build)

`drift_check.py`: downloads the 200 calibration URLs (cached in scratch), letterboxes, embeds with the job model, compares to the iPhone reference vectors: mean and min cosine; prints a table of the 5 worst; exit non-zero below `--min-mean 0.99 --min-min 0.97`. `build_index.py` runs it before the embed stage and aborts on failure.

**Verify**: `drift_check_test.py` with synthetic vectors; a real run prints ≥ 0.99 mean (if not, STOP).

### Step 4: Embed and extract

`embed.py`: for each downloaded image: `letterbox(img, INPUT_SIZE)` → tensor; also grayscale of the letterboxed image → `extract_orb(gray, ORB_MAX_KEYPOINTS)`; write shards of 10,000: `vectors-<n>.npy` (float32 [N,1536]) + `keys-<n>.json`, `descriptors-<n>.bin` (concatenated wire-format records with an index JSON: `{ key, offsets, count, keypointCount }`); `manifest.json` `{ modelVersion, inputSize, embeddingDim, orbMaxKeypoints, counts, startedAt, finishedAt, driftCheck }`. GPU time is not the bottleneck; keep image decoding on a `DataLoader` with 6 workers.

**Verify**: smoke run of 500 images on Nebius GPU produces one shard; `keypointCount` distribution logged (median ≥ 200 expected for paintings).

### Step 5: Build runbook

`jobs/README.md` "Index build" section: the exact `launch-job.sh` invocation, expected durations at the counts from `docs/decisions/005-data-sources.md`, the cost estimate (L40S $1.55/h), where the scratch bucket lives and that it expires, and the statement that images are never copied out of scratch.

**Verify**: a full run (or the largest run the operator approves) completes; `manifest.json` recorded in the README.

## Test plan

`download_test.py`, `embed_test.py`, `drift_check_test.py`, `build_index_test.py` (stage ordering, abort on drift failure).

## Done criteria

- [ ] `uv run pytest -q` passes; `ruff` clean
- [ ] Drift check ≥ 0.99 mean / ≥ 0.97 min on the real run (numbers in `jobs/README.md`)
- [ ] `manifest.json` from the full run has `modelVersion === shared/model-version.json.modelVersion`
- [ ] `grep -rn "images/" jobs/artlog_jobs/push.py` → no reads of image files outside `download.py`/`embed.py` (images stay in scratch)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- Spike 00.01's fake-quant recipe or iPhone reference embeddings are missing — do not invent a recipe; report.
- Drift below thresholds after checking letterbox parity (compare a letterboxed PNG from the phone bench app with the Python output pixel-wise) — report with the pixel diff.
- Commons or Met rate-limit the run (persistent 429/403) — halve the rate, report the effective throughput.

## Maintenance notes

- Any change to `shared/model-version.json` requires a new full run (or plan 02.08's reembed).
- Keep the calibration set and the iPhone reference vectors versioned with the model; regenerate the reference whenever the CoreML export changes (plan 03.03).

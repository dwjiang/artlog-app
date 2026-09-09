# Plan 02.04: The local build job — sharded download to scratch, C-RADIOv3-B embedding on Apple silicon with the phone's numerics, ORB extraction, drift check

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
- **Risk**: MED (numerics must match the phone — now across MPS fp16 rather than CUDA fp16; downloads are the slow, flaky part and run at polite rates from one laptop)
- **Depends on**: 02.01, 02.03; `docs/decisions/001-embedding-model-export.md` (spike 00.01: fake-quant recipe, calibration set, CoreML reference embeddings)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.7 steps 3–4: images are streamed through a scratch bucket that dies with the run, embedded with **the phone's weights** (the int8 checkpoint the CoreML export was made from, dequantized to fp16) at the fixed input size and letterbox, ORB descriptors extracted from the same letterboxed input, `keypointCount` recorded, and a drift check against on-device embeddings gates every run. No image outlives the build (§5.5). **Where it runs (decided 2026-09-08)**: on the operator's Mac — Apple M5 Pro, 64 GB RAM, PyTorch on the MPS backend — not on a Nebius L40S; the Nebius tenant is suspended and cloud jobs are optional for the hackathon (`docs/plans/README.md`, "Decisions made while planning"). The design's "scratch bucket" becomes a local scratch directory processed shard by shard so images are deleted as soon as their shard is embedded; the drift check is what makes the change safe.

## Current state

- `jobs/` has `letterbox.py`, `orb.py`, `model_version.py`, `PoliteClient`, checkpoints (02.01); `metadata/*.jsonl` from 02.03 in scratch.
- Spike 00.01 produced: `spikes/coreml-export/{wrapper.py,export.py}`, the fake-quantization recipe (`fakequant_state.pt`: per-channel symmetric int8 round-tripped weights), `calibration/urls.txt` (200 Met CC0 images) and on-device reference embeddings `calibration/iphone-embeddings.json` (`{ url: [1536 floats] }`) exported by its bench app.
- Verified model facts: load via `torch.hub.load('NVlabs/RADIO', 'radio_model', version='c-radio_v3-b', adaptor_names=['dino_v2'])`; call returns a dict; `out['dino_v2'].summary` is `(B, 1536)`; input 0–1 RGB, normalization internal; input size from `shared/model-version.json` (512) is a multiple of 16.
- Rate limits: Met CDN — keep ≤ 20 req/s; AIC IIIF — 1 req/s, `AIC-User-Agent` header; Commons — ≤ 2 concurrent, ≥ 1 s spacing, standard sizes only for thumbs but originals via `Special:FilePath` (originals can be large: cap at 1024 px after download; prefer `?width=1280` thumbs, a standard size, to save bandwidth).
- Local machine (verified 2026-09-08): Apple M5 Pro, 64 GB unified memory, 1.3 TiB free disk, PyTorch 2.14 with `mps` available and fp16 matmul working; `settings.device` from 02.01 resolves to `mps`. `SCRATCH_DIR` defaults to `jobs/scratch` (gitignored). Per-object feature size ≈ 6 KB vector + ≤ 16 KB descriptors + ≤ 8 KB keypoints, so 300k objects ≈ 9 GB of features; a 10,000-image shard at ≤ 1024 px is ~2–3 GB of JPEGs and is deleted once embedded.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Download one shard | `uv run python -m artlog_jobs.download --metadata $SCRATCH_DIR/metadata --shard 0 --out $SCRATCH_DIR/images` | resumable; progress log |
| Drift check | `uv run python -m artlog_jobs.drift_check --reference calibration/iphone-embeddings.json` | prints mean/min cosine; exit 0 iff ≥ 0.99/0.97 |
| Embed one shard | `uv run python -m artlog_jobs.embed --images $SCRATCH_DIR/images/shard-0 --out $SCRATCH_DIR/features` | `vectors-0.npy`, `descriptors-0.bin`, `manifest.json` updated |
| Pilot (1,000 objects) | `caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed --limit 1000` | completes; prints images/s and the projected full-run time |
| Whole build | `caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed` | completes over one or more nights; resumable |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/download_test.py artlog_jobs/embed_test.py artlog_jobs/drift_check_test.py` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/{download,model,embed,drift_check,build_index}.py` (+ tests), `jobs/calibration/` (copy `urls.txt` and the iPhone reference JSON from the spike), `jobs/README.md` (build runbook section).

**Out of scope**: dedup/hub/push (02.05); the CoreML export itself (03.03 scripts it from the spike); any change to `letterbox.py`/`orb.py` (if they need to change, STOP — the phone side must change too).

## Steps

### Step 1: Download to scratch, per-source checkpoints

`download.py`: reads `objects.jsonl`, orders objects deterministically and splits them into shards of 10,000 (`--shard N`, or all shards in order); per source a `PoliteClient` with the limits above, sources fetched concurrently with each other so the slow Commons queue does not hold up the Met; saves `images/shard-<n>/<objectKey>.jpg` resized to ≤ 1024 px long side (JPEG q90) — never the original; checkpoint per shard and source (`done`, `failed` with reason); retries 3× with backoff; a `--limit N` for smoke runs. Dead links are recorded in `failed.jsonl` (they become objects without vectors; 02.05 skips them). At polite rates the download, not the GPU, sets the wall-clock: Commons at ~1–2 req/s means a day or more for a 200k-image layer, so the run must survive sleep/wake and restarts (checkpoints + `caffeinate -i`).

**Verify**: `download_test.py` with a local HTTP fixture server: resize, deterministic sharding, checkpoint resume after a simulated crash, 429 handling. Smoke: `--limit 50` on the Mac writes 50 files under `shard-0`.

### Step 2: Model loader with the phone's numerics

`model.py`: `load_embedder(fakequant_state_path, device=settings.device) -> Embedder` — `torch.hub.load(... adaptor_names=['dino_v2'])`, load `fakequant_state.pt` into the backbone (`load_state_dict(strict=False)`; assert every quantized tensor name matched), `.half().to(device).eval()`; `Embedder.embed(batch: Tensor[B,3,S,S] in 0..1) -> np.ndarray[B,1536] float32` (L2-normalized). Batch size 64 (128 if memory allows — 64 GB of unified memory should take it; measure). On `mps`: set `PYTORCH_ENABLE_MPS_FALLBACK=1` only if torch reports an unsupported op, and log which ops fell back to CPU; if fp16 on MPS produces NaNs or fails the drift check, try fp32 compute on MPS with the same fake-quantized weights (the phone's int8 numerics live in the weight values, not the compute dtype) and record which variant passed. Never hard-code `cuda`; plan 02.10 runs this same file on an L40S.

**Verify**: `embed_test.py` (CPU, tiny input, `fakequant` fixture with two tensors) asserts shape and normalization; `uv run python -m artlog_jobs.embed --benchmark 256` on the Mac prints images/s on `mps` (record it; it feeds the pilot's projection).

### Step 3: Drift check (gates every build)

`drift_check.py`: downloads the 200 calibration URLs (cached in scratch), letterboxes, embeds with the job model, compares to the iPhone reference vectors: mean and min cosine; prints a table of the 5 worst; exit non-zero below `--min-mean 0.99 --min-min 0.97`. `build_index.py` runs it before the embed stage and aborts on failure. This is the gate that makes the local build trustworthy: spike 00.01 compared PyTorch-fakequant with CoreML, this compares the Mac build path (MPS, the chosen dtype) with the iPhone's Neural Engine on the same 200 images. Record mean/min, device and dtype in `jobs/README.md`.

**Verify**: `drift_check_test.py` with synthetic vectors; a real run on `mps` prints ≥ 0.99 mean (if not, STOP).

### Step 4: Embed and extract

`embed.py`: for each image in a downloaded shard: `letterbox(img, INPUT_SIZE)` → tensor; also grayscale of the letterboxed image → `extract_orb(gray, ORB_MAX_KEYPOINTS)`; one feature shard per image shard: `vectors-<n>.npy` (float32 [N,1536]) + `keys-<n>.json`, `descriptors-<n>.bin` (concatenated wire-format records with an index JSON: `{ key, offsets, count, keypointCount }`); `manifest.json` `{ modelVersion, inputSize, embeddingDim, orbMaxKeypoints, device, dtype, counts, startedAt, finishedAt, driftCheck }`. Keep image decoding on a `DataLoader` with 6 workers (macOS uses the `spawn` start method: guard the entry point with `if __name__ == "__main__"`). `build_index.py` runs the pipeline **per shard** — download shard *n* → embed shard *n* → delete `images/shard-<n>/` — so at most one shard of JPEGs exists at a time and no image outlives its shard (§5.5); `--keep-images` exists only for debugging a pilot and is refused without `--limit`.

**Verify**: `build_index_test.py` proves the per-shard order and that the image directory is gone after a shard; a 500-image run on the Mac produces one feature shard and no `images/` residue; `keypointCount` distribution logged (median ≥ 200 expected for paintings).

### Step 5: The 1,000-object pilot

Run `caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed --limit 1000` (the limit is spread across Met, AIC and Wikidata by `download.py`'s deterministic order). Record: download rate per source (req/s achieved vs. the limit), embed throughput on `mps` (images/s), peak memory (`/usr/bin/time -l`), drift-check mean/min, and the projected wall-clock for the full counts from `docs/decisions/005-data-sources.md`, stated per source (download time dominates). Decide with the operator whether the full run proceeds on the Mac (the default) or whether plan 02.10 should be pulled forward for a cloud run — the projection, not the GPU speed, is the deciding number.

**Verify**: the pilot completes end to end with a feature shard for 1,000 objects, and its numbers are written to `jobs/README.md` under "Pilot 2026-…".

### Step 6: Build runbook

`jobs/README.md` "Index build" section: the exact local invocation (with `caffeinate -i`), how to resume after an interruption, expected durations from the pilot's projection at the counts from `docs/decisions/005-data-sources.md`, disk needed for features, where `SCRATCH_DIR` lives, that `build_index --stage cleanup` removes any leftover `images/` directory, and the statement that images are never copied out of scratch. Compute cost is $0; say so where the design (§10) estimated L40S time.

**Verify**: a full run (or the largest run the operator approves) completes; `manifest.json` recorded in the README.

## Test plan

`download_test.py`, `embed_test.py`, `drift_check_test.py`, `build_index_test.py` (stage ordering, per-shard image deletion, abort on drift failure).

## Done criteria

- [ ] `uv run pytest -q` passes; `ruff` clean
- [ ] Drift check ≥ 0.99 mean / ≥ 0.97 min on the real run on `mps` (numbers, device and dtype in `jobs/README.md`)
- [ ] Pilot numbers recorded; no `images/` directory remains under `SCRATCH_DIR` after the full run
- [ ] `manifest.json` from the full run has `modelVersion === shared/model-version.json.modelVersion`
- [ ] `grep -rn "images/" jobs/artlog_jobs/push.py` → no reads of image files outside `download.py`/`embed.py` (images stay in scratch)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- Spike 00.01's fake-quant recipe or iPhone reference embeddings are missing — do not invent a recipe; report.
- Drift below thresholds after checking letterbox parity (compare a letterboxed PNG from the phone bench app with the Python output pixel-wise) — report with the pixel diff.
- Commons or Met rate-limit the run (persistent 429/403) — halve the rate, report the effective throughput.
- `torch.hub.load` of the RADIO model fails on macOS or hard-requires CUDA — report the traceback; do not patch the upstream model code.
- The pilot projects more than ~5 days of wall-clock for the full run at polite rates — report with the per-source numbers; the operator decides between a longer local run, a reduced corpus, or pulling plan 02.10 forward.

## Maintenance notes

- Any change to `shared/model-version.json` requires a new full run (or plan 02.08's reembed).
- Keep the calibration set and the iPhone reference vectors versioned with the model; regenerate the reference whenever the CoreML export changes (plan 03.03).

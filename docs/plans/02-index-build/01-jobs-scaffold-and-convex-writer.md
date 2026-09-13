# Plan 02.01: Python jobs scaffold, the Convex ingest contract, and the local run entry point

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/ convex/ingest.ts shared/`
> If `jobs/` exists, STOP and reconcile.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `docs/plans/01-foundation/03-convex-project-and-schema.md`. Spike 00.08 is **not** a dependency any more: the Nebius containers and launcher moved to plan 02.10 (2026-09-08).
- **Category**: feature / dx
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Everything batch — the corpus build, the crawler, enrichment, re-embedding, calibrator training — is Python under `jobs/` that writes to Convex through the Python client and exits (design §5.2, §5.7). The initial build runs on the operator's Mac (Apple M5 Pro, 64 GB RAM, PyTorch on the MPS backend; decided 2026-09-08, see `docs/plans/README.md` "Decisions made while planning"); the same modules run unchanged inside Nebius Serverless AI job containers once plan 02.10 adds them. Those jobs share one project layout, one Convex writer with checkpointing, one letterbox function that must match the phone's, one ORB extractor in the wire format of plan 04.01, and one local run entry point. This plan builds that shared base so plans 02.02–02.09 only add job modules.

## Current state

- No `jobs/` directory. `convex/schema.ts` (plan 01.03) defines the tables; nothing writes to them yet.
- `shared/model/model-version.json`: `{ modelVersion, embeddingDim: 1536, inputSize: 512, orbMaxKeypoints: 500 }`.
- Wire format for ORB features (plan 04.01): `descriptors` = `count×32` bytes; `keypoints` = `count×4` little-endian float32 `[x, y, size, angle]` in letterboxed pixel space; `count ≤ 1000`.
- Verified platform facts (2026-09-08): Python client `pip install convex` (0.7.0): `ConvexClient(url)`, `client.set_admin_auth(deploy_key)`, `client.mutation("file:fn", args)`, `client.query(...)`; Python `bytes` ↔ `v.bytes()`, `float` ↔ `v.float64()`, `dict`/`list` ↔ object/array. Per-mutation limits: 16,000 documents / 16 MiB written, 16 MiB args; Pro write throughput 8 MiB/s. Local machine (verified 2026-09-08): Apple M5 Pro (6 performance + 12 efficiency cores), 64 GB unified memory, 1.3 TiB free disk, macOS 26.5, `uv` 0.12, no Docker; PyTorch 2.14 installed through `uv` reports `torch.backends.mps.is_available() == True` and an fp16 matmul on `mps` works. Python ≥ 3.12 comes from `uv` (the system `python3` is 3.9).
- `AGENTS.md`: kebab-case for new source files applies to app code; Python modules use snake_case (PEP 8). Tests co-located as `*_test.py`. Comments only for non-obvious reasons.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Python env | `cd jobs && uv sync` | `.venv` created |
| Job tests | `cd jobs && uv run pytest -q` | all pass |
| Lint/format | `cd jobs && uv run ruff check . && uv run ruff format --check .` | exit 0 |
| Convex push | `npx convex dev --once` | success |
| Convex tests | `npm run test:convex` | pass |
| Run a job locally | `cd jobs && uv run python -m artlog_jobs.<job> [args]` | job logs; exit 0 |
| Long local runs | `cd jobs && caffeinate -i uv run python -m artlog_jobs.<job> [args]` | the Mac does not idle-sleep mid-run |

## Scope

**In scope**: `jobs/pyproject.toml`, `jobs/uv.lock`, `jobs/README.md`, `jobs/artlog_jobs/{__init__,config,convex_writer,letterbox,orb,model_version,checkpoint,polite_http,smoke}.py` + `*_test.py`, `jobs/fixtures/` (a small CC0 test image and the ORB byte fixture), `convex/ingest.ts` + `convex/ingest.test.ts`, `.gitignore` (`jobs/.venv`, `jobs/out`, `jobs/checkpoints`, `jobs/scratch`), `.easignore` (`jobs/`), `shared/orb/fixtures/orb-features-v1.json`.

**Out of scope**: any real data source or model code (02.02–02.09); the crawler's Convex queue functions (04.05); Docker images, the Nebius launcher and any GitHub workflow (plan 02.10); secrets of any kind in files.

## Git workflow

- Commits: `build(jobs): scaffold python jobs project`, `feat(convex): add ingest mutations`, `feat(jobs): add convex writer and letterbox`, `feat(jobs): add smoke job and device selection`.

## Steps

### Step 1: Project scaffold

`jobs/pyproject.toml` (Python ≥ 3.12, `uv`): package `artlog_jobs`; deps `convex`, `httpx`, `pillow`, `numpy`, `opencv-python-headless`, `tenacity`, `pyyaml`, `pydantic`, `torch`, `torchvision`, `timm` (the model runs locally on MPS, so torch is a core dependency; `boto3` and the CUDA wheel index arrive with plan 02.10); dev: `pytest`, `ruff`. `jobs/artlog_jobs/config.py`: a pydantic `Settings` reading `CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `SCRATCH_DIR` (default `jobs/scratch`, resolved to an absolute path — a local directory on the Mac; plan 02.10 points it at the S3 mount inside containers), `DEVICE` (default: `mps` when `torch.backends.mps.is_available()`, else `cuda` when available, else `cpu`; exposed as `settings.device`), `USER_AGENT` (default `artlog-bot/0.1 (+https://github.com/<org>/artlog; mailto:<contact>)` — the contact value comes from env `CRAWLER_CONTACT`), `LOG_LEVEL`. `jobs/README.md`: how to run locally (`uv run python -m artlog_jobs.<job>`, under `caffeinate -i` for long runs), env var names, where `SCRATCH_DIR` lives and that a build deletes its images as it goes.

**Verify**: `cd jobs && uv sync && uv run python -c "import artlog_jobs"` → no error.

### Step 2: Shared image functions

`letterbox.py`: `letterbox(img: PIL.Image, size: int) -> PIL.Image` — convert to RGB; resize so the long side equals `size` using `Image.Resampling.BILINEAR`; paste centered onto a `size×size` canvas filled with the image's per-channel mean color (computed on the resized image); return. This is the specification the phone's Swift implementation (plan 03.02) must match: bilinear resize, centered, mean-color pad. `model_version.py`: loads `../shared/model/model-version.json` (path resolved relative to the repo root) and exposes `MODEL_VERSION`, `EMBEDDING_DIM`, `INPUT_SIZE`, `ORB_MAX_KEYPOINTS`.

`orb.py`: `extract_orb(img: np.ndarray (gray uint8, size×size), nfeatures=ORB_MAX_KEYPOINTS) -> OrbFeatures(descriptors: bytes, keypoints: bytes, count: int)` with `cv2.ORB_create(nfeatures=nfeatures)`; descriptors `des.tobytes()` (shape `(N,32)` uint8); keypoints packed with `np.array([[k.pt[0], k.pt[1], k.size, k.angle] for k in kps], dtype='<f4').tobytes()`; `count = 0` → both `b''`. Generate `shared/orb/fixtures/orb-features-v1.json` = `{ "count": N, "descriptorsBase64", "keypointsBase64" }` from `jobs/fixtures/test-painting.jpg` (a CC0 Met image ≤ 200 KB, attribution in `jobs/fixtures/README.md`); plan 04.01's TypeScript tests decode this fixture to prove cross-language agreement (add that test to `convex/lib/orb/features.test.ts` as part of this plan — one test, in scope by exception).

**Verify**: `uv run pytest -q artlog_jobs/letterbox_test.py artlog_jobs/orb_test.py` → letterbox output is `size×size`, a 300×100 input yields pad rows equal to the mean color, `orb` fixture round-trips; `npm run test:convex` → the new fixture test passes.

### Step 3: Convex ingest contract (`convex/ingest.ts`)

All `internalMutation`/`internalQuery` (admin-key callers only), each with `args`/`returns` validators, each batch ≤ 500 rows, all idempotent upserts keyed by the natural key:

- `upsertMuseums({ rows: [{ wikidataId?, key: string, name, lat, lng, website?, region, seedSource }] }) → { ids: Record<key, Id> }` (key = `wikidata:Q…` or `poi:<uuid>`; add `key: string` + index `by_key` to `museums` in the schema — pre-release change; update plan 01.03's table in your head, and `docs/plans/README.md` notes).
- `upsertArtworks({ rows: [{ key: string (wikidata:Q… | met:<id> | aic:<id> | crawl:<host>:<id>), wikidataId?, title, artist, artistId?, date?, yearStart?, yearEnd?, rightsStatus, multiplicity, seriesId? }] }) → { ids: Record<key, Id> }` (add `key` + `by_key` to `artworks`).
- `upsertObjects({ rows: [{ key, artworkKey, ownerKey?, accession?, medium?, dimensions?, source, sourceId, imageRef?, pageUrl?, thumbnailUrl?, mergedIntoKey? }] })` — resolves keys via the `by_key` indexes; sets `confirmCount/rejectCount/calibratorPenalty` to 0 on insert only, never overwriting counters on update; returns ids.
- `upsertPlacements({ rows: [{ objectKey, venueKey, gallery?, onView, from?, to?, source, confidence }] })` — replaces the existing placement with the same `(objectKey, venueKey, source)`.
- `upsertVectors({ rows: [{ objectKey, modelVersion, source, vector }] })` — replaces the existing `(objectKey, modelVersion, source)` row; validates `vector.length === embeddingDim`.
- `upsertDescriptors({ rows: [{ objectKey, descriptors: bytes, keypoints: bytes, keypointCount, inputSize, extractedFrom }] })` — one per object (replace).
- `setObjectPenalty({ rows: [{ objectKey, calibratorPenalty }] })`.
- `counts() → { artworks, objects, placements, vectors, descriptors, museums }` (uses `ctx.db.query(t).take(…)`? — counts on large tables are expensive; instead maintain a `ingestCounters` table updated by the upserts; simplest: return counts from a `counters` singleton row that the upserts increment on insert).
- `exportVenues({ cursor? }) → { page: [{ _id, key, wikidataId, name, lat, lng, website, region }], continueCursor, isDone }` (paginated, 1,000 per page) for plan 02.02's app asset.

**Verify**: `npx vitest run convex/ingest` → upsert twice yields one row; counters do not overwrite; unknown `artworkKey` throws `ConvexError({ code: 'unknown_key' })`; `npx convex dev --once` → success.

### Step 4: The writer and checkpoints

`convex_writer.py`: `ConvexWriter(settings)` with `client = ConvexClient(url); client.set_admin_auth(deploy_key)`; `upsert(fn: str, rows: list[dict], batch_size: int) -> dict[str, str]` (splits, retries with tenacity on transient errors, merges returned id maps); `query(fn, args)`. `checkpoint.py`: `Checkpoint(path)` JSON with `done_keys`/`cursor` per stage, saved after each successful batch (path under `SCRATCH_DIR/checkpoints/<job>.json`), so a job resumes where it stopped. `polite_http.py`: `PoliteClient(per_host_rps=1.0, user_agent=…)` — httpx client with per-host token bucket, `Retry-After` handling, ETag/Last-Modified conditional GETs, and robots.txt cache (`urllib.robotparser`, refetched daily, 5xx ⇒ disallow all) — used by every later job.

**Verify**: `uv run pytest -q` → writer tests with a fake client (batching, retry, id merge), checkpoint resume, polite client rate limiting (time-based test with a 0.05 s period).

### Step 5: Smoke job and device selection

`smoke.py`: `python -m artlog_jobs.smoke` prints the Python version, `settings.device`, the result shape of a 64×1536 fp16 matmul on that device, `SCRATCH_DIR`, and Convex `counts()` — the same module plan 02.10 later runs inside a container to prove the cloud path. Every later module takes its device from `settings.device` and never hard-codes `cuda`; the only cloud-specific difference is the value of two environment variables.

**Verify**: `cd jobs && uv run python -m artlog_jobs.smoke` on the Mac prints `device=mps`, the counts from the dev deployment, and exits 0; `DEVICE=cpu uv run python -m artlog_jobs.smoke` also exits 0.

## Test plan

- `letterbox_test.py`, `orb_test.py`, `convex_writer_test.py`, `checkpoint_test.py`, `polite_http_test.py` under `jobs/artlog_jobs/`.
- `convex/ingest.test.ts` (convex-test): upsert idempotency, key resolution, counters, `exportVenues` pagination.
- Cross-language ORB fixture test in `convex/lib/orb/features.test.ts`.

## Done criteria

- [x] `cd jobs && uv run pytest -q` passes (≥ 12 tests); `uv run ruff check .` exits 0
- [x] `npx tsc --noEmit`, `npm run lint`, `npm run test:convex` exit 0; `npx convex dev --once` succeeds
- [x] `grep -c "internalMutation\|internalQuery" convex/ingest.ts` ≥ 9
- [x] `uv run python -m artlog_jobs.smoke` exits 0 on the Mac with `device=mps` (output recorded in `jobs/README.md`)
- [x] `git grep -n "deploy_key\|DEPLOY_KEY=" -- ':!jobs/README.md' ':!docs'` shows no literal key values
- [x] `docs/plans/README.md` status row updated

## Execution notes — 2026-09-09

- Drift check: `jobs/` existed with only `jobs/config/source-scores.json` from
  spike 00.05; it was kept in place and the scaffold was built around it.
- `uv sync` resolved Python 3.13.15, torch 2.14.0 (`mps` available), OpenCV
  4.14, convex 0.7.0, pydantic-settings 2.15 (added: pydantic 2 keeps
  `BaseSettings` in that package). `settings.device` is a cached property so
  torch is imported only when a job asks for a device. `Settings` also reads
  the repo root `.env.local`, so local runs need no exports.
- The Python client converts `int` to float64 itself, so no coercion lives in
  the writer; `ConvexWriter.upsert` takes an `on_batch(rows, ids)` callback for
  checkpointing after each successful batch.
- `CONVEX_DEPLOY_KEY` was minted with the official CLI path
  `npx convex deployment token create artlog-jobs-local --deployment dev --save-env`
  (no dashboard step), documented in `.env.example`, mirrored to the Conductor
  root `.env.local` together with `CONVEX_URL`. `set_admin_auth` with that key
  calls the internal functions, so the first STOP condition did not apply.
- `CRAWLER_CONTACT` is documented but left unset in `.env.local`; the
  User-Agent omits `mailto:` until the operator chooses the contact address.
- Every upsert replaces the ingest-owned fields of an existing row (absent
  optionals clear), keeps counters/provenance/enrichment, and returns
  `{ ids }` keyed by the natural key (`objectKey|venueKey|source` for
  placements, `objectKey|modelVersion|source` for vectors). `upsertDescriptors`
  also validates the wire-format byte lengths (`bad_descriptors`).
- The cross-language ORB test lives in `convex/lib/orb/pythonFixture.test.ts`
  and decodes the fixture with `DataView` only: plan 04.01 is being executed in
  a parallel worktree, so `features.test.ts` does not exist on this branch.
  04.01 can fold the fixture into `decodeOrbFeatures` when it lands.
- Fixture image: Met object 436535 (van Gogh, *Wheat Field with Cypresses*,
  CC0), re-encoded to 156 KB; ORB returned exactly 500 keypoints. The
  committed fixture is compared byte-for-byte with a fresh extraction, so a
  future OpenCV bump that changes ORB output requires regenerating it.
- Letterbox note for 02.04: spike 00.01's calibration letterbox was bicubic
  with black padding (decision 001); this plan implements the bilinear,
  mean-color spec that 03.02 mirrors. 02.04's drift check measures the effect
  against the iPhone reference; nothing here changes the spike.
- `npx convex dev --once` on the shared dev deployment unmounted another
  worktree's `rateLimiter` component and dropped its auth/attest indexes
  (plan 04.04 in progress), and that worktree's later push removed
  `ingest.ts` before the first smoke run. Re-pushing immediately before the
  smoke run fixed it; the hazard is recorded in `docs/plans/README.md`.
- `.easignore` already excluded `jobs/`; `.gitignore` gained the `jobs/`
  run directories. Done criteria: 36 Python tests, 21 Convex tests,
  `tsc`/`lint`/`ruff` clean.

## STOP conditions

- `set_admin_auth` with the dashboard deploy key cannot call internal mutations — report; the fallback is a public mutation guarded by a shared secret (operator decision).
- `torch.backends.mps.is_available()` is false inside the `uv` environment — report the torch version and wheel; do not fall back to CPU silently (the build would take days).

## Maintenance notes

- `ingest.ts` is the Python↔Convex contract; changing a row shape means updating the Python dataclass in the same PR.
- The letterbox spec here and in Swift (plan 03.02) must stay identical; the drift check (plan 02.04) catches divergence.
- Keep every module device-agnostic (`settings.device`); plan 02.10 reuses this package unchanged inside CUDA containers.

# Plan 02.01: Python jobs scaffold, the Convex ingest contract, and the Nebius job launcher

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/ convex/ingest.ts .github/ shared/`
> If `jobs/` exists, STOP and reconcile.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `docs/plans/01-foundation/03-convex-project-and-schema.md`; `docs/decisions/008-jobs-and-release-logistics.md` (spike 00.08: launch mechanism, batch size)
- **Category**: feature / dx
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Everything batch — the corpus build, the crawler, enrichment, re-embedding, calibrator training — runs as Python on Nebius Serverless AI jobs that write to Convex through the Python client and exit (design §5.2, §5.7). Those jobs share one project layout, one Convex writer with checkpointing, one letterbox function that must match the phone's, one ORB extractor in the wire format of plan 04.01, and one way to be launched. This plan builds that shared base so plans 02.02–02.09 only add job modules.

## Current state

- No `jobs/` directory. `convex/schema.ts` (plan 01.03) defines the tables; nothing writes to them yet.
- `shared/model-version.json`: `{ modelVersion, embeddingDim: 1536, inputSize: 512, orbMaxKeypoints: 500 }`.
- Wire format for ORB features (plan 04.01): `descriptors` = `count×32` bytes; `keypoints` = `count×4` little-endian float32 `[x, y, size, angle]` in letterboxed pixel space; `count ≤ 1000`.
- Verified platform facts (2026-09-08): Python client `pip install convex` (0.7.0): `ConvexClient(url)`, `client.set_admin_auth(deploy_key)`, `client.mutation("file:fn", args)`, `client.query(...)`; Python `bytes` ↔ `v.bytes()`, `float` ↔ `v.float64()`, `dict`/`list` ↔ object/array. Per-mutation limits: 16,000 documents / 16 MiB written, 16 MiB args; Pro write throughput 8 MiB/s. Nebius: `nebius ai job create --name … --image … --container-command … --args … --platform cpu-d3 --preset 4vcpu-16gb --timeout 2h --env K=V --env-secret K=SECRET --volume s3://BUCKET:/mnt/scratch:rw`; GPU `--platform gpu-l40s-a --preset 1gpu-8vcpu-32gb` (eu-north1 only); container images from a registry (`--registry-*` flags for private ones). Spike 00.08 chose the launch mechanism (GitHub Actions `workflow_dispatch` running the CLI, or direct REST) — read its record before Step 5.
- `AGENTS.md`: kebab-case for new source files applies to app code; Python modules use snake_case (PEP 8). Tests co-located as `*_test.py`. Comments only for non-obvious reasons.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Python env | `cd jobs && uv sync` | `.venv` created |
| Job tests | `cd jobs && uv run pytest -q` | all pass |
| Lint/format | `cd jobs && uv run ruff check . && uv run ruff format --check .` | exit 0 |
| Convex push | `npx convex dev --once` | success |
| Convex tests | `npm run test:convex` | pass |
| Build CPU image | `docker build -f jobs/Dockerfile.cpu -t artlog-jobs-cpu jobs/` | image built |
| Launch (per 00.08) | `jobs/scripts/launch-job.sh <job> [args]` | prints job id |

## Scope

**In scope**: `jobs/pyproject.toml`, `jobs/uv.lock`, `jobs/README.md`, `jobs/artlog_jobs/{__init__,config,convex_writer,letterbox,orb,model_version,checkpoint,polite_http}.py` + `*_test.py`, `jobs/fixtures/` (a small CC0 test image and the ORB byte fixture), `jobs/Dockerfile.cpu`, `jobs/Dockerfile.gpu`, `jobs/scripts/launch-job.sh`, `.github/workflows/nebius-job.yml` (only if 00.08 chose GitHub Actions), `convex/ingest.ts` + `convex/ingest.test.ts`, `.gitignore` (`jobs/.venv`, `jobs/out`, `jobs/checkpoints`), `.easignore` (`jobs/`), `shared/fixtures/orb-features-v1.json`.

**Out of scope**: any real data source or model code (02.02–02.09); the crawler's Convex queue functions (04.05); secrets of any kind in files.

## Git workflow

- Commits: `build(jobs): scaffold python jobs project`, `feat(convex): add ingest mutations`, `feat(jobs): add convex writer and letterbox`, `ci(jobs): add nebius job launcher`.

## Steps

### Step 1: Project scaffold

`jobs/pyproject.toml` (Python ≥ 3.12, `uv`): package `artlog_jobs`; deps `convex`, `httpx`, `pillow`, `numpy`, `opencv-python-headless`, `tenacity`, `boto3`, `pyyaml`, `pydantic`; optional group `gpu`: `torch`, `torchvision`, `timm`; dev: `pytest`, `ruff`. `jobs/artlog_jobs/config.py`: a pydantic `Settings` reading `CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `SCRATCH_DIR` (default `/mnt/scratch`), `USER_AGENT` (default `artlog-bot/0.1 (+https://github.com/<org>/artlog; mailto:<contact>)` — the contact value comes from env `CRAWLER_CONTACT`), `LOG_LEVEL`. `jobs/README.md`: how to run locally (`uv run python -m artlog_jobs.<job>`), env var names, how to launch on Nebius.

**Verify**: `cd jobs && uv sync && uv run python -c "import artlog_jobs"` → no error.

### Step 2: Shared image functions

`letterbox.py`: `letterbox(img: PIL.Image, size: int) -> PIL.Image` — convert to RGB; resize so the long side equals `size` using `Image.Resampling.BILINEAR`; paste centered onto a `size×size` canvas filled with the image's per-channel mean color (computed on the resized image); return. This is the specification the phone's Swift implementation (plan 03.02) must match: bilinear resize, centered, mean-color pad. `model_version.py`: loads `../shared/model-version.json` (path resolved relative to the repo root) and exposes `MODEL_VERSION`, `EMBEDDING_DIM`, `INPUT_SIZE`, `ORB_MAX_KEYPOINTS`.

`orb.py`: `extract_orb(img: np.ndarray (gray uint8, size×size), nfeatures=ORB_MAX_KEYPOINTS) -> OrbFeatures(descriptors: bytes, keypoints: bytes, count: int)` with `cv2.ORB_create(nfeatures=nfeatures)`; descriptors `des.tobytes()` (shape `(N,32)` uint8); keypoints packed with `np.array([[k.pt[0], k.pt[1], k.size, k.angle] for k in kps], dtype='<f4').tobytes()`; `count = 0` → both `b''`. Generate `shared/fixtures/orb-features-v1.json` = `{ "count": N, "descriptorsBase64", "keypointsBase64" }` from `jobs/fixtures/test-painting.jpg` (a CC0 Met image ≤ 200 KB, attribution in `jobs/fixtures/README.md`); plan 04.01's TypeScript tests decode this fixture to prove cross-language agreement (add that test to `convex/lib/orb/features.test.ts` as part of this plan — one test, in scope by exception).

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

### Step 5: Containers and launcher

`Dockerfile.cpu` (`python:3.12-slim`, `uv sync --no-dev`, `ENTRYPOINT ["uv","run","python","-m"]`), `Dockerfile.gpu` (`nvidia/cuda:13.1.1-runtime-ubuntu24.04` + Python 3.12 + `uv sync --extra gpu`). `scripts/launch-job.sh <job-module> [--gpu] [-- args…]` builds the `nebius ai job create` command with `--env-secret CONVEX_DEPLOY_KEY=artlog-convex-deploy-key`, `--env CONVEX_URL=…`, `--volume s3://artlog-scratch:/mnt/scratch:rw`, platform/preset by `--gpu`, `--timeout 12h`, and prints the job id and a `nebius ai job logs` command. If spike 00.08 chose GitHub Actions: add `.github/workflows/nebius-job.yml` with `workflow_dispatch` inputs `job` and `args`, installing the Nebius CLI, authenticating with the service-account key from repo secrets, and running the same script. Document secret **names** in `jobs/README.md` (`NEBIUS_SA_KEY`, `NEBIUS_PROJECT_ID`, `CONVEX_URL`, the SecretStash secret name).

**Verify**: `docker build` for both images succeeds locally (GPU image builds without a GPU); `scripts/launch-job.sh --dry-run artlog_jobs.smoke` prints the full command with `--dry-run` appended; a real run of `artlog_jobs.smoke` (prints Python version, Convex `counts()`) reaches `COMPLETED` on Nebius CPU and its log shows the counts.

## Test plan

- `letterbox_test.py`, `orb_test.py`, `convex_writer_test.py`, `checkpoint_test.py`, `polite_http_test.py` under `jobs/artlog_jobs/`.
- `convex/ingest.test.ts` (convex-test): upsert idempotency, key resolution, counters, `exportVenues` pagination.
- Cross-language ORB fixture test in `convex/lib/orb/features.test.ts`.

## Done criteria

- [ ] `cd jobs && uv run pytest -q` passes (≥ 12 tests); `uv run ruff check .` exits 0
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:convex` exit 0; `npx convex dev --once` succeeds
- [ ] `grep -c "internalMutation\|internalQuery" convex/ingest.ts` ≥ 9
- [ ] Both Docker images build; one smoke job completed on Nebius (job id recorded in `jobs/README.md`)
- [ ] `git grep -n "deploy_key\|DEPLOY_KEY=" -- ':!jobs/README.md' ':!docs'` shows no literal key values
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- Spike 00.08's record does not exist — write the launcher for the CLI path only and note the gap.
- `set_admin_auth` with the dashboard deploy key cannot call internal mutations — report; the fallback is a public mutation guarded by a shared secret (operator decision).
- Docker is unavailable on the machine — build the image on Nebius via a job that pulls from the repo? No: report instead.

## Maintenance notes

- `ingest.ts` is the Python↔Convex contract; changing a row shape means updating the Python dataclass in the same PR.
- The letterbox spec here and in Swift (plan 03.02) must stay identical; the drift check (plan 02.04) catches divergence.

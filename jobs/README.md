# artlog jobs

Python batch jobs that build and maintain the index and write it to Convex
through `convex/ingest.ts` (plan 02.01). Every job runs locally with

```sh
cd jobs
uv sync                                   # once; creates .venv with Python ≥ 3.12
uv run python -m artlog_jobs.<job> [args]
caffeinate -i uv run python -m artlog_jobs.<job> [args]   # long runs: no idle sleep
```

The same package runs unchanged inside the Nebius containers of plan 02.10;
only environment variables differ.

## Environment

Settings load from the process environment first, then from the repo root
`.env.local` (`artlog_jobs/config.py`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `CONVEX_URL` | Deployment URL the jobs write to (same value as `EXPO_PUBLIC_CONVEX_URL`) | required for Convex calls |
| `CONVEX_DEPLOY_KEY` | Deploy key for that deployment; `npx convex deployment token create artlog-jobs-local --deployment dev --save-env` writes it into `.env.local` | required for Convex calls |
| `SCRATCH_DIR` | Working directory for downloads, features and `checkpoints/<job>.json`; resolved to an absolute path | `jobs/scratch` |
| `DEVICE` | Torch device override (`mps`, `cuda`, `cpu`) | `mps` if available, else `cuda`, else `cpu` |
| `CRAWLER_CONTACT` | Contact appended to the crawler User-Agent as `mailto:` | unset (no mailto) |
| `USER_AGENT` | Full User-Agent override | `artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app[; mailto:…])` |
| `LOG_LEVEL` | Python logging level | `INFO` |

Never commit `.env.local`; `.env.example` documents the names with placeholders.

`SCRATCH_DIR` is a local directory on the operator's Mac (gitignored). A build
processes images shard by shard and deletes each shard's images as soon as
they are embedded, so nothing under scratch outlives its shard except
features, metadata and checkpoints.

## Shared modules

| Module | Contract |
| --- | --- |
| `config.py` | `Settings` (above), `get_settings()`, `setup_logging()` |
| `model_version.py` | `MODEL_VERSION`, `EMBEDDING_DIM`, `INPUT_SIZE`, `ORB_MAX_KEYPOINTS` from `../shared/model-version.json` |
| `letterbox.py` | `letterbox(img, size)`: RGB, bilinear resize so the long side equals `size`, centered on a `size×size` canvas filled with the resized image's per-channel mean (half-up rounded). The phone's Swift version (plan 03.02) must match it |
| `orb.py` | `extract_orb(gray, nfeatures)` → `OrbFeatures(descriptors, keypoints, count)` in plan 04.01's wire format; `extract_from_image(img)` letterboxes first; `python -m artlog_jobs.orb <image> <fixture.json>` writes `shared/fixtures/orb-features-v1.json` |
| `convex_writer.py` | `ConvexWriter(settings)`: `upsert(fn, rows, batch_size≤500, on_batch)` splits (descriptor batches capped at 200 rows), retries transient errors (never `ConvexError`), merges returned `ids`; `query`, `mutation` |
| `checkpoint.py` | `Checkpoint.for_job(settings, job)`: per-stage `done` key sets and cursors, written atomically after every change |
| `polite_http.py` | `PoliteClient(user_agent, per_host_rps)`: per-host spacing and robots checks on each page redirect, robots.txt cache (daily refresh; 5xx, 401/403/429 or HTML ⇒ disallow all; 404 ⇒ allow), `Crawl-delay`, `Retry-After`, ETag / Last-Modified conditional GETs |
| `smoke.py` | Prints interpreter, device, an fp16 matmul shape, scratch path and Convex `ingest:counts` |

Python ints are sent to Convex as float64 by the client, which is what every
`v.number()` field expects; use `convex.ConvexInt64` only for `v.int64()`.

HTTP response bodies use a least-recently-used cache capped at 16 MiB and 128
entries. Set `cache_max_bytes=0` for one-pass image downloads; bodies larger
than the budget are never cached. Cached compressed responses replay their
decoded bytes with matching headers.

A server `Retry-After` longer than `max_retry_after` (default 120 seconds)
raises `RetryLater`, exposing `host` and the remaining `retry_after` seconds
so the job can defer that work. The client remembers the full host cooldown,
including on the final retry attempt; other hosts remain available. Shorter
delays are waited out before another request to that host.

## Verification

```sh
cd jobs && uv run pytest -q
cd jobs && uv run ruff check . && uv run ruff format --check .
npm run test:convex                                          # convex/ingest.test.ts, convex/lib/orb/pythonFixture.test.ts
npx convex dev --once                                        # push ingest functions
```

All worktrees push to the one dev deployment, and a push replaces the whole
function set. Run `npx convex dev --once` right before any live check
(`smoke`, `npx convex run ingest:counts`) because another worktree may have
pushed in between.

### Smoke run, 2026-09-09 (Apple M5 Pro, macOS 26.5)

```
$ uv run python -m artlog_jobs.smoke
python=3.13.15
device=mps
torch=2.14.0
matmul_shape=(64, 64)
scratch_dir=/Users/dwjiang/conductor/workspaces/artlog-app/san-jose/jobs/scratch
user_agent=artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app)
model_version=c-radiov3-b-int8-512-dinov2-v1
counts={"artworks": 0, "descriptors": 0, "museums": 0, "objects": 0, "placements": 0, "vectors": 0}
```

`DEVICE=cpu uv run python -m artlog_jobs.smoke` prints `device=cpu` with the
same counts and also exits 0.

## Layout

- `artlog_jobs/` — the package; tests co-located as `*_test.py`
- `config/source-scores.json` — Tavily domain scores from spike 00.05
- `fixtures/` — test inputs (attribution in `fixtures/README.md`)
- `scratch/`, `out/`, `checkpoints/` — gitignored run outputs

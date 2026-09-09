# Plan 02.10: Nebius Serverless AI job containers and the launcher (deferred)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`. Never write tokens, keys or deploy keys into
> files, images or logs.
>
> **Drift check (run first)**: `git diff --stat deaeaa2..HEAD -- .dockerignore jobs/Dockerfile.cpu jobs/Dockerfile.gpu jobs/scripts .github/workflows convex/crawl.ts`
> Then read `docs/decisions/008-jobs-and-release-logistics.md` §1–§3 and §5:
> the L40S path, the bucket mount and the REST launch path are proven. If the
> `eu-north1` non-GPU vCPU quota is still 0 (it was on 2026-09-09), CPU-bound
> workers run on `gpu-l40s-a` at ≈ $1.55/h instead of ≈ $0.10/h until the
> operator requests the quota; record the cost in the runbook, do not stop.

## Status

- **Priority**: P2 (needed for scheduled crawls — plan 04.05's `maybeLaunch` — and for any cloud re-run the operator wants; nothing in 02.02–02.09 waits for it)
- **Effort**: M
- **Risk**: LOW (the job modules already run locally; this plan only packages and launches them)
- **Depends on**: 02.01 (the `jobs/` package, `settings.device`, `smoke.py`), 04.05 (the `launchWorker` seam, `crawlLaunches`, and durable per-URL crawl state), 02.06 (the working crawler, including resume with empty scratch), spike 00.08 (done for the Nebius half: L40S job, bucket mount, REST launch path). **Operator prerequisite, cost only**: a `compute.instance.non-gpu.vcpu` increase in `eu-north1` (0 on 2026-09-09) so crawler workers run on `cpu-d3` at ≈ $0.10/h; without it they run on the L40S preset at ≈ $1.55/h (about $0.90 instead of $0.06 per capped venue crawl)
- **Category**: dx / infra
- **Planned at**: 2026-09-08 on commit `deaeaa2`, split out of plan 02.01 when the initial index build moved to the operator's Mac (`docs/plans/README.md`, "Decisions made while planning")

For 02.04's optional cloud pilot, Steps 1–2 may be pulled forward after 02.01
and the Nebius half of 00.08. Step 3 and completion of this plan require 02.06;
an early container/smoke run does not enable scheduled crawling.

## Why this matters

The index is built on a laptop (02.04), but two things want a machine that is not a laptop: the crawl scheduler launches a worker whenever a venue is queued (design §4.2 "Priority", plan 04.05), and the operator may prefer a cloud GPU for a full rebuild or for 02.08's `reembed` at scale. Design §5.2 — "a job runs, writes to Convex through the Python client, and exits; nothing stays up" — is this plan. Until it lands, the crawler worker is started by hand and `CRAWL_LAUNCH_MODE=off`.

## Current state

- `jobs/` (02.01–02.09) runs every job locally: `settings.device` resolves `mps` / `cuda` / `cpu`; `SCRATCH_DIR` is a local directory; `python -m artlog_jobs.smoke` prints the device, the scratch path and Convex `counts()`. No module hard-codes a device or a path.
- `convex/crawl.ts` (04.05): `maybeLaunch` calls `launchWorker()`, records `crawlLaunches { at, mode, ok, response }`, and is rate-limited to one launch per 30 min; only mode `off` exists. The crawler (02.06) reads and writes per-URL validators through `crawl.getPageStates` / `crawl.recordPageStates`; these live in Convex's `crawlPages` table and survive an empty `SCRATCH_DIR`.
- Spike 00.08's record (facts verified 2026-09-08 from docs.nebius.com; re-check, the product is in preview): `nebius ai job create --name X --image IMG --container-command bash --args "-c …" --platform cpu-d3 --preset 4vcpu-16gb | --platform gpu-l40s-a --preset 1gpu-8vcpu-32gb --timeout 1h… [--env K=V] [--env-secret K=SECRET] [--volume s3://BUCKET:/mnt/scratch:rw:default@SECRET_SELECTOR] [--restart-policy never]`; states `PROVISIONING → STARTING → IMAGE_PULLING → RUNNING → COMPLETED|FAILED|CANCELLED`; timeout min 1 h, max 168 h; L40S in `eu-north1` only, default quota 2 GPUs; secrets via SecretStash; compute ≈ $0.10/h for the CPU preset and ≈ $1.55/h for the L40S preset, billed per second. REST: `POST https://api.nebius.cloud/ai/v1/jobs` with a bearer token from an RS256 service-account JWT exchanged at `https://auth.eu.nebius.com:443/oauth2/token/exchange` (token lifetime 12 h). GitHub fallback: `workflow_dispatch` on a workflow that must exist on `main`. Its secrets inventory (names only) is the one to provision.
- Proven by spike 00.08 on 2026-09-09 (decision 008 §2, §3, §5): mount buckets by resource ID (`--volume storagebucket-…:/mnt/scratch:rw`, no credentials) — the s3:// form additionally needs a local AWS shared-config profile and a SecretStash secret with `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`; `nebius ai job create` blocks until the job ends and prints plain text (parse the `Job ID:` line; poll `ai job get --format json`); jobs need ~2 minutes of overhead before the workload starts; authorized keys must be RSA 4096; the JWT exchange and `GET /ai/v1/jobs` work; `POST /ai/v1/jobs` takes `{ metadata { parentId, name }, spec { image, containerCommand, args, platform, preset, subnetId, timeout, volumes, environmentVariables, … } }`. `compute.instance.non-gpu.vcpu` is 0 in `eu-north1`, so CPU presets are unavailable until the operator requests an increase; the L40S preset (8 vCPU) runs the same jobs meanwhile at ≈ 15× the hourly cost. The bucket `artlog-scratch` (`storagebucket-e007391623532510352106`) already exists and is optional once 02.06's empty-scratch resume check passes: the crawler persists both results and per-URL state in Convex; jobs with filesystem checkpoints across runs (a full re-embed) mount it.
- The operator's Mac has no Docker (2026-09-08). Images need Docker Desktop, Colima, or a remote builder — an operator choice recorded in the runbook.
- `.easignore` already excludes `jobs/`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build CPU image (from repo root) | `docker build --platform linux/amd64 -f jobs/Dockerfile.cpu -t "$NEBIUS_JOBS_IMAGE_CPU" .` | image built |
| Build GPU image (from repo root) | `docker build --platform linux/amd64 -f jobs/Dockerfile.gpu -t "$NEBIUS_JOBS_IMAGE_GPU" .` | builds without a GPU |
| Container smoke | `docker run --rm -e DEVICE=cpu -e CONVEX_URL -e CONVEX_DEPLOY_KEY "$NEBIUS_JOBS_IMAGE_CPU" artlog_jobs.smoke` | prints `device=cpu` and counts |
| Dry run | `jobs/scripts/launch-job.sh --dry-run artlog_jobs.smoke` | prints the full `nebius ai job create` command |
| Launch | `jobs/scripts/launch-job.sh artlog_jobs.smoke [--gpu]` | prints the job id and a logs command |
| Logs | `nebius ai job logs <id> --follow` | job output |
| Convex tests | `npm run test:convex` | pass |

## Scope

**In scope**: `.dockerignore`, `jobs/Dockerfile.cpu`, `jobs/Dockerfile.gpu`, `jobs/scripts/launch-job.sh`, `.github/workflows/nebius-job.yml` (only if 00.08 chose GitHub Actions), `convex/crawl.ts` (`launchWorker` modes `github` / `nebius`) + `convex/crawl.test.ts` additions, `.env.example` (names only), `jobs/pyproject.toml` (optional group `cloud`: `boto3`; the CUDA wheel index for the GPU image), `jobs/README.md` ("Run on Nebius" section).

**Out of scope**: any job logic (02.02–02.09); the scratch bucket itself (it exists from 00.08 and is mounted only by jobs with filesystem checkpoints across runs); provisioning secrets (operator, names from 00.08); secrets of any kind in files.

## Git workflow

- Commits: `build(jobs): add cpu and gpu containers`, `ci(jobs): add nebius job launcher`, `feat(convex): launch crawler worker from maybeLaunch`.

## Steps

### Step 1: Containers

`Dockerfile.cpu`: `python:3.12-slim`, `uv sync --no-dev`, `ENV SCRATCH_DIR=/mnt/scratch DEVICE=cpu`, `ENTRYPOINT ["uv","run","python","-m"]`. `Dockerfile.gpu`: `nvidia/cuda:13.1.1-runtime-ubuntu24.04` + Python 3.12 + `uv sync --no-dev` with torch from the CUDA wheel index, `ENV DEVICE=cuda`. Both use the repository root as their build context, `COPY jobs/ /app/jobs/` and `COPY shared/model-version.json /app/shared/model-version.json`, and `WORKDIR /app/jobs` before syncing and running Python. This preserves the sibling layout used by `model_version.py`. The root `.dockerignore` admits only `jobs/` and `shared/model-version.json`, excluding `.env*` at every depth, `.venv`, Python caches, `jobs/out`, checkpoints and scratch. Images are pushed to a registry the Nebius project can pull from (record the name; use `--registry-*` flags for a private one).

**Verify**: both images build with the commands above; `docker run --rm --entrypoint test "$NEBIUS_JOBS_IMAGE_CPU" -f /app/shared/model-version.json` exits 0, as does the same check with `"$NEBIUS_JOBS_IMAGE_GPU"`; the container smoke command prints `device=cpu` and the dev deployment's counts with the key passed through `-e`, never baked in (`docker history "$NEBIUS_JOBS_IMAGE_CPU" | grep -i key` → nothing).

### Step 2: Launcher script

`jobs/scripts/launch-job.sh <module> [--gpu] [--dry-run] [-- args…]`: builds `nebius ai job create --name artlog-<module>-<utc timestamp> --image <cpu|gpu image> --container-command bash --args "-c 'uv run python -m <module> <args>'" --platform … --preset … --timeout 12h --restart-policy never --env CONVEX_URL="$CONVEX_URL" --env-secret CONVEX_DEPLOY_KEY="$NEBIUS_CONVEX_SECRET"` plus `--volume "$NEBIUS_SCRATCH_BUCKET_ID:/mnt/scratch:rw"` only when `NEBIUS_SCRATCH_BUCKET_ID` is set (the crawler needs no bucket), using `NEBIUS_PROJECT_ID`/`NEBIUS_SUBNET_ID` from the environment; because `create` blocks until the job ends, run it with `--dry-run` first and, for real launches, in the background, parsing the `Job ID:` line; prints the job id and `nebius ai job logs <id> --timestamps`. Confirm every flag against `nebius ai job create --help` first. Spike 00.08's `spikes/nebius-jobs/run-quickstart.sh` is the reference for argument handling; do not reuse it as-is.

**Verify**: `bash -n` passes; the dry run prints a command containing the module name, the preset and no secret values; a real `artlog_jobs.smoke` on the CPU preset — or on the L40S preset while the CPU quota is 0 — reaches `COMPLETED` with counts in its log; then `--gpu` reaches `COMPLETED` printing `device=cuda`. Record both job ids and their billed cost in `jobs/README.md`.

### Step 3: Launch from Convex

Implement the mode 00.08 chose in `launchWorker()` (`convex/crawl.ts`): `github` → `fetch` to the dispatch endpoint with `GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO`, inputs `{ job: 'artlog_jobs.crawler.worker', args: '--max-venues 5' }`; `nebius` → sign the RS256 JWT (claims `iss` = `sub` = service-account id, `exp` +5 min, header `kid`) with WebCrypto from `NEBIUS_PRIVATE_KEY_PEM` (a 4096-bit PKCS8 key), `NEBIUS_AUTH_PUBLIC_KEY_ID` and `NEBIUS_SERVICE_ACCOUNT_ID`, exchange it at `https://auth.eu.nebius.com:443/oauth2/token/exchange`, then `POST https://api.nebius.cloud/ai/v1/jobs` with the body shape from decision 008 §5. Record the job id (or dispatch status) in `crawlLaunches.response`; keep the 30-min rate limit; `off` keeps its current behavior. Document the env var names for the chosen mode in `.env.example`; install `.github/workflows/nebius-job.yml` only for `github`.

**Verify**: `convex/crawl.test.ts` with `vi.stubGlobal('fetch')`: the chosen mode issues exactly one request with the right shape, records the response, and never logs a token; one real `maybeLaunch` on the dev deployment (queue a venue, run the cron by hand) launches a worker with `--max-venues 1` that reaches `COMPLETED` and flips `museums.indexStatus`. Requeue that test venue through an internal mutation and launch a second job with no scratch bucket mounted: unchanged sitemap entries are skipped, validator-only pages can return 304, and unchanged works are not downloaded or embedded again. Record both jobs' cache-hit and processed-page counts.

### Step 4: Runbook

`jobs/README.md` "Run on Nebius": image names, secret names (never values), the scratch bucket and the rule that jobs delete their own scratch objects (the 3-day lifecycle rule from 00.08 is a backstop, not cleanup), cost per run for CPU and L40S presets, how to cancel a job (`nebius ai job cancel`), and how to flip `CRAWL_LAUNCH_MODE`.

**Verify**: every command in the section was run at least once during this plan.

## Test plan

- `convex/crawl.test.ts`: mode selection, request shape, error handling (non-2xx → `ok: false`, `response` = status text), the rate limit still holds.
- `jobs/scripts/launch-job_test.sh`: the dry run contains the module and preset and none of the secret-valued variables.

## Done criteria

- [ ] Both images build and are pulled by Nebius (names in `jobs/README.md`, no credentials anywhere)
- [ ] CPU (or L40S-substitute) and GPU smoke jobs `COMPLETED` (ids, preset and cost recorded)
- [ ] `maybeLaunch` launched a crawler worker and a second fresh job reused its durable per-URL state without a scratch mount; `CRAWL_LAUNCH_MODE` documented
- [ ] `git grep -n "BEGIN PRIVATE KEY\|DEPLOY_KEY=" -- ':!docs' ':!jobs/README.md'` → nothing
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- The CPU quota is still 0 and the operator has not said whether to request it or to pay L40S rates for CPU-bound workers — ask before launching recurring crawls; a one-off smoke on the L40S is fine.
- No Docker and the operator does not want Docker Desktop/Colima — report; a remote image build is the operator's call.
- A GitHub fine-grained PAT cannot be scoped to `actions:write` on the repo — use the `nebius` mode, or report.
- The Convex runtime cannot import the RS256 key or reach the token-exchange endpoint — use the `github` mode, or report.

## Maintenance notes

- The job code never changes here; if a job needs a cloud-only branch, that is a bug in 02.01's device/scratch abstraction.
- Re-check `nebius ai job create --help` before every change: Serverless AI Jobs are a preview product.

# Spike 00.08: Prove the Nebius Serverless AI job path, the job launch mechanism, and release logistics

> **Executor instructions**: Time-boxed investigation (1 day). Deliverable is a
> decision record. Do not delete/update cloud resources you did not create in
> this spike. Never write tokens or keys into files. Update the status row in
> `docs/plans/README.md` when done.
>
> **Drift check**: `ls docs/decisions/008-jobs-and-release-logistics.md` must not exist.

## Status

- **Priority**: P1 (gates 02.01 and 06.01)
- **Effort**: S–M (1 day, plus waiting on Apple)
- **Risk**: LOW
- **Depends on**: none
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.2 runs every batch job on "Nebius Serverless Jobs" and states nothing idles; §12 asks about CPU-only presets, L40S quota, scratch-bucket lifecycle, Convex Python client throughput from a job, EAS build quota, and TestFlight timing. The crawl scheduler (§4.2) also needs a way to *launch* a job when a museum is bumped to the front of the queue — the design does not say how a Convex cron starts a Nebius job. This spike settles those mechanics before plan 02.01 builds on them.

## Facts established during planning (docs.nebius.com, 2026-09-08)

- The product is **Serverless AI → Jobs** (public preview since 2026-03): `nebius ai job create --name X --image IMG --container-command bash --args "-c …" --platform gpu-l40s-a --preset 1gpu-8vcpu-32gb --timeout 1h [--env K=V] [--env-secret K=SECRET] [--volume s3://BUCKET:/mnt/path:rw] [--restart-policy never|on-failure] [--preemptible]`; `nebius ai job logs $ID --follow`; states `PROVISIONING → STARTING → IMAGE_PULLING → RUNNING → COMPLETED|FAILED|CANCELLED`. REST `POST https://api.nebius.cloud/ai/v1/jobs`; Python SDK `pip install nebius` (`nebius.api.nebius.ai.v1.JobServiceClient`). A BETA `nebius ai job run script.py --output s3://bucket` exists.
- Platforms/presets: CPU `cpu-d3` (`4vcpu-16gb` … `256vcpu-1024gb`, all regions); L40S `gpu-l40s-a` (`1gpu-8vcpu-32gb` ≈ $1.55/h) and `gpu-l40s-d`, **eu-north1 only**, default quota **2 L40S GPUs**. Billing per second while running. Timeout min 1 h, default 24 h, max 168 h.
- Secrets via SecretStash (`nebius mysterybox secret create …` then `--env-secret`); Object Storage S3 endpoint `https://storage.eu-north1.nebius.cloud`, access keys via `nebius iam v2 access-key create`, lifecycle expiry via `aws s3api put-bucket-lifecycle-configuration` (evaluated nightly).
- Token Factory promo: $25 via the hackathon form + $25 via the Builders Program (mechanism only; no codes in files).
- EAS free tier: 15 iOS builds/month, 45-min timeout, low priority. `eas.json` from plan 01.04. TestFlight external testing needs Beta App Review for the first build; builds expire after 90 days.

## Questions to answer

1. Account readiness: Nebius project in `eu-north1`, L40S quota (2 by default — enough for one build job; request more only if plan 02.04 needs parallelism), `cpu-d3` availability, CLI profile configured (`nebius profile create …`), service account for jobs with Object Storage and SecretStash permissions.
2. Run the quickstart job (CUDA image, `nvidia-smi`) on `gpu-l40s-a 1gpu-8vcpu-32gb` and a CPU job (`cpu-d3 4vcpu-16gb`, `python:3.12-slim`, prints Python version): time from `create` to `RUNNING`, to `COMPLETED`; cost shown for each.
3. Scratch bucket: create `artlog-scratch`, add a 3-day expiry lifecycle rule, mount it with `--volume s3://artlog-scratch:/mnt/scratch:rw` in a CPU job that writes and reads a file; confirm the object appears and the rule is attached.
4. Convex writes from a job: a CPU job with `pip install convex` doing 10,000 inserts of 12 KB rows into a scratch table on the project's dev deployment at 200/500/1,000 rows per mutation via `set_admin_auth` (deploy key injected with `--env-secret`); rows/s and any `too large` errors → the batch size for plan 02.05.
5. **Job launch mechanism** (decide): (a) GitHub Actions workflow with `workflow_dispatch` + nightly `schedule` that runs `nebius ai job create …` using a service-account key in repo secrets, triggered on demand by a Convex action via the GitHub REST API (`POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches`, fine-grained PAT in Convex env) — simple bearer auth from Convex; or (b) Convex action calling the Nebius REST API directly, which requires exchanging a service-account JWT for an IAM token inside Convex (WebCrypto RS256 is available; confirm the exchange endpoint and token TTL). Prototype the cheaper one that works end to end; record the other as fallback. Also confirm a job can `nebius ai job create` **itself** for a follow-up run (chaining) or whether that needs the launcher.
6. Apple/EAS: Apple Developer Program enrollment status and date; App Store Connect app record for `app.artlog.ios`; `eas build --platform ios --profile development-simulator` once (counts 1 of 15) to confirm the pipeline; TestFlight internal group set up; note Beta App Review turnaround expectations for the first external build (submit early per §11).
7. Cost log: total spent in this spike on Nebius and EAS.

## Method

`spikes/nebius-jobs/` with `Dockerfile.cpu` (python:3.12-slim + convex), `convex_write_bench.py`, `run-quickstart.sh`, `run-cpu-bench.sh`, `lifecycle.json`, and (for question 5a) `.github/workflows/nebius-job.yml` **as a proposal file inside the spike folder**, not yet under `.github/` — plan 02.01 installs it. Record every command and output in `results/log.md`. Use the Nebius MCP `nebius_cli_help` tool for flag details; never run delete/update through the MCP.

## Deliverable

`docs/decisions/008-jobs-and-release-logistics.md`: quota/region facts, job timings and costs, the scratch-bucket recipe, the Convex batch size, the chosen launch mechanism with its secrets inventory (names only) and the fallback, Apple/EAS status with dates, and the spend total.

## Done criteria

- [ ] Decision record exists with all seven answers
- [ ] `spikes/nebius-jobs/` committed without secrets
- [ ] One real Nebius job ran to `COMPLETED` on GPU and one on CPU; the scratch bucket has its lifecycle rule
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- No Nebius account/credits or quota is zero — report.
- The Serverless AI product is unavailable in the account's region — report; the fallback (a VM started and stopped by the launcher) is the operator's call.

## Maintenance notes

- Everything here is preview-stage on Nebius's side; re-check CLI flags with `nebius ai job create --help` before plan 02.01 scripts them.

# Nebius infrastructure measurement log

Date: 2026-09-08. Workspace baseline: `deaeaa2`. All cloud checks were read-only;
no job, bucket, service account, key, EAS project, or build was created.
Command results below are condensed. Authentication URLs, OAuth state/PKCE
parameters, masked token lines, email addresses, and unrelated project IDs are
omitted. No token or key values are stored in this log.

## Repository and tool checks

| Command / inspection | Result |
| --- | --- |
| `git status --short` at start | Clean |
| `git worktree list` | Primary checkout located; no environment files there or here |
| Relevant process environment variable names | No Nebius, Convex, EAS, Expo, Apple, or GitHub credential/configuration variables |
| `nebius version` | `0.12.272` |
| `nebius profile list` | `artlog [default]` |
| Selected non-secret profile fields | Federation authentication, API endpoint, project and tenant configured |
| `command -v docker` | Not installed/on PATH |
| `command -v uv`, `command -v gh` | Available |
| `gh auth status` | Authenticated as `dwjiang` |
| App/dependency inspection | Expo ~57.0.20; no iOS bundle ID, EAS project ID, `eas.json`, dev-client dependency, Convex directory/package/configuration |

## Nebius discovery and account access

1. MCP `nebius_available_services`: Serverless `ai`, IAM, Compute, quotas,
   storage, and SecretStash (`mysterybox`) services available in CLI.
2. MCP `nebius_cli_help` for `ai`, `iam project`, `quotas`, and
   `iam token-exchange`: help obtained. Checked job-create flags and service
   account exchange parameters. `ai job create` supports CPU/GPU presets,
   environment secret selectors, S3 profiles, file injection, and 1h–168h
   timeout. Service listing/help is local capability evidence only.
3. `nebius iam project list --format json --no-browser --auth-timeout 20s`:
   browser sign-in requested; authentication deadline exceeded.
4. `nebius ai job list --format json --no-browser --auth-timeout 20s`:
   same authentication failure.
5. `nebius profile create --help`: inspected authentication options only; did
   not create/change a profile or write credentials.

The user was asked to refresh the existing session with
`nebius iam project list` in their terminal. No response/authentication recovery
was available during this execution. Quota, credits, project region and
service-account permissions therefore remain unverified.

## EAS and GitHub

```text
CI=1 npx --yes eas-cli@latest whoami
=> dwjiang (success; email omitted)

CI=1 npx --yes eas-cli@latest project:info
=> EAS project not configured; cannot configure in non-interactive mode.
=> project:info failed.

gh api repos/dwjiang/artlog-app/actions/workflows \
  --jq '{total_count, workflows: [.workflows[] | {name,path,state}]}'
=> {"total_count":0,"workflows":[]}
```

No build or workflow was dispatched. Apple Developer enrollment/date and
App Store Connect/TestFlight group status were requested from the operator;
no answer was available during this execution.

## Documentation and client verification

Read Expo's exact SDK 57 reference at
`https://docs.expo.dev/versions/v57.0.0/`. Rechecked Nebius's published job
quickstart, job configuration, platforms, Compute pricing/quotas, storage
lifecycle, REST authentication, and Convex/EAS/Apple/GitHub documentation.
Primary documentation was downloaded/read; it is not account evidence.

`https://api.nebius.cloud/openapi.json` returned HTTP 403 to an unauthenticated
fetch. REST endpoint/payload findings therefore use the published quickstart
and authentication guide, not an inspected OpenAPI schema.

Python package check (temporary uv environment):

```text
uv run --with convex==0.7.0 python
=> package version: 0.7.0
=> ConvexClient(deployment_url: str)
=> set_admin_auth(admin_key: str) -> None
=> mutation(name: str, args=None)
=> query(name: str, args=None)
```

No `ConvexClient` was connected to a remote deployment.

## Local validation

```text
python3 spikes/nebius-jobs/convex-write-bench.test.py
=> 6 tests passed (batch counts/payloads, partial batches/run IDs,
   failed-write accounting, redacted errors, offline dry run, dev-key gate).

python3 spikes/nebius-jobs/convex-write-bench.py --dry-run
=> 200 rows: 2,457,600 raw payload bytes/mutation, 10,000 rows total
=> 500 rows: 6,144,000 raw payload bytes/mutation, 10,000 rows total
=> 1000 rows: 12,288,000 raw payload bytes/mutation, 10,000 rows total

bash -n spikes/nebius-jobs/run-quickstart.sh spikes/nebius-jobs/run-cpu-bench.sh
=> passed

npx tsc --noEmit
=> exit 2:
src/components/animated-icon.web.tsx(5,21): TS2307: Cannot find module
  './animated-icon.module.css' or its corresponding type declarations.
src/constants/theme.ts(6,8): TS2882: Cannot find module or type declarations
  for side-effect import of '@/global.css'.
```

Both TypeScript errors are in unchanged starter code. ESLint is not configured
or installed, so `npm run lint` was not invoked (it would bootstrap tooling).
No app behavior changed; iOS light-mode verification is not applicable.
Docker build, cloud persistence/throughput, launcher/chaining, and EAS build
validation remain unperformed.

Additional local checks passed: Python syntax for every spike script, all
three lifecycle durations, a temporary-directory scratch round trip, CPU/GPU/S3
and benchmark launcher dry runs, rejection of invalid launcher arguments,
relative documentation links, and `git diff --check`. Placeholder target IDs
were used only in dry runs. The scratch check used a local directory and is
not evidence of S3 persistence.

## Cloud results and spend

| Item | Result |
| --- | --- |
| CPU/GPU completed jobs | None |
| Created scratch bucket / attached lifecycle / independent object read | None |
| Convex benchmark / server-side row-count verification | Not run; dev target and fixture absent |
| Direct REST / GitHub dispatch / chained child | Not run |
| EAS simulator build / TestFlight changes | Not run |
| Incremental Nebius / EAS spend | $0 / $0; no billable resources launched |

Append job IDs, server timestamps, sanitized workload logs, lifecycle readback,
object verification, per-batch metrics and persisted counts, launcher results,
Apple status, and attributable charges here when the prerequisites are restored.

## Retry — 2026-09-08

The user requested another attempt. Authentication now succeeds; suspension
replaces authentication as the immediate blocker. All retry operations were
read-only, and no cloud spend was incurred.

| Command / inspection | Result |
| --- | --- |
| `nebius iam project list --format json --no-browser --auth-timeout 20s` | Success, `{}` in the default project scope |
| `nebius iam project get --id project-e00e99pgpr007wyskm60bb --format json --no-browser --auth-timeout 20s` | `default-project-eu-north1`; `spec.region` and `status.region` = `eu-north1`; `suspension_state` = `SUSPENDED`; `container_state` = `ACTIVE` |
| `nebius iam tenant get --id tenant-e00zsd0b8gb0g2c66g --format json --no-browser --auth-timeout 20s` | Parent tenant also reports `SUSPENDED`, separately from `container_state: ACTIVE` |
| `nebius ai job list --format json --no-browser --auth-timeout 20s` | Success, `{}`; no jobs returned |
| `nebius quotas quota-allowance list --all --format json --no-browser --auth-timeout 20s` | Project entries returned, including VM, CPU, disk and L40S; these entries have no numeric limit field, so this is not proof of usable quota or a zero quota |
| `nebius compute platform list --all --format json --no-browser --auth-timeout 20s` | Required `cpu-d3 / 4vcpu-16gb` and `gpu-l40s-a / 1gpu-8vcpu-32gb` presets are listed |
| `nebius iam service-account list --all --format json --no-browser --auth-timeout 20s` | Only the existing active `mlflow-sa`; left untouched |
| MCP help: `billing`, `iam tenant`, `compute platform`, `iam service-account` | Read before the related commands; billing help exposes cost estimates/exports, not an account balance or suspension reason |
| Workspace app/backend configuration | EAS project link, bundle ID, `eas.json`, and `convex/` still absent |
| Primary-checkout environment variable names | `NEBIUS_API_KEY`, `TAVILY_API_KEY`; no Convex configuration; no values printed or copied |

Read the official [signup/billing guide](https://docs.nebius.com/signup-billing/sign-up),
[quota overview](https://docs.nebius.com/overview/quotas), and
[suspended-tenant documentation](https://docs.nebius.com/overview/data-deletion).
The actual suspension reason and credit balance remain unknown. The next
operator step is to resolve the tenant's state through Billing, or Nebius
support if billing is already active. No attempt was made to alter the
pre-existing tenant/project, make a payment, or launch into the suspended tenant.

Retry changes are documentation-only. Checked the diff and relative links;
the preceding script tests remain applicable without rerunning app tests.

## Retry 2 — 2026-09-09

The user reported billing fixed and asked to rerun the probes. All times UTC.
No secret value was printed, copied, or written to disk; credentials were
generated or read inside single processes and discarded. Nebius CLI 0.12.272
(`~/.nebius/bin/nebius`, not on the non-interactive shell's PATH — call it by
absolute path).

### Authentication and account state

| Command / inspection | Result |
| --- | --- |
| Direct `nebius … --no-browser --auth-timeout 25s` at session start | Browser sign-in requested; deadline exceeded (session expired again) |
| MCP `nebius_cli_execute` `iam project get` | Success; the call refreshed the on-disk session, after which the direct CLI worked (`iam whoami` → user profile) |
| `iam project get --id project-e00e99pgpr007wyskm60bb` | `suspension_state: NONE`, `container_state: ACTIVE`, updated 2026-09-09T06:56:47Z |
| `iam tenant get --id tenant-e00zsd0b8gb0g2c66g` | `pink-bat-tenant-s53`, `suspension_state: NONE` |
| `vpc subnet list --parent-id <project>` | `vpcsubnet-e00nvse36bxzs46x2m` (`default-subnet-vjgi4bbu`) |
| `storage bucket list`, `ai job list` | Empty before this retry |
| `quotas quota-allowance list --parent-id <tenant> --all` (eu-north1) | `compute.instance.gpu.l40s` limit 32; `compute.instance.non-gpu.vcpu` limit **0**; `compute.instance.count` 12; `compute.disk.size.network-ssd` 4 TiB; `storage.bucket.count` 200. Non-GPU vCPU is 200 in eu-west1, eu-west2, uk-south1, uk-south2, us-north1, me-west1 and 0 in us-central1. Project-level allowances carry no numeric limits |
| `compute platform list --all` | `cpu-d3` has `4vcpu-16gb` and `8vcpu-32gb`; `gpu-l40s-a` has `1gpu-8vcpu-32gb` |

### Jobs

| Job | Platform / preset | ID | Created → started → finished | Result |
| --- | --- | --- | --- | --- |
| `run-quickstart.sh cpu` (`python --version`) | `cpu-d3` / `4vcpu-16gb` | none | rejected at create 07:05:04Z | `ResourceExhausted: compute.instance.non-gpu.vcpu (limit 0, requested 4)` for the tenant container; $0 |
| `run-quickstart.sh gpu` (`nvidia-smi`) | `gpu-l40s-a` / `1gpu-8vcpu-32gb` | `aijob-e00rf43r04r7k04gs5` | 07:05:15Z → 07:07:23.99Z → 07:07:24.46Z | `COMPLETED`; log shows `NVIDIA L40S`, driver 580.173.02, CUDA 13.1, 46,068 MiB |
| `run-quickstart.sh scratch` with `NEBIUS_SCRATCH_BUCKET_ID` (bucket-ID mount) | `gpu-l40s-a` (CPU quota 0) | `aijob-e00qayrgs3n2x2bc8n` | 07:11:52Z → 07:13:40.18Z → 07:13:40.73Z | `COMPLETED`; `{"object_key": "artlog-0008-1eba7817-7442-4f87-92f5-c13f7b09c665.txt", "bytes": 38, "round_trip": true}` |
| `run-quickstart.sh scratch` with `NEBIUS_S3_SECRET` (s3:// mount), attempt 1 | — | none | rejected client-side 07:12:02Z | `failed to load AWS config: failed to get shared config profile, default` — the CLI needs a local AWS shared config profile even when credentials come from SecretStash |
| same, attempt 2 with `AWS_CONFIG_FILE` (region + endpoint_url, no credentials) | — | none | rejected server-side 07:13:18Z | `s3 credentials secret is invalid, must have S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY keys in the payload` |
| same, attempt 3 after adding a secret version with the `S3_*` keys | `gpu-l40s-a` | `aijob-e00r5qetvwz0301ss5` | 07:13:53Z → 07:15:38.54Z → 07:15:39.04Z | `COMPLETED`; `{"object_key": "artlog-0008-ee8b919f-effa-46a4-932c-36b0f84cb983.txt", "bytes": 38, "round_trip": true}`; job spec shows `s3_config { endpoint, region, mysterybox_secret { secret_id, version_id } }` |

Observed state sequence for the GPU job (polled every 10 s with `ai job get`):
`STARTING` (compute instance already `RUNNING`) at the first poll 07:06:31Z,
`IMAGE_PULLING` 07:07:12Z, `COMPLETED` by 07:07:44Z. Workload log: init
07:06:44Z, image download 07:06:57Z, container start 07:07:23Z. The
`python:3.12-slim` probes pulled in ~2 s. CLI behaviour worth knowing:
`ai job create` **blocks until the job reaches a terminal state** and prints
plain text (first line `Job ID: aijob-…`) even with `--format json`;
`ai job get --format json` returns `status.state`, `started_at`, `finished_at`;
`ai job logs <id> --timestamps` works after completion.

### Scratch bucket

```text
nebius storage bucket create --parent-id <project> --name artlog-scratch \
  --lifecycle-configuration-rules '[{"id":"artlog-scratch-expire-after-three-days","status":"ENABLED","filter":{"prefix":""},"expiration":{"days":3},"noncurrent_version_expiration":{"noncurrent_days":3},"abort_incomplete_multipart_upload":{"days_after_initiation":3}}]'
=> storagebucket-e007391623532510352106, state ACTIVE, versioning DISABLED
nebius storage bucket get --id storagebucket-e007391623532510352106
=> rule artlog-scratch-expire-after-three-days ENABLED; expiration 3 d; noncurrent 3 d; abort multipart 3 d
```

Independent read-back with boto3 (`uv run --with boto3`, endpoint
`https://storage.eu-north1.nebius.cloud`, region `eu-north1`, credentials read
from SecretStash inside the process): before the probes `KeyCount 0`; after
them both objects present, `HEAD` 200, 38 bytes, content equal to
`artlog plan 00.08 scratch mount probe\n`.

### Credentials and permissions (names and IDs only)

```text
iam service-account create --name artlog-jobs-sa            => serviceaccount-e00bryft11k8ek0qs9
iam access-permit create --parent-id <sa> …                => InvalidArgument: Parent should be one of [group]
iam group create --parent-id <tenant> --name artlog-jobs   => group-e00a015x4pjexywxcb
iam access-permit create --parent-id <group> --resource-id <project> --role editor => accesspermit-e00s6vs5wygzxmad6v
iam group-membership create --parent-id <group> --member-id <sa> => groupmembership-e00yt3qwt7m6hmpv07
iam v2 access-key create --account-service-account-id <sa> --secret-delivery-mode mystery_box --name artlog-scratch-s3
  => accesskey-e00j6txnxsmq2h6w8z, aws_access_key_id NAKIHIAX5BJEF2J9PBP1, secret stored as mbsec-e00gw97dkda15bb9gm
     ("Secret for accesskey-…", single payload key `secret`)
mysterybox secret create --name artlog-scratch-s3           => mbsec-e00xz63wx5x9tnkym8 (AWS_* / aws_* keys; not accepted by the mount)
mysterybox secret-version create --set-primary (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) => mbsecver-e00xt7vcv7fsegscdb
```

### REST launch path (service account)

```text
iam auth-public-key create --data <RSA-2048 PEM>  => InvalidArgument: expected size between 4096 and 4096
iam auth-public-key create --data <RSA-4096 PEM> --expires-at 2026-09-10T…Z --name artlog-0008-rest-probe
  => publickey-e00vh7f19v9m88p9bf (private key generated in memory with `cryptography`, never written)
JWT RS256 {kid: <key id>} {iss: <sa>, sub: <sa>, iat, exp: +300 s}
POST https://auth.eu.nebius.com:443/oauth2/token/exchange (grant_type=token-exchange, requested_token_type=access_token, subject_token=<jwt>, subject_token_type=jwt)
  => 200 in 690 ms; keys access_token, expires_in 43200, issued_token_type access_token, token_type
GET https://api.nebius.cloud/ai/v1/jobs?parentId=<project> (Bearer)
  => 200 application/json; items: artlog-0008-gpu-20260909070515-20024
GET https://api.nebius.cloud/openapi.json (Bearer, user token from `iam get-access-token`, kept in-process)
  => 200, 1,394,914 bytes; POST /ai/v1/jobs = JobService_Create, body {dryRun, metadata, spec};
     spec: args, containerCommand, disk, environmentVariables, image, injectedFiles, platform, ports,
     preemptible, preset, publicIp, registryCredentials, restartAttempts, shmSizeBytes, sshAuthorizedKeys,
     subnetId, timeout, volumes, workingDir; also /ai/v1/jobs/{id}, /cancel, /get-by-name, /restart, /operations
```

### Not run this retry

- Convex write benchmark: no configured Convex deployment or Docker image at
  the time of the measurement; CPU preset quota-blocked.
- Chaining (a job launching a job): untested; a job has no identity of its own
  and would need the service-account key via `--env-secret` plus the exchange
  above. Keep launches central.
- Apple/EAS: `eas whoami` → `dwjiang`; `project:info` still fails (no EAS
  link); no `eas.json`, bundle ID or dev client at that time; Docker
  absent; Apple enrollment and App Store Connect status unknown.

### Spend

Three L40S runs, create → finish 2 m 09 s + 1 m 48 s + 1 m 46 s ≈ 5 m 43 s of
billed VM time at the published $1.5484/h ≈ **$0.15**, plus three default
250 GiB container disks for those minutes (cents) and 76 bytes of Object
Storage. Rejected creates cost nothing. The billing CLI exposes only calculator
estimates and one-time exports; read the actual figure in the console.

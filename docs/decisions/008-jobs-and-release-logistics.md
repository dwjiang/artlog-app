# 008 — Nebius jobs and release logistics

Date: 2026-09-08, retried 2026-09-09. Status: **Nebius half DONE — the L40S
job path, the scratch bucket (both mount forms) and the service-account REST
launch path work; the CPU preset was not exercised because the non-GPU vCPU
quota is 0 in `eu-north1`, which is plan 02.10's cost lever, not this spike's
blocker. Apple/EAS readiness (§6) waits on plan 01.04 and the operator.**
Implements [plan 00.08](../plans/00-kickoff-spikes/08-nebius-jobs-and-release-logistics.md).
Evidence and verification commands are in
[the execution log](../../spikes/nebius-jobs/results/log.md); the
[resume runbook](../../spikes/nebius-jobs/README.md) describes what remains.

Plans 02.01–02.05 do not depend on this record: the initial index build runs
locally on the operator's Mac (see `docs/plans/README.md`, "Decisions made
while planning"), and plan 02.05's local smoke push measures the Convex batch
size. Plan 02.10 (containers and launcher) consumes sections 3 and 5; the CPU quota
decides only whether its workers cost ≈ $0.10/h or ≈ $1.55/h. Plan 04.05
ships with `CRAWL_LAUNCH_MODE=off`.

## 1. Account, region, quota, and credentials

| Check | Result on 2026-09-09 |
| --- | --- |
| Tenant / project | `pink-bat-tenant-s53` / `default-project-eu-north1` (`project-e00e99pgpr007wyskm60bb`), region `eu-north1`, `suspension_state: NONE` since 2026-09-09 ~06:56 UTC |
| Subnet for jobs | `vpcsubnet-e00nvse36bxzs46x2m` |
| Tenant quotas, `eu-north1` | L40S GPUs **32**; non-GPU vCPU **0**; instances 12; network-SSD 4 TiB; buckets 200. Non-GPU vCPU is 200 in `eu-west1`, `eu-west2`, `uk-south1`, `uk-south2`, `us-north1`, `me-west1`; 0 in `us-central1`. Read quotas on the tenant: project-level allowances carry no numbers |
| CPU / GPU presets | `cpu-d3` `4vcpu-16gb` and `8vcpu-32gb`; `gpu-l40s-a` `1gpu-8vcpu-32gb` — listed and (GPU) proven |
| Job identity | Service account `artlog-jobs-sa` (`serviceaccount-e00bryft11k8ek0qs9`) in group `artlog-jobs` (`group-e00a015x4pjexywxcb`, under the tenant) holding `editor` on the project (`accesspermit-e00s6vs5wygzxmad6v`). Access permits attach to **groups**, never to accounts directly |
| CLI authentication | Federation profile `artlog`; the interactive session expires within a day. A Nebius MCP-server call refreshed it non-interactively this time. Start every session with `nebius iam whoami --no-browser --auth-timeout 20s` |
| Local tooling | Docker and the AWS CLI are absent; neither was needed (bucket lifecycle is native to the Nebius CLI; `uv run --with boto3` reads the bucket) |

**CPU quota — plan 02.10's prerequisite, not this spike's:** nothing before
02.10 runs Nebius CPU work. If 02.10 chooses Nebius for the crawler, request an
increase of `compute.instance.non-gpu.vcpu` for `eu-north1` in the console
(Quotas), for example 16 vCPU, which covers two `4vcpu-16gb` crawler workers or
one `8vcpu-32gb` metadata run. Until it lands, the same jobs run on the
`gpu-l40s-a 1gpu-8vcpu-32gb` preset (8 vCPU) at ≈ $1.55/h instead of
≈ $0.10/h — about $0.90 instead of $0.06 for a capped 35-minute venue crawl.
A second project in a region that already has 200 vCPU would need its own
bucket, secrets and service account, and the L40S stays `eu-north1`-only.

## 2. CPU and GPU jobs, timing, and cost

| Workload | Platform / preset | Job ID | Create → running → completed | Cost (estimated) |
| --- | --- | --- | --- | --- |
| `nvidia-smi` | `gpu-l40s-a` / `1gpu-8vcpu-32gb` | `aijob-e00rf43r04r7k04gs5` | 07:05:15Z → 07:07:24Z (2 m 09 s) → 07:07:24Z (workload 0.5 s) | ≈ $0.06 |
| Python version | `cpu-d3` / `4vcpu-16gb` | not created | rejected at create: `compute.instance.non-gpu.vcpu (limit 0, requested 4)` | $0 |
| Scratch probe, bucket-ID mount | `gpu-l40s-a` | `aijob-e00qayrgs3n2x2bc8n` | 07:11:52Z → 07:13:40Z (1 m 48 s) → +0.6 s | ≈ $0.05 |
| Scratch probe, s3:// mount | `gpu-l40s-a` | `aijob-e00r5qetvwz0301ss5` | 07:13:53Z → 07:15:39Z (1 m 46 s) → +0.5 s | ≈ $0.05 |

Phases observed: `STARTING` about 75 s after create (the VM is already
`RUNNING`), `IMAGE_PULLING` (~30 s for the 3 GB CUDA runtime image, ~2 s for
`python:3.12-slim`), `RUNNING`, `COMPLETED`. Budget **~2 minutes of overhead
per job** before the workload starts. The GPU log confirms an NVIDIA L40S,
driver 580.173.02, CUDA 13.1, 46,068 MiB.

CLI behaviour that scripts must handle: `nebius ai job create` **blocks until
the job reaches a terminal state** and prints plain text (`Job ID: aijob-…`
first) even with `--format json`; `nebius ai job get --format json` exposes
`status.state`, `started_at`, `finished_at`; `nebius ai job logs <id>
--timestamps` works after completion. The default container disk is 250 GiB.

Costs are estimates from the published per-second rate ($1.5484/h for the L40S
preset) over create→finish time; the billing CLI offers only calculator
estimates and one-time exports, so the console Billing view is the authority.

## 3. Scratch bucket and lifecycle

`artlog-scratch` (`storagebucket-e007391623532510352106`) was created with
`nebius storage bucket create --lifecycle-configuration-rules '[…]'` — no AWS
CLI required — and read back with `storage bucket get`: rule
`artlog-scratch-expire-after-three-days`, `ENABLED`, expiration 3 days,
noncurrent-version expiration 3 days, abort incomplete multipart uploads after
3 days; versioning `DISABLED`. Lifecycle evaluation is nightly, so the rule is
an orphan backstop, **not** end-of-run cleanup; jobs still delete their own
scratch objects (design §5.5–5.7).

Two mount forms are proven (both run on the L40S because of the CPU quota):

- **Bucket resource ID** — `--volume storagebucket-…:/mnt/scratch:rw`. No S3
  credentials, no local AWS config. **Preferred for plan 02.10.**
- **S3 form** — `--volume s3://artlog-scratch:/mnt/scratch:rw:default@<secret selector>`.
  The CLI resolves endpoint and region from a **local AWS shared config
  profile** (`AWS_CONFIG_FILE` pointing at `[default]` with `region =
  eu-north1` and `endpoint_url = https://storage.eu-north1.nebius.cloud`; no
  credentials in it), and the SecretStash secret **must carry payload keys
  `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`** (the server names them in
  its error). The job spec then records `s3_config { endpoint, region,
  mysterybox_secret { secret_id, version_id } }`.

For plan 02.10 the bucket is optional after plans 04.05 and 02.06 implement
durable per-URL crawl state in Convex (`crawlPages`) and prove resume with an
empty scratch directory. The crawler writes both results and change-detection
state to Convex; only jobs with filesystem checkpoints across runs (a full
re-embed) mount the bucket. It exists already and costs nothing while empty.

Each probe wrote a 38-byte object and read it back inside the job; both objects
were then read independently over S3 with the service account's access key
(`HEAD` 200, content identical). Credentials inventory, names and IDs only:
access key `artlog-scratch-s3` (`accesskey-e00j6txnxsmq2h6w8z`, AWS ID
`NAKIHIAX5BJEF2J9PBP1`) created with `--secret-delivery-mode mystery_box`,
which stores the secret half in SecretStash (`mbsec-e00gw97dkda15bb9gm`) under
one payload key `secret` — fine for `--env-secret`, not accepted by an s3://
mount; mount secret `artlog-scratch-s3` (`mbsec-e00xz63wx5x9tnkym8`), primary
version `mbsecver-e00xt7vcv7fsegscdb` with the `S3_*` keys, created in-process
from the auto secret so no value was ever printed or written.

## 4. Convex Python writes and batch size

Not measured. No Convex deployment exists (plan 01.03 is pending), the
benchmark image needs Docker (absent), and the CPU preset has no quota (it
could have run on the L40S, but with no Convex deployment there is nothing to
write to).
Re-scoped on 2026-09-08: plan 02.05's local smoke push measures rows/s for the
real build path, and plan 02.10 can repeat it in the cloud if wanted. The
harness facts stand: 16 MiB per mutation and per arguments, 16,000 documents
per mutation, start at 200 rows and grow only after server-side counts match.

## 5. Launch mechanism and chaining

**Decision: direct Nebius REST from a Convex action (option b); GitHub
`workflow_dispatch` stays the fallback.** The service-account path was proven
on 2026-09-09 outside Convex:

1. Authorized key: `nebius iam auth-public-key create --parent-id <project>
   --account-service-account-id <sa> --data "<PEM>" --expires-at …`. RSA
   **4096-bit only** (2048 is rejected). Key `publickey-e00vh7f19v9m88p9bf`,
   expires 2026-09-10; the private key was generated in memory and discarded.
2. JWT, RS256, header `kid` = key ID; claims `iss` = `sub` = service-account
   ID, `iat`, `exp` = +300 s.
3. `POST https://auth.eu.nebius.com:443/oauth2/token/exchange` with the
   documented form fields → 200 in 690 ms, `expires_in` 43200 (12 h).
4. `GET https://api.nebius.cloud/ai/v1/jobs?parentId=<project>` with the bearer
   token → 200, listing this spike's job.

The authenticated OpenAPI document (`https://api.nebius.cloud/openapi.json`,
1.4 MB) gives plan 02.10 the create shape: `POST /ai/v1/jobs`
(`JobService_Create`), body `{ dryRun, metadata { parentId, name }, spec }`
with `spec` fields `args`, `containerCommand`, `disk`, `environmentVariables`,
`image`, `injectedFiles`, `platform`, `ports`, `preemptible`, `preset`,
`publicIp`, `registryCredentials`, `restartAttempts`, `shmSizeBytes`,
`sshAuthorizedKeys`, `subnetId`, `timeout`, `volumes`, `workingDir`; related
paths `/ai/v1/jobs/{id}`, `/cancel`, `/get-by-name`, `/restart`,
`/operations`.

Still open for plan 02.10: creating a job through `POST /ai/v1/jobs` (schema
above) and doing the signing inside Convex (WebCrypto import of a 4096-bit
PKCS8 key; the private key lives in Convex env). **Chaining is untested**: a
job has no identity of its own, so a worker would need the authorized key
through `--env-secret` and the same exchange. Keep launches central.

Secrets inventory, **names only**:

| Location | Names | Purpose |
| --- | --- | --- |
| Convex environment | `NEBIUS_SERVICE_ACCOUNT_ID`, `NEBIUS_AUTH_PUBLIC_KEY_ID`, `NEBIUS_PRIVATE_KEY_PEM` (4096-bit) | Signing identity/key |
| Launcher configuration | `NEBIUS_PROJECT_ID`, `NEBIUS_SUBNET_ID`, `NEBIUS_SCRATCH_BUCKET_ID`, `CONVEX_URL` | Non-secret targets |
| SecretStash | `artlog-convex-deploy-key` with `CONVEX_DEPLOY_KEY` | Job writes to Convex |
| SecretStash | `artlog-scratch-s3` with `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Only if an s3:// mount is used |
| GitHub fallback only | `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO` (Convex); `NEBIUS_SA_KEY`, `NEBIUS_PROJECT_ID`, `NEBIUS_SUBNET_ID` (repo secrets) | Dispatch path |

## 6. Apple and EAS readiness

Unchanged on 2026-09-09.

| Check | Status |
| --- | --- |
| EAS authentication | `eas whoami` → `dwjiang` |
| EAS project link | Absent; `project:info` fails in non-interactive mode |
| Build profiles / dev client / bundle ID | `eas.json`, `expo-dev-client` and `ios.bundleIdentifier` absent; plan 01.04 pending |
| Development simulator cloud build | Not submitted; prerequisites missing |
| Apple Developer enrollment / date | Unknown; operator status requested |
| App Store Connect app / internal TestFlight group | Unknown |
| Remaining EAS build quota | Unknown; the published allowance is 15 iOS builds/month, 45-minute timeout |

After plan 01.04 supplies the linked project and `development-simulator`
profile, run the single `eas build --platform ios --profile
development-simulator` on the operator's say-so and record ID, status, elapsed
time and quota effect. A simulator build proves the pipeline only; TestFlight
signing and Beta App Review still depend on Apple enrollment. TestFlight builds
expire after 90 days; the first external build needs Beta App Review with no
promised turnaround — submit early.

## 7. Spend, resources left in place, and remaining gates

Incremental spend: **≈ $0.15–0.25 Nebius** (three L40S runs totalling about
5 m 43 s of billed VM time, their default container disks, 76 bytes of
storage) **+ $0 EAS**. Rejected creates cost nothing. Confirm in the console.

Resources created by this spike and left for plan 02.10 (none idles or bills
meaningfully): service account `artlog-jobs-sa`, group `artlog-jobs` with its
`editor` permit and membership, access key `artlog-scratch-s3` and its auto
secret, secret `artlog-scratch-s3`, authorized key `artlog-0008-rest-probe`
(expires 2026-09-10), bucket `artlog-scratch` (two 38-byte objects the
lifecycle rule removes within 3 days), three `COMPLETED` jobs. Delete them
from the console if 02.10 is abandoned.

Remaining gates: (1) Apple/EAS — plan 01.04, then the simulator build, Apple
enrollment date, App Store Connect record and TestFlight group (operator);
(2) REST job creation and in-Convex signing — plan 02.10; (3) the Convex batch
measurement — plan 02.05 locally. The CPU vCPU quota is a 02.10 prerequisite
(or accept L40S rates), not a gate here.

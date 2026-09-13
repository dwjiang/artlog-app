# Nebius jobs probes

Measured 2026-09-09: an L40S job, scratch persistence, and service-account REST
authentication succeeded. The CPU preset was not exercised because the
`compute.instance.non-gpu.vcpu` quota was 0 in `eu-north1`.
Read the [batch infrastructure findings](../../docs/todos/experiment-findings/README.md#batch-infrastructure)
and [execution log](results/log.md) for evidence and limits. These are isolated
probes; the production index jobs run locally.

## Local verification (no cloud access or credentials)

From the repository root:

```bash
python3 spikes/nebius-jobs/convex-write-bench.test.py
python3 spikes/nebius-jobs/convex-write-bench.py --dry-run
bash -n spikes/nebius-jobs/run-quickstart.sh spikes/nebius-jobs/run-cpu-bench.sh
NEBIUS_PROJECT_ID=project-placeholder NEBIUS_SUBNET_ID=subnet-placeholder \
  bash spikes/nebius-jobs/run-quickstart.sh cpu --dry-run
```

`--dry-run` prints the `nebius ai job create` command and never calls the CLI.

## Facts every rerun depends on

- The CLI lives at `~/.nebius/bin/nebius` and is only on PATH in interactive
  shells (`~/.nebius/path.zsh.inc`). Its federation session expires within a
  day; check with `nebius iam whoami --no-browser --auth-timeout 20s` first.
  If it asks for a browser, sign in from a terminal (`nebius iam project
  list`) — a Nebius MCP-server call also refreshed the session once.
- Verified targets: project `project-e00e99pgpr007wyskm60bb` (`eu-north1`),
  subnet `vpcsubnet-e00nvse36bxzs46x2m`, bucket `artlog-scratch`
  (`storagebucket-e007391623532510352106`), service account `artlog-jobs-sa`
  in group `artlog-jobs` (`editor` on the project), mount secret
  `artlog-scratch-s3` (`mbsec-e00xz63wx5x9tnkym8`). Never delete resources you
  did not create.
- `nebius ai job create` blocks until the job ends and prints plain text
  (`Job ID: aijob-…` first) even with `--format json`. Poll with
  `nebius ai job get --id <id> --format json` (fields `status.state`,
  `started_at`, `finished_at`) and read `nebius ai job logs <id>
  --timestamps` afterwards. Expect about two minutes of overhead per job.
- Quotas live on the tenant: `nebius quotas quota-allowance list --parent-id
  tenant-e00zsd0b8gb0g2c66g --all`. Non-GPU vCPU is 0 in `eu-north1` until
  the operator requests more; L40S is 32.

## Probes

```bash
export PATH="$HOME/.nebius/bin:$PATH"
export NEBIUS_PROJECT_ID=project-e00e99pgpr007wyskm60bb NEBIUS_SUBNET_ID=vpcsubnet-e00nvse36bxzs46x2m
bash spikes/nebius-jobs/run-quickstart.sh gpu     # nvidia-smi on gpu-l40s-a — proven 2026-09-09
bash spikes/nebius-jobs/run-quickstart.sh cpu     # python --version on cpu-d3 — needs the vCPU quota (0 today)
```

Scratch mount, bucket-ID form (no credentials):

```bash
NEBIUS_SCRATCH_BUCKET_ID=storagebucket-e007391623532510352106 NEBIUS_SCRATCH_ON_GPU=1 \
  bash spikes/nebius-jobs/run-quickstart.sh scratch
```

Scratch mount, s3:// form with SecretStash credentials: the CLI needs a local
AWS shared config profile for region and endpoint (no credentials in it), and
the secret must carry `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`:

```bash
printf '[default]\nregion = eu-north1\nendpoint_url = https://storage.eu-north1.nebius.cloud\n' > /tmp/artlog-aws-config
AWS_CONFIG_FILE=/tmp/artlog-aws-config NEBIUS_SCRATCH_BUCKET=artlog-scratch \
  NEBIUS_S3_SECRET=mbsec-e00xz63wx5x9tnkym8 NEBIUS_SCRATCH_ON_GPU=1 \
  bash spikes/nebius-jobs/run-quickstart.sh scratch
```

`NEBIUS_SCRATCH_ON_GPU=1` moves the probe to the L40S platform while the CPU
quota is 0. Verify persistence out of band with `uv run --with boto3` against
`https://storage.eu-north1.nebius.cloud`, reading the credentials from
SecretStash inside the process (`nebius mysterybox payload get-by-key`) and
never printing them; the object body must equal
`artlog plan 00.08 scratch mount probe` plus a newline.

## Credentials rules

Access keys: `nebius iam v2 access-key create --account-service-account-id
<sa> --secret-delivery-mode mystery_box` stores the secret half in SecretStash
without printing it (payload key `secret`; the AWS ID is on the key resource).
For an s3:// mount, build a second secret or version with the `S3_*` keys from
inside one process. Authorized keys for the REST path must be RSA 4096; generate
them in memory and only upload the public half (`iam auth-public-key create
--data "<PEM>"`). Access permits attach to groups: create a group under the
tenant, permit the role on the project or bucket, then add the service account
as a member. Do not write tokens, private keys or S3 secrets to files, Docker
build arguments, result logs, or this README.

## Convex benchmark (deferred)

Requires a personal dev deployment with the temporary contract below, a
published `Dockerfile.cpu` image, and an available CPU preset.
The [production import workflow](../../jobs/README.md#dedupe-hubs-and-convex-import)
documents the measured batch limits.

| Surface | Contract |
| --- | --- |
| Scratch table `spikeJobRows` | `runId: string`, `ordinal: number`, `payload: bytes`; index `by_runId` |
| `spikeJobs:insertBatch` | Internal mutation, admin auth only; args `{ runId, rows: [{ ordinal, payload }] }`; reject empty batches, more than 1,000 rows, or payloads not exactly 12,288 bytes |
| Verification | Count the table by run ID; require 10,000 rows with every ordinal exactly once |
| Cleanup | Delete only this spike's run IDs in bounded batches after capturing evidence |

Then `bash spikes/nebius-jobs/run-cpu-bench.sh --dry-run` and, with
`NEBIUS_BENCH_IMAGE`, `CONVEX_URL` and `NEBIUS_CONVEX_SECRET` set, the real run.

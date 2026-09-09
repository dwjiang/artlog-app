#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ( $# -eq 2 && "$2" != "--dry-run" ) ]]; then
  echo 'Usage: run-quickstart.sh cpu|gpu|scratch [--dry-run]' >&2
  exit 2
fi

spike_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
kind="$1"
case "$kind" in
  cpu|scratch) platform=cpu-d3; preset=4vcpu-16gb; image=python:3.12-slim ;;
  gpu) platform=gpu-l40s-a; preset=1gpu-8vcpu-32gb; image=nvidia/cuda:13.1.1-runtime-ubuntu24.04 ;;
  *) echo 'Expected cpu, gpu, or scratch.' >&2; exit 2 ;;
esac
# The tenant's non-GPU vCPU quota in eu-north1 was 0 on 2026-09-09; the scratch
# probe only needs a mount, so allow running it on the L40S platform instead.
if [[ "$kind" == scratch && -n "${NEBIUS_SCRATCH_ON_GPU:-}" ]]; then
  platform=gpu-l40s-a; preset=1gpu-8vcpu-32gb
fi

: "${NEBIUS_PROJECT_ID:?Set NEBIUS_PROJECT_ID to the verified eu-north1 project}"
: "${NEBIUS_SUBNET_ID:?Set NEBIUS_SUBNET_ID to a subnet in that project}"

job_name="artlog-0008-${kind}-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
cmd=(nebius ai job create --parent-id "$NEBIUS_PROJECT_ID"
  --subnet-id "$NEBIUS_SUBNET_ID" --name "$job_name"
  --platform "$platform" --preset "$preset" --image "$image"
  --timeout 1h --restart-policy never --format json)

case "$kind" in
  cpu) cmd+=(--container-command python --args '--version') ;;
  gpu) cmd+=(--container-command nvidia-smi) ;;
  scratch)
    cmd+=(--container-command python --args /spike/scratch-probe.py
      --inject-file "$spike_dir/scratch-probe.py:/spike/scratch-probe.py")
    if [[ -n "${NEBIUS_SCRATCH_BUCKET_ID:-}" ]]; then
      # Mount by bucket resource ID: no S3 credentials involved.
      cmd+=(--volume "${NEBIUS_SCRATCH_BUCKET_ID}:/mnt/scratch:rw")
    else
      : "${NEBIUS_SCRATCH_BUCKET:?Set the name of the bucket created by this spike}"
      : "${NEBIUS_S3_SECRET:?Set the SecretStash selector for the S3 credentials}"
      cmd+=(--volume "s3://${NEBIUS_SCRATCH_BUCKET}:/mnt/scratch:rw:default@${NEBIUS_S3_SECRET}")
    fi
    ;;
esac

if [[ "${2:-}" == --dry-run ]]; then
  printf '%q ' "${cmd[@]}"
  printf '\n'
  exit 0
fi

printf 'Creating %s at %s\n' "$job_name" "$(date -u +%FT%TZ)" >&2
"${cmd[@]}"
printf 'Inspect this job with: nebius ai job get-by-name --parent-id %q --name %q\n' \
  "$NEBIUS_PROJECT_ID" "$job_name" >&2

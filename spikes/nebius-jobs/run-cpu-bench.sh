#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--dry-run" ) ]]; then
  echo 'Usage: run-cpu-bench.sh [--dry-run]' >&2
  exit 2
fi

: "${NEBIUS_PROJECT_ID:?Set the verified eu-north1 project ID}"
: "${NEBIUS_SUBNET_ID:?Set a subnet in that project}"
: "${NEBIUS_BENCH_IMAGE:?Set the published Dockerfile.cpu image reference}"
: "${CONVEX_URL:?Set the verified personal dev deployment URL}"
: "${NEBIUS_CONVEX_SECRET:?Set the SecretStash selector containing the dev CONVEX_DEPLOY_KEY}"

job_name="artlog-0008-convex-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
cmd=(nebius ai job create --parent-id "$NEBIUS_PROJECT_ID"
  --subnet-id "$NEBIUS_SUBNET_ID" --name "$job_name"
  --image "$NEBIUS_BENCH_IMAGE" --platform cpu-d3 --preset 4vcpu-16gb
  --timeout 1h --restart-policy never --format json
  --env "CONVEX_URL=$CONVEX_URL"
  --env-secret "CONVEX_DEPLOY_KEY=$NEBIUS_CONVEX_SECRET")

if [[ "${1:-}" == --dry-run ]]; then
  printf '%q ' "${cmd[@]}"
  printf '\n'
  exit 0
fi

printf 'Creating %s at %s\n' "$job_name" "$(date -u +%FT%TZ)" >&2
"${cmd[@]}"

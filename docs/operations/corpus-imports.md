# Corpus imports

The Python importer writes metadata to Convex and feature bytes directly to
private R2 storage. Pinecone is a rebuildable search index; Convex remains the
authority for identity, provenance, ownership, and eligibility.

## Select inputs and target

Confirm the target URL, deployment-scoped credential, R2 bucket, and Pinecone
index before writing. A credential filename does not prove its deployment.
Development and production use separate storage and indexes. Keep development
`.env.local` intact during production jobs; use process-scoped settings or a
private credential file, and never print its contents.

From `scripts/data/`, inspect a package without contacting a deployment:

```sh
uv run python -m pipeline.push --in /absolute/path/to/corpus --full --dry-run
```

The local preflight validates manifests, hashes, feature shapes, merge targets,
identities, metadata counts, and thumbnail rights. Missing images do not justify
invented features, coordinates, or rights. A deployment preflight checks overlap
and all required museum keys against the live target.

For an authorized import, configure `CONVEX_URL` and `CONVEX_DEPLOY_KEY` for the
job, then select an explicit checkpoint:

```sh
uv run python -m pipeline.push --in /absolute/path/to/corpus \
  --full --checkpoint /absolute/path/to/run/push.json --verify-fraction 0.02
```

Use a separate `--limit 30` checkpoint and `--verify-fraction 1` for a small pilot.
The default sample is 1,000 objects; full imports require `--full`. These commands
are operational procedures, not authorization to deploy or write to production.

## Checkpoints and verification

Checkpoints bind corpus fingerprint, deployment URL, and Pinecone index.
Preflight counts must remain unchanged until writes begin. Ordered commits
advance resumable offsets; file reservation/completion batches contain at most
100 rows. Matching archives are reused after validating hashes.

A successful run requires matching counts, zero thumbnail-rights violations,
deterministic source/stage readback, and a ready Pinecone sync queue.
`--verify-fraction 1` verifies every imported row; the default 2% sample does not.
Sampled verification cannot establish camera accuracy or device attestation.
Use authenticated recognition checks for known references, missing geometry,
and unsupported model versions, plus physical-iPhone scans for capture behavior.

Reports accompany the checkpoint as `.report.json`. Record usage and retain
reports without credentials. Payload sizes and local timings are not billed
storage or guaranteed throughput. Respect the configured spending threshold;
automation must not raise it or change billing plans to finish an import.

## Recovery and derived data

Run only one writer against a checkpoint. Keep the Mac powered and connected;
the importer executes locally. Inspect failures before resuming with the same
inputs, target, index, and checkpoint. Preserve progress on ordinary connection
failures; changed inputs or targets require a separate reviewed checkpoint.

Stop on missing references, failed readback, failed sync, exhausted capacity,
persistent limits, or incorrect recognition. Diagnose the cause; do not reset
data, weaken assertions, raise spending limits, or retrain a calibrator to force
success. Revoke temporary import credentials and delete their private files when
the job and verification finish.

After importing, rebuild museum picks and refresh search fields, artist covers,
and popular tags as described in [production operations](production.md).
Regenerate the venue asset from the selected deployment and refresh affected
[museum packages](museum-downloads.md).

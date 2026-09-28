# Full corpus upload to production

**Completed on 2026-09-27 at 22:58 PDT.** Full counts, 46,412 sampled record
checks, 8,201 sampled thumbnail checks, and all five public recognition API
checks passed. Usage was recorded and the temporary import credentials were
revoked and removed. Physical iPhone acceptance remains separate.

The optimized importer is deployed to
production `admired-goldfinch-660` in `daniel-jiang/artlog`. The production job
started at 10:52 PDT with museum restoration and a 30-object pilot, followed by
the full preflight. At 11:29 PDT it restarted with four concurrent preflight reads,
four feature-preparation batches, 32 R2 upload workers, and pooled connections.
A 1,000-object speed pilot gates the resumed full run. A running process is not a completed import: consult the durable
status, checkpoint, and verification reports below.

The first speed pilot passed at 11:32 PDT. Its 400-row batches measured
about 10–11 seconds for vectors versus
29 seconds sequentially, and 11 seconds for ORB versus 28 seconds sequentially.
Its initial 10–13 hour estimate included preflight and verification. Evidence is in
`upload-speed-benchmark.json` and `eta-after-speedup.json` in the run directory.

At 14:42 PDT, an R2 verification connection closed and stopped the job at
53,200 vectors. The importer now retries that specific transport failure against
the same file IDs, without relaxing checksum checks. It resumed from the saved
checkpoint at 15:47 PDT; `transport-retry-resume.json` records the recovery.

At 16:06 PDT the full job resumed with continuous preparation, ordered 100-row
commits/checkpoints, and 32 concurrent verification requests per batch. A real
production benchmark advanced 3,200 vectors and 3,200 descriptors, with 128
sampled feature payloads matching. The 2,400-row continuous portions measured
69.6 vectors/s and 73.0 descriptors/s; 2 vectors and 249 descriptors reused files.
The descriptor estimate conservatively uses 65.4 new uploads/s. The remaining
4.5–6 hour estimate includes verification and is not a completion claim.
`continuous-benchmark.json` and `continuous-start.json` record the comparison,
resume offsets, process, checks, and estimate. The reference batches also used
the faster verification and reused some files, so they are not pure fresh-file
comparisons with the earlier pilot.

All six upload stages reached their full input counts at 20:25 PDT. Pinecone
sync is ready. At 20:40 PDT, sampled vector readback stopped on the same R2 TLS
disconnect; the bounded, sanitized retry now also covers the two idempotent
readback actions. Verification resumed at 20:47 PDT from the completed upload
checkpoint; `readback-retry-resume.json` records the process and passing checks.
The user separately added museums to match development, bringing the museum
count to 42,452. `museum-count-reconciliation.json` records the live unique-key
check and the adjustment to the museum expectation; corpus counts and the
original baseline remain unchanged.

Full sampled readback finished at 22:26 PDT with zero mismatches or thumbnail
violations. The public recognition check initially stopped because the
operational script still expected `lr-v2`, although the PCA512 calibrator had
already adopted `lr-v3` in commit `9679d665` before this import. Correcting that
expectation required no production code or data changes. The 22:58 PDT resume
reused the passing readback and passed exact-reference recognition for AIC, Met,
and Wikidata, plus missing-geometry and unsupported-model checks. Evidence is in
`calibrator-check-fix-resume.json`, `recognition-audit.json`, and
`credential-cleanup.json`.

## Scope and cost

The user requested batched file registration, direct-to-R2 feature uploads, and
the full production import. File reservation/completion uses batches of 100;
feature bytes travel from the Mac to R2. Matching existing archives are reused
on resume. Preparation refills continuously during ordered metadata commits,
holding at most four preparing/prepared batches plus the committing batch.
Preflight progress is also resumable; its
baseline must remain unchanged until writes begin. The production Pinecone index is `artlog-prod-512`, a separate
512-dimensional cosine index on Starter in AWS `us-east-1`.

The existing Convex team monthly shutdown threshold remains **$10**. The earlier
proposal to raise it to $25 and allow a $20 import was not accepted. No plan
upgrade or limit change is part of this run. The two optimizations avoid roughly
1.58 million file-registration mutations and 11 GB of upload relay traffic;
actual savings depend on shared free allowances and total database I/O. Monitor
usage and preserve the checkpoint if the existing threshold stops the job.

Development remains `usable-owl-256`. Model training, hub scoring, enrichment,
EAS builds, submissions, and physical iPhone release acceptance are separate.

## Inputs and evidence

All paths below are relative to `/Users/dwjiang/Documents/Artlog Data/`:

- Corpus: `jobs/scratch/merged-pca512/`
- Run: `jobs/out/production-full-2026-09-26/`
- Museum source: `jobs/out/06-01-2026-09-13-production/museums.jsonl`

The current model is `c-radiov3-b-int8-512-dinov2-pca512-v1`. The full input
fingerprint is
`b98c65f2d65aeae12544424baf37aab508572d575bfc303388ee821b9d3f0753`.
The original 1,536-dimensional fingerprint is historical; only PCA vectors and
feature manifests changed, with 129 other input hashes checked unchanged.

| Stage       | Full input rows |
| ----------- | --------------: |
| artworks    |         404,653 |
| objects     |         409,973 |
| placements  |         296,344 |
| vectors     |         402,139 |
| descriptors |         397,047 |
| penalties   |         409,973 |

There are 397,047 indexed surviving objects across AIC, Met, and Wikidata.
Production was empty after the pre-release backend reset; the September 13
10k sample is historical. The import initially restored the 3,924 required museum
rows from the verified saved directory; the user subsequently added the full
42,452-museum directory. Source SHA-256:
`544ba6a7e57c01bcbd8c2ed3885b1dc7cd47ea7679d7cec971c89a191e07ed33`.
No coordinates were invented, and no counters or unrelated tables are reset.

Key run artifacts:

- `run-status.json` and `upload.log`: current phase, process ID, progress/errors.
- `museum-preflight.json`: unique live keys and zero missing required museums.
- `push-prod-pilot-30.report.json`: pilot counts and 100% readback.
- `push-prod-speed-1000.report.json` and `upload-speed-benchmark.json`: larger
  pilot verification and sequential/pipelined real-file timings.
- `push-prod-full.json` / `.report.json`: resumable offsets, expected counts,
  deterministic 2% readback by source/stage, thumbnail audit, and Pinecone checks.
- `recognition-audit.json`, `usage-after.json`, `credential-cleanup.json`:
  final API checks, observed usage, and import-token cleanup, written only when reached.

`capacity-before.json` retains the original, more expensive import estimate and
unaccepted proposed envelope. `optimized-start.json` records the resumed scope.
The reports explicitly distinguish sampled full-corpus verification from the
pilot's complete readback and from independent camera accuracy.

## Running and resuming

The active workspace stores the operational runner at
`.context/run-production-corpus.py` and its non-secret credential-file locator at
`.context/production-full-2026-09-26/auth-location.json`. It runs under
`caffeinate -i`, with output redirected to the durable `upload.log`.
Do not launch a second writer while that process is alive. The Mac must remain
powered and connected; its job is not hosted in Convex.

On failure, inspect the error before resuming. Preserve the input fingerprint,
production URL, Pinecone index, and checkpoint. The normal Python importer can
resume `push-prod-full.json` using explicit production settings:

```python
from pathlib import Path
from dotenv import dotenv_values
from pipeline.config import Settings
from pipeline.convex_writer import ConvexWriter
from pipeline.push import Corpus, run

url = "https://admired-goldfinch-660.convex.cloud"
key = dotenv_values(credentials_path)["CONVEX_DEPLOY_KEY"]
settings = Settings(_env_file=None, convex_url=url, convex_deploy_key=key)
report = run(
    Corpus(Path(corpus_path)),
    ConvexWriter(settings),
    checkpoint=Path(run_path) / "push-prod-full.json",
    deployment_url=url,
    verify_fraction=0.02,
)
```

Run from `scripts/data/` with `uv run python`. Set `credentials_path` to the
private temporary production credential file, and `corpus_path` / `run_path`
to the absolute paths above. Never source or alter dev `.env.local` for this job.
The deployment key must be validated against the fixed production URL before
writes. A filename does not prove its target.

For account-authenticated production CLI commands, suppress local dev keys:

```sh
env CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT_TOKEN= CONVEX_DEPLOYMENT=prod:admired-goldfinch-660 npx convex deployment usage --deployment daniel-jiang:artlog:prod --json
```

An expired/revoked import token requires a new production-scoped token saved to
a private temporary file. Never print its value. Delete the named token and
remove that file after import and verification finish; retain all checkpoints.

## Verification and completion

The batching/direct-upload change passed TypeScript, lint, 56 Python tests,
and the 1,156-test backend suite (two opt-in tests skipped). The final R2 header
fix also passed focused tests and a real development upload/checksum/reuse probe.
The backend was successfully deployed to both intended targets.
The Python concurrency/resume and verification-retry changes passed 75 importer
tests, Ruff, TypeScript, and lint. Faster verification passed 39 focused backend
tests and was deployed to development and production before the continuous pilot.

The 30-object production pilot passed all counts and 100% feature readback,
including Pinecone, with zero thumbnail violations. The full run now uses
the existing importer's full counters, 2% sampled readback, thumbnail audit,
and Pinecone sync verification. It subsequently checks the authenticated public
recognition API using exact reference features from each source, missing geometry,
and an unsupported model. App Attest remains required; those API checks do not
prove camera accuracy or device attestation.

- [x] User resumed the import with cost optimizations and the existing $10 threshold.
- [x] Full PCA512 input hashes/counts and verified museum source recorded.
- [x] Production backend, private R2 configuration, and separate Pinecone index deployed.
- [x] Required museums restored; pilot counts and 100% readback pass.
- [x] Full import offsets reach every input count.
- [x] Full report has `countsMatch: true`, zero thumbnail violations, and passing sampled readback.
- [x] Search is ready and public recognition API checks pass with `lr-v3`.
- [x] Actual usage recorded; import credentials revoked and removed.
- [x] Deployment reference records verified final counts; production iPhone/TestFlight acceptance remains pending.

Stop on input/target drift, missing references, persistent write limits, failed
readback, exhausted capacity, failed search sync, or wrong recognition. Diagnose
and resume the same checkpoint for ordinary interruptions; do not reset data,
weaken assertions, raise spending limits, or retrain the calibrator to force a pass.

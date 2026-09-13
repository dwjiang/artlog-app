# Full corpus upload to production

> **Deferred by the user on 2026-09-13. Do not execute production operations
> until the user explicitly resumes this upload.** The present request authorized
> moving the local data and writing this plan only.
>
> Follow the steps and their verification gates in order. Do not mark this plan
> done when an upload is merely running. Record completion in this todo and
> `docs/plans/README.md`.
>
> **Drift check:** run `git diff --stat 1fe0c14..HEAD -- jobs/artlog_jobs
> jobs/scripts convex shared/model/model-version.json docs/runbooks/release.md` and
> `git diff --stat -- jobs/artlog_jobs convex shared/model/model-version.json`.
> This plan was written against an already dirty working tree. HEAD alone does
> not identify its importer: compare the fingerprints below and review changes
> before running anything. Preserve unrelated work and do not rename the branch.

## Status

- **Status:** DEFERRED by the user on 2026-09-13 to reduce costs during development
- **Priority:** P1 when production expansion resumes
- **Effort:** L operationally; budget hours, not an unattended completion claim
- **Risk:** MED: wrong deployment, incomplete references, storage cost, and changed recognition competition
- **Depends on:** user resumption; current production cost/capacity preflight
- **Category:** release operations
- **Planned at:** commit `1fe0c14`, dirty working tree, 2026-09-13
- **Target:** project `daniel-jiang/artlog`, production `admired-goldfinch-660`

Prepared with the improve skill as a focused production-upload handoff, not a
general codebase audit. This deferral supersedes the full-push step in
[plan 02.05](../../plans/02-index-build/05-dedupe-hubs-push.md). The broader
release roadmap remains in [the plan index](../../plans/README.md).

The data relocation is complete: all 7,290 files retained their original
inodes, sizes, and timestamps, and the full corpus passed a local dry-run from
Documents. Production was not contacted or changed during that work.

## Why this matters

Production currently has the verified 10,000-painting development sample. The
full locally built corpus has 397,047 canonical objects with recognition
features. Importing it later expands coverage without repeating downloads,
embedding extraction, or ORB extraction. The user deliberately postponed the
associated production usage and storage costs while developing.

## Current state

The workspace at planning time is
`/Users/dwjiang/conductor/workspaces/artlog-app/paris`. Run repository commands
from its root; commands explicitly labeled `jobs/` run from that subdirectory.
A future checkout can use the same absolute corpus path without a symlink.

| Local asset | Durable path under `/Users/dwjiang/Documents/Artlog Data/` |
| --- | --- |
| Complete merged corpus, feature shards, indexes, and hashes | `jobs/scratch/merged/` |
| Original metadata, raw feature shards, source snapshots, samples | `jobs/scratch/` |
| Dedupe provenance and audits | `jobs/out/02-05-2026-09-12-dedupe/` |
| v2 model, training rows, metrics, and development import audits | `jobs/out/02-09-2026-09-12-calibrator/` |
| Completed initial production import and its audits | `jobs/out/06-01-2026-09-13-production/` |
| Full local import plan after relocation | `full-corpus-dry-run-2026-09-13.json` |
| SHA-256 file inventory and relocation result | `relocation-manifest-2026-09-13.json`, `relocation-report-2026-09-13.json` |

`jobs/scratch` and `jobs/out` in this workspace link to these durable directories.
They are excluded through the repository's local Git exclude file because the
existing directory-only ignore patterns do not cover symlinks. Do not commit the
links or the data. New checkouts may pass the absolute `--in` and `--checkpoint`
paths directly; they do not need to recreate the links.

| Table/stage | Full corpus input | Last verified production count |
| --- | ---: | ---: |
| museums | 3,924 required keys; not an import stage | 42,452 |
| artworks | 404,653 | 11,721 |
| objects | 409,973 | 15,427 |
| placements | 296,344 | 14,256 |
| vectors | 402,139 | 13,616 |
| descriptors | 397,047 | 10,000 |
| penalties | 409,973 zero assignments; not a table | 15,427 zero assignments verified |

There are 7,019 merged aliases and 402,954 metadata survivors; 397,047 survivors
have recognition features. Keep the metadata-only objects too. Do not invent
features for failed or missing images. Each indexed survivor has one selected
ORB reference; alternate embedding views remain separate vector rows. Raw
feature shards preserve the other extracted views' ORB data locally as well.

The full local dry-run fingerprint is
`ba7aa0f8539903ac1d0933d327875ca3b3db68f9d9b2506cde802f11cee62565`.
It passed all 41 shards, recorded 397,047 indexed survivors, and requires 3,924
museum keys. All those keys occur in the **saved** production mapping; repeat
the check against live production before writing. The last production report
is evidence from the prior import, not a fresh server read for this plan.

Raw payload estimates from the dry-run are 4,941,484,032 bytes for float64
embeddings and 9,336,475,392 bytes for selected ORB payloads. The local float32
embeddings occupy 2,470,742,016 bytes. These are payload sizes, **not billed DB,
search-index, or file-storage measurements**, and exclude metadata and indexes.

Relevant implementation, verified during planning:

- `jobs/artlog_jobs/push.py:61`, `Corpus`: checks complete features, stored
  file hashes, model/shard shape, metadata counts, merge targets, identities,
  and thumbnail rights. `--full --dry-run` returns before creating a writer.
- `jobs/artlog_jobs/push.py:186`, `run`: computes overlap through
  `ingest:countExisting`, saves the baseline/expected counts, and checkpoints
  each stage. The input fingerprint and deployment URL must match on resume.
- `jobs/artlog_jobs/convex_writer.py:73`, `ConvexWriter`: uses
  `ConvexHttpClient.set_admin_auth`; descriptors use an action, not a mutation.
- `convex/ingest.ts:317`: vector identity is
  `(modelVersion, source, viewKey)`, preserving alternate views.
- `convex/ingest.ts:413`: ORB bytes are packed into Convex file storage,
  reused by SHA-256 when unchanged, and referenced by the `descriptors` table.
- `convex/ingest.ts:488`: paginated venue export supplies production IDs.
  `exportVectors` and `exportDescriptors` provide bounded feature readback.
- `jobs/artlog_jobs/seed_venues.py:118`: `export_asset` constructs the venue
  SQLite from the selected deployment; `publish_asset` publishes it.
- `docs/decisions/002-vector-search-scale.md`: only 30k synthetic vectors were
  measured on Starter. Full-scale storage/latency and Pro remain unverified.
- `docs/decisions/009-calibrator-v2.md`: `lr-v2` was fitted against the 10k
  index. Its object-penalty coefficient is zero; penalties do not affect its
  scores. Training results do not establish full-index or camera accuracy.

Current code excerpts for drift detection:

```python
# jobs/artlog_jobs/push.py:32
BATCH_SIZES = dict.fromkeys(STAGES, 500) | {"vectors": 250, "descriptors": 200}

# jobs/artlog_jobs/push.py:186 (inside run)
if state["fingerprint"] != corpus.fingerprint or state["deployment"] != deployment_url:
    raise ValueError(
        "Push checkpoint belongs to different inputs or deployment; use a new checkpoint"
    )
```

```typescript
// convex/ingest.ts:340, vector lookup
.withIndex('by_modelVersion_source_viewKey', (q) =>
  q.eq('modelVersion', row.modelVersion).eq('source', row.source).eq('viewKey', row.viewKey)
)
```

SHA-256 fingerprints of the dirty working files at planning time:

```text
a8e946d783564d383bba9118ec142a1f08b905d0660ca4be01b3e2ff662b14fb  jobs/artlog_jobs/push.py
7e367ed0fde745f3ef8292bc6b4d601b9fea6d116861503c513ea284628edb4c  jobs/artlog_jobs/features.py
1c4f4941b63a7c1ba7ee1142d62c0ea069385177c2af5cfef5ff6d8fdba0351c  jobs/artlog_jobs/convex_writer.py
dff9f6bf6ad300c94657d1236ed1bb5d4a5fb28dd18ccb556f0ab11eff76519a  convex/ingest.ts
066f586e7065d23a120590d606b07db4b1ee8f91bf641d3c03c094668b365856  convex/schema.ts
16e247eb57c13e09ef109fb59591649775130e1865256110312e2faedd651a0f  shared/model/model-version.json
```

## Scope and conventions

This is an import into the existing production deployment. Keep dev
`usable-owl-256` and the current phone's dev URL intact. No table replacement,
counter reset, schema migration, model retraining, hub scoring, enrichment,
paid plan upgrade, usage-limit change, EAS build, or submission is included.
Do not rerun the old empty-database setup helper or reuse its 10k checkpoint.

Future implementation may add `jobs/scripts/audit-production-corpus.py` and
`jobs/scripts/audit-production-corpus_test.py` for the bounded verification
described below. Operational outputs belong in the durable run directory.
Update `docs/runbooks/release.md`, `jobs/README.md`, and relevant status entries
in `docs/plans/README.md`, `docs/plans/02-index-build/05-dedupe-hubs-push.md`,
`docs/plans/06-release/01-testflight-and-app-size.md`, and this todo
after verification. Backend/app changes are not expected; investigate and
revise this plan if they become necessary.

The project uses Python 3.12+ with uv/pytest/Ruff, and TypeScript with Convex
1.45, Expo SDK 57, Vitest, and Jest. Match the fake-writer patterns in
`jobs/artlog_jobs/push_test.py` and script tests in
`jobs/scripts/letterbox-parity_test.py`. New script filenames use kebab case.
Read the current applicable guides and exact Expo v57 docs before code edits.
No installs are needed if the existing `jobs/.venv` is intact; a new checkout
uses `uv sync` from `jobs/` and the repository's locked Node dependencies.

Keep the existing branch name. No commits, pushes, or PRs are required by this
plan; if separately requested, use `origin/main` / PR base `main` and include
only the authorized changes.

## Step 1: Revalidate the durable corpus locally

From the repository root, choose a new run directory for a new import. On
resume, reuse the same directory, input fingerprint, and deployment.

```sh
export ARTLOG_DATA="$HOME/Documents/Artlog Data"
export ARTLOG_CORPUS="$ARTLOG_DATA/jobs/scratch/merged"
export ARTLOG_RUN="$ARTLOG_DATA/jobs/out/production-full-$(date +%Y-%m-%d)"
mkdir -p "$ARTLOG_RUN"
cd jobs
uv run python -m artlog_jobs.push --in "$ARTLOG_CORPUS" --full --dry-run > "$ARTLOG_RUN/dry-run.json"
```

**Verify** from `jobs/`:

```sh
uv run python - <<'PY'
import json, os
from pathlib import Path
p = json.loads((Path(os.environ['ARTLOG_RUN']) / 'dry-run.json').read_text())
assert p['limit'] is None and p['hubPenalty'] == 0
assert p['fingerprint'] == 'ba7aa0f8539903ac1d0933d327875ca3b3db68f9d9b2506cde802f11cee62565'
assert p['inputCounts'] == dict(artworks=404653, objects=409973, placements=296344, vectors=402139, descriptors=397047, penalties=409973)
assert len(p['selectedSurvivors']) == 397047 and len(p['requiredVenueKeys']) == 3924
print('Full local corpus verified')
PY
```

Expected: exit 0 and `Full local corpus verified`. Changed inputs require an
intentional new reviewed plan/fingerprint, not editing these assertions to pass.
Do not rerun dedupe, downloads, or feature extraction for an unchanged corpus.

## Step 2: Confirm the production target and current cost envelope

Announce production `admired-goldfinch-660` before any deployment operation.
The workspace `.env.local` contains a **dev** deploy key, which takes precedence
over ordinary deployment selection. Never source or change that file for this job.
Use the authenticated Convex account with the dev key explicitly suppressed.

From the repository root, read current usage and configured limits:

```sh
env CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT_TOKEN= CONVEX_DEPLOYMENT=prod:admired-goldfinch-660 npx convex deployment usage --deployment daniel-jiang:artlog:prod --json > "$ARTLOG_RUN/usage-before.json"
env CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT_TOKEN= CONVEX_DEPLOYMENT=prod:admired-goldfinch-660 npx convex deployment usage-limits list --deployment daniel-jiang:artlog:prod --json > "$ARTLOG_RUN/usage-limits.json"
```

**Verify:** both commands exit 0, target metadata resolves to the intended
project/deployment, and the JSON outputs are valid. If authentication fails,
restore account authentication; never fall back to the dev key.

Read the current subscription, remaining allowances, DB storage, search storage,
file storage, and deployment class from the Convex dashboard. Check current
official pricing and limits at execution time. Save `capacity-before.json` with
these observations, their timestamps/sources, projected upload and readback
usage, ongoing storage estimate, and the operator's accepted spend envelope.
Allowances are shared; raw feature bytes and CLI activity counters are not
instantaneous billed storage. Do not infer a hard Free-plan limit from the old
Starter spike, or treat its Pro assumptions as established capacity.

**Gate:** proceed only within the user's accepted cost envelope. Prepare concrete
costs before requesting any additional paid plan/limit change. Never purchase an
upgrade or raise limits silently. Stop if current capacity cannot support the
import, full readback, and continued serving within that envelope.

Create an import-only production key after this gate. Keep it in a private
temporary directory outside the durable data archive; do not print it or use
`--save-env` without an explicit path:

```sh
umask 077
export ARTLOG_AUTH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/artlog-prod.XXXXXX")"
export ARTLOG_PROD_ENV="$ARTLOG_AUTH_DIR/production.env"
env CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT_TOKEN= CONVEX_DEPLOYMENT=prod:admired-goldfinch-660 npx convex deployment token create "artlog-full-$(date +%Y%m%d-%H%M%S)" --deployment daniel-jiang:artlog:prod --save-env "$ARTLOG_PROD_ENV"
chmod 600 "$ARTLOG_PROD_ENV"
```

The CLI syntax above was checked with the installed version's `--help` during
planning. Recheck if the CLI has changed. Verify the key against the fixed prod
URL with an admin query in the next step; a filename is not proof of its target.

## Step 3: Build bounded verification and run the museum preflight

Implement the scoped audit script with `--mode preflight|readback|smoke`, `--in`,
`--run-dir`, and `--credentials` arguments. Use the fixed production URL, load
the key with `dotenv.dotenv_values`, and pass explicit `Settings` constructor
values with `_env_file=None`. Never log credentials, auth response tokens,
private key contents, or signed upload URLs. The first two modes must be
read-only against production. Smoke intentionally creates a test session/scans.

For `preflight`, use `ConvexWriter.query('ingest:exportVenues', ...)` to paginate
the live museum mapping; assert unique keys, advancing cursors, and zero missing
`Corpus.plan()['requiredVenueKeys']`. Save the mapping and `ingest:counts` as
`museum-preflight.json` and `baseline.json`. Last known production counts are in
the table above; report and reconcile any drift instead of assuming an empty DB.

All 3,924 required keys existed in the saved 42,452-museum mapping. No museum
upload is expected. If any are now missing, stop and identify exact keys and
verified source metadata before proposing a seed. Do not invent coordinates,
reimport all museums, or reset `ingestCounters`. If an approved repair changes
the directory, regenerate/publish the SQLite using `export_asset` and
`publish_asset`, and verify downloaded bytes and **production** IDs.

For `readback`, implement these bounded checks, with no all-corpus ORB list or
cache of every response page in memory:

1. Paginate raw `artworks`, `objects`, `placements`, `vectors`, and `descriptors`
   via an admin one-off **query** (`/api/run_test_function`) so natural identities
   and stored fields are visible. Use `numItems: 500`, `maximumBytesRead: 3000000`,
   and advancing cursors. Define a single static query accepting a table enum and
   cursor as args; import `query` from `convex:/_system/repl/wrappers.js`. The
   request envelope has `adminKey`, `args`, `bundle: {path, source}`, and
   `format: 'convex_encoded_json'`; send admin authorization only to the fixed
   production host. If this installed API is unavailable, revise the plan for
   an equivalent bounded administrative export, not a public bypass endpoint.
2. Compare every corpus metadata field. Resolve `artworkKey`, `ownerKey`,
   `mergedIntoKey`, and placement keys through the **production** ID maps.
   Require direct surviving merge targets and zero missing or duplicate keys.
3. Match vectors by `(modelVersion, source, viewKey)`, with the correct canonical
   object ID. Hash `np.asarray(vector, dtype='<f8').tobytes()` on both sides;
   compare every view, including aliases' alternate views. Handle unrelated
   pre-existing rows separately using baseline/overlap evidence; don't delete
   them or silently count them as corpus views.
4. For each canonical object's descriptor row, compare `keypointCount`,
   `inputSize`, and `extractedFrom` against its selected local `viewKey`.
   Page `ingest:exportDescriptors` to read stored bytes. Compare both byte arrays
   and SHA-256 of `descriptors + keypoints` against the stored `sha256`. Keep only
   a page of ORB bytes in memory; record missing, duplicated, or corrupt files.
5. Compare independently counted raw rows with `ingest:counts` and the import
   checkpoint's expected totals. Verify zero corpus `calibratorPenalty` values
   and zero violations from the paginated `ingest:auditThumbnails` query.
6. Write `readback-audit.json` only after all stages finish. Include deployment,
   input fingerprint, matched counts, actual/expected counters, mismatch counts,
   elapsed time, and `complete: true`. On failure persist progress with
   `complete: false` and a bounded diagnostic; do not label a partial pass complete.

Use existing `push_test.py` fake-writer fixtures for the new script's tests.
Cover a valid multiview/alias corpus, an omitted alternate view, a dangling
museum/object reference, a corrupt vector/ORB byte, count drift, repeated cursors,
and preservation of unrelated baseline rows. Assert preflight/readback make no
mutations and a wrong target is rejected before any request. This is meaningful
auditor coverage; the existing importer does not need to be rewritten.

**Verify** from `jobs/`:

```sh
uv run pytest -q scripts/audit-production-corpus_test.py artlog_jobs/push_test.py artlog_jobs/convex_writer_test.py
uv run ruff check scripts/audit-production-corpus.py scripts/audit-production-corpus_test.py
uv run python scripts/audit-production-corpus.py --mode preflight --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
```

Expected: tests/checks exit 0; preflight targets production and reports
`missingMuseumKeys: []`. A failed preflight blocks the upload.

## Step 4: Import once with a production-specific checkpoint

Do not parallelize stage order or raise batch sizes speculatively. The importer
upserts artworks → canonical objects then aliases → placements → all vector
views → selected ORB references/files → neutral penalties. It accounts for the
existing 10k sample before writing, so final expected counts come from
`baseline + input - existing`, not blind addition or a counter reset.

From `jobs/`, run under `caffeinate`. Redirect logs to the durable run directory
and monitor progress regularly; lower noisy HTTP client log levels so signed
URLs cannot appear. This command intentionally writes production:

```sh
caffeinate -i uv run python - > "$ARTLOG_RUN/import.log" 2>&1 <<'PY'
import json, logging, os
from pathlib import Path
from dotenv import dotenv_values
from artlog_jobs.config import Settings, setup_logging
from artlog_jobs.convex_writer import ConvexWriter
from artlog_jobs.push import Corpus, run

prod = 'https://admired-goldfinch-660.convex.cloud'
out = Path(os.environ['ARTLOG_RUN'])
values = dotenv_values(os.environ['ARTLOG_PROD_ENV'])
settings = Settings(_env_file=None, convex_url=prod,
                    convex_deploy_key=values['CONVEX_DEPLOY_KEY'])
setup_logging(settings)
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
corpus = Corpus(Path(os.environ['ARTLOG_CORPUS']), limit=None)
plan = json.loads((out / 'dry-run.json').read_text())
assert corpus.fingerprint == plan['fingerprint']
preflight = json.loads((out / 'museum-preflight.json').read_text())
assert preflight['deployment'] == prod and preflight['missingMuseumKeys'] == []
print(f'Import target: {prod}', flush=True)
report = run(corpus, ConvexWriter(settings), checkpoint=out / 'push-prod-full.json', deployment_url=prod)
assert report['countsMatch'] and report['thumbnailAudit']['violations'] == 0
print(json.dumps(report, indent=2), flush=True)
PY
```

On a dropped connection or process interruption, keep the checkpoint and resume
this same command after checking the error. A lost response can be replayed:
upserts use natural keys and ORB storage uses content hashes. Do not delete the
checkpoint, start a second importer, or claim the partial index is complete.
`BatchSizeReduced` persists a smaller batch and deliberately stops for review.
If paused between vector and ORB stages, recognition may be soft/incomplete for
new objects; record the active stage and finish before production acceptance.

**Verify** from `jobs/`:

```sh
uv run python - <<'PY'
import json, os
from pathlib import Path
out = Path(os.environ['ARTLOG_RUN'])
p = json.loads((out / 'dry-run.json').read_text())
c = json.loads((out / 'push-prod-full.json').read_text())
r = json.loads((out / 'push-prod-full.report.json').read_text())
assert c['deployment'] == r['deployment'] == 'https://admired-goldfinch-660.convex.cloud'
assert c['fingerprint'] == p['fingerprint']
assert all(c['stages'][stage]['offset'] == count for stage, count in p['inputCounts'].items())
assert r['countsMatch'] and r['actual'] == r['expected']
assert r['thumbnailAudit']['violations'] == 0
print('All import stages complete; counts and thumbnail audit pass')
PY
```

## Step 5: Verify the database, search index, and recognition

Run the complete bounded readback once; include its traffic in the cost estimate.
Do not repeat an entire multi-GB readback without a changed input, failure, or
specific unresolved concern.

```sh
# From jobs/:
uv run python scripts/audit-production-corpus.py --mode readback --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
```

Expected: exit 0, `complete: true`, 402,139 embedding views and 397,047 ORB files
byte-matched, 409,973 corpus objects checked for zero penalties, every metadata
reference correct, and independently counted rows equal the importer totals.

Confirm the live vector index is ready in the dashboard and save its state in
`index-status.json`; committed rows alone do not prove search is ready. Record
current DB, search, and file storage plus usage in `capacity-after.json`. Respect
the cost envelope throughout the import; do not wait until the end to notice a
limit. Missing/delayed metrics are unknown, not zero.

Implement/run the script's `smoke` mode with a fresh anonymous session using
`auth:signIn`, `devices:registerDevice` (`platform: 'ios'`), and the public
`identify:identify` action. Resolve expected object IDs by corpus keys on prod.
Send the selected view's vector, descriptors, keypoints, model version,
`capturedAt`, and a new `localId` per query. Verify persisted outcomes through
`scans:get`, then call `auth:signOut`; never archive session tokens.

Use Roses (`met:436534`), Wheat Field with Cypresses (`met:436535`), and The
Bedroom (`aic:28560`), resolving aliases first. All three exact references should
be correct/confident with `lr-v2`. Add at least one deterministic feature-bearing
object present in the full corpus but absent from the old 10k package. A Roses
query without ORB should be soft; an unsupported model should return
`unsupported_version`. Check production still requires App Attest and rejects
development attestations; do not weaken settings to make validation pass.

```sh
uv run python scripts/audit-production-corpus.py --mode smoke --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
```

Expected: `recognition-audit.json` has the intended production URL, passing
positive/negative cases, recorded timings, and `method: 'exact-reference-api'`.
This verifies import/search wiring, not independent camera accuracy.

Full-index candidate competition can change v2 probabilities. Keep the trained
weights unchanged for this import; if recognition gates regress, report the
examples and propose full-index evaluation/recalibration separately. Do not
reuse the old 10k precision figures as evidence for the full corpus. Likewise,
paintings previously outside the sample may now be indexed: check corpus
membership before choosing new outside-index camera tests.

## Step 6: Record completion and release work still pending

Update the scoped runbooks/status files with the actual counts, fingerprint,
timings, measured usage/storage, and paths to completed audits. Mark the full
production import complete only after steps 1–5 pass. Keep production iPhone
camera/App Attest/Apple sign-in/save/contribution testing and TestFlight visibly
pending until independently performed under the release plan. Do not trigger
an EAS build or submission as part of this DB import.

Remove the temporary credentials file after the job and readback have exited,
and revoke the import-only token created in step 2 using the current CLI or
dashboard. Record its name and revocation outcome without its value. Preserve
the source corpus and durable checkpoint even after success.

**Verify** from the repository root for the new audit code and docs:

```sh
npx tsc --noEmit
npm run lint
git diff --check
```

The Python test/Ruff commands in step 3 must pass. If backend code changes become
necessary after revising this plan, run relevant Vitest tests (`npm run
test:convex -- convex/ingest.test.ts convex/lib/orbStorage.test.ts`) and Convex
codegen after any schema/signature change. Existing app behavior is unchanged by
this operational plan; any later app changes require an iOS light-mode build
with `npm run ios`. No extra app build is needed for documentation alone.

## Done criteria

- [ ] User resumed the upload and the current spend envelope is recorded.
- [ ] Local full-corpus fingerprint and counts match step 1.
- [ ] Live production preflight has zero missing museum keys.
- [ ] Every stage offset equals its full input count; the report has `countsMatch: true` and zero thumbnail violations.
- [ ] Complete readback matches all corpus metadata, references, 402,139 vector views, and 397,047 ORB byte payloads.
- [ ] Search index is ready; known and newly added objects pass the public API smoke checks with `lr-v2`.
- [ ] Actual DB/search/file storage and usage are recorded within the accepted envelope.
- [ ] Focused verification-script tests, Ruff, TypeScript, lint, and diff checks pass.
- [ ] Import-only credentials are removed/revoked; checkpoint and evidence remain in Documents.
- [ ] Status/runbook distinguish completed DB import from pending production camera/TestFlight acceptance.

## STOP conditions and maintenance

Stop and report the concrete discrepancy if inputs or deployment drift without
explanation, required museums are missing, model dimensions/version disagree,
authentication only works on dev, capacity exceeds the accepted envelope, an
unreviewed write-size rejection persists, references/features fail readback,
search remains unavailable, or smoke recognition returns the wrong painting.
Do not reset data or relax assertions to force completion. For ordinary
transient interruptions, preserve and resume the same checkpoint.

The corpus identity, ingestion contract, and model version jointly determine
whether a checkpoint can be reused. Audit changes to natural keys, descriptor
storage layout, merge rules, or export pagination before future imports. The
10k setup reports remain historical evidence and must not be overwritten by
the full run. Hub scoring, calibrator retraining, and physical-camera release
acceptance remain separate work unless the user expands the scope.

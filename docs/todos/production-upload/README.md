# Full corpus upload to production

> **Deferred by the user on 2026-09-13. Do not execute production operations
> until the user explicitly resumes this upload.** The data relocation is complete.
>
> Follow the steps and their verification gates in order. Do not mark this plan
> done when an upload is merely running. Record completion in this todo.
>
> **Drift check:** run `git diff -M --stat 1fe0c14..HEAD -- jobs/artlog_jobs jobs/scripts scripts/data/pipeline
> scripts/data/letterbox-parity.py convex shared/model/model-version.json docs/operations/production.md docs/todos/release/README.md`
> (1fe0c14 predates the move of `jobs/` to `scripts/data/`; `-M` with both paths pairs the renames) and
> `git diff --stat -- scripts/data/pipeline convex shared/model/model-version.json`.
> This plan was written against an already dirty working tree. HEAD alone does
> not identify its importer: compare the
> [recorded fingerprints](../../operations/corpus.md#file-fingerprints) and review
> changes before running anything. Preserve unrelated work and do not rename the branch.

## Status

- **Status:** DEFERRED by the user on 2026-09-13 to reduce costs during development
- **Priority:** P1 when production expansion resumes
- **Effort:** L operationally; budget hours, not an unattended completion claim
- **Risk:** MED: wrong deployment, incomplete references, storage cost, and changed recognition competition
- **Depends on:** user resumption; current production cost/capacity preflight
- **Category:** release operations
- **Planned at:** commit `1fe0c14`, dirty working tree, 2026-09-13
- **Target:** project `daniel-jiang/artlog`, production `admired-goldfinch-660`

The [release todo](../release/README.md) owns TestFlight distribution. This
upload remains separately deferred to reduce costs during development.

## Why this matters

Production currently has the verified 10,000-painting development sample. The
full locally built corpus has 397,047 canonical objects with recognition
features. Importing it later expands coverage without repeating downloads,
embedding extraction, or ORB extraction. The user deliberately postponed the
associated production usage and storage costs while developing.

## Reference and working directory

The dated [corpus inventory and import baseline](../../operations/corpus.md)
records the completed relocation, artifact locations, counts, payload
estimates, implementation observations, and file fingerprints.

Run repository commands from the active checkout's root; commands explicitly
labeled `scripts/data/` run from that subdirectory. Use the absolute corpus path in Step 1
so execution does not depend on a particular workspace or symlink.

## Scope and conventions

This is an import into the existing production deployment. Keep dev
`usable-owl-256` and the current phone's dev URL intact. No table replacement,
counter reset, schema migration, model retraining, hub scoring, enrichment,
paid plan upgrade, usage-limit change, EAS build, or submission is included.
Do not rerun the old empty-database setup helper or reuse its 10k checkpoint.

Future implementation may add `scripts/data/audit-production-corpus.py` and
`scripts/data/audit-production-corpus_test.py` for the bounded verification
described below. Operational outputs belong in the durable run directory.
Update [the deployment state](../../operations/production.md), [the jobs guide](../../../scripts/data/README.md),
and this todo after verification. Backend/app changes are not expected; investigate and
revise this plan if they become necessary.

The project uses Python 3.12+ with uv/pytest/Ruff, and TypeScript with Convex
1.45, Expo SDK 57, Vitest, and Jest. Match the fake-writer patterns in
`scripts/data/pipeline/push_test.py` and script tests in
`scripts/data/letterbox-parity_test.py`. New script filenames use kebab case.
Read the current applicable guides and exact Expo v57 docs before code edits.
No installs are needed if the existing `scripts/data/.venv` is intact; a new checkout
uses `uv sync` from `scripts/data/` and the repository's locked Node dependencies.

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
cd scripts/data
uv run python -m pipeline.push --in "$ARTLOG_CORPUS" --full --dry-run > "$ARTLOG_RUN/dry-run.json"
```

**Verify** from `scripts/data/`:

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
the [corpus inventory](../../operations/corpus.md#corpus-and-production-counts); report and reconcile any drift
instead of assuming an empty DB.

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

**Verify** from `scripts/data/`:

```sh
uv run pytest -q audit-production-corpus_test.py pipeline/push_test.py pipeline/convex_writer_test.py
uv run ruff check audit-production-corpus.py audit-production-corpus_test.py
uv run python audit-production-corpus.py --mode preflight --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
```

Expected: tests/checks exit 0; preflight targets production and reports
`missingMuseumKeys: []`. A failed preflight blocks the upload.

## Step 4: Import once with a production-specific checkpoint

Do not parallelize stage order or raise batch sizes speculatively. The importer
upserts artworks → canonical objects then aliases → placements → all vector
views → selected ORB references/files → neutral penalties. It accounts for the
existing 10k sample before writing, so final expected counts come from
`baseline + input - existing`, not blind addition or a counter reset.

From `scripts/data/`, run under `caffeinate`. Redirect logs to the durable run directory
and monitor progress regularly; lower noisy HTTP client log levels so signed
URLs cannot appear. This command intentionally writes production:

```sh
caffeinate -i uv run python - > "$ARTLOG_RUN/import.log" 2>&1 <<'PY'
import json, logging, os
from pathlib import Path
from dotenv import dotenv_values
from pipeline.config import Settings, setup_logging
from pipeline.convex_writer import ConvexWriter
from pipeline.push import Corpus, run

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

**Verify** from `scripts/data/`:

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
# From scripts/data/:
uv run python audit-production-corpus.py --mode readback --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
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
uv run python audit-production-corpus.py --mode smoke --in "$ARTLOG_CORPUS" --run-dir "$ARTLOG_RUN" --credentials "$ARTLOG_PROD_ENV"
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
pending until independently performed under the [release todo](../release/README.md). Do not trigger
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

# Plan 001: Move vector search to Upstash

> **Deferred — do not execute until the user resumes this work.** Fixes 1, 2, 3,
> and 5 from the cost review are implemented separately in this workspace.
> This plan replaces the resulting Convex search indexes; it does not repeat
> those fixes or authorize provisioning, spending, or a production deployment.
>
> **Executor:** read this plan and the applicable project guides before making
> changes. Complete each verification gate. Update `plans/README.md` when done.
>
> **Drift check:** run `git diff --stat 9211ad92..HEAD -- convex scripts/data/pipeline shared/model plans`.
> This plan includes the uncommitted cost fixes written on top of that commit.
> Compare the excerpts below with the current files, including `git diff`, before
> execution. Refresh the plan if those contracts changed.

## Status

- Priority: P2; deferred by the user
- Effort: L; estimate 3–4 working days including accuracy and deletion testing
- Risk: HIGH; changes recognition dependencies and data deletion across services
- Category: migration / performance
- Depends on: the Convex cost fixes in this workspace
- Planned at: commit `9211ad92` plus working-tree cost fixes, 2026-09-24
- Confidence: HIGH in the integration points; service capacity and measured savings need revalidation

## Why this matters

The full local corpus is approximately 402K vector views. Moving search can
reduce the part of recognition cost that scales with corpus size. Convex stays
the source of truth for artwork eligibility, provenance, metadata, and retained
embeddings. Upstash becomes a rebuildable search index. Do not copy the old
conversation's monthly price estimates into release claims: measure current
traffic and recheck provider pricing first.

## Current state

The project is TypeScript/Convex 1.45.0 and Expo SDK 57, with Python 3.12+ data
jobs run through uv. iOS and light mode are the only product targets. Tests use
Vitest/convex-test, Jest, and pytest. There are no compatibility commitments to
pre-release data or callers; update all callers directly and remove superseded
paths. Keep Token Factory/Nemotron and Tavily runtime integrations eligible for
the hackathon (`docs/hackathon/README.md`). Do not change model dimensions or the
calibrator to compensate for a provider mismatch.

Read these implementation points:

| File                                                | Responsibility after the cost fixes                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/schema.ts`                                  | `vectors` is small identity/provenance metadata with an `embeddingId` and `contentHash`; `embeddings` and `tentativeEmbeddings` hold searchable payloads.                       |
| `convex/lib/vectorStore.ts`                         | Atomic `insertVector`, `replaceVector`, `deleteVector`, `readVector`; all search writes/deletes go through these helpers. Hashes are SHA-256 over little-endian float64 values. |
| `convex/identify.ts`                                | Search established and venue indexes separately, then resolve IDs through `vectors.by_embeddingId`; eligibility remains checked on Convex.                                      |
| `convex/contributions.ts`                           | Searches established vectors for duplicates, then performs transactional/paginated checks before publishing a venue contribution.                                               |
| `convex/lib/tentativeEntries.ts`                    | Contribution grouping and durable-vector publication.                                                                                                                           |
| `convex/promotion.ts`, `convex/placements.ts`       | Multi-view and reviewed-placement vector publication.                                                                                                                           |
| `convex/contributionRemoval.ts`, `convex/revert.ts` | Withdrawal, bans, account removal, rights takedowns, duplicate dependencies, and search-vector deletion.                                                                        |
| `convex/lib/recognitionEligibility.ts`              | Current eligibility for contributions, objects, and vector provenance; must stay authoritative.                                                                                 |
| `convex/museumDownloads.ts`, `convex/ingest.ts`     | Offline museum packages, training exports, import upserts, and sampled readback depend on retained vectors.                                                                     |
| `convex/scanEmbeddings.ts`                          | Scan, feedback, and contribution payloads kept outside the search indexes; never searched.                                                                                      |
| `scripts/data/pipeline/push.py`                     | Deployment/input-scoped checkpoints and deterministic 2% readback per source/stage; `--verify-fraction 1` explicitly verifies all imported rows.                                |

Current code anchors (search by symbol rather than trusting line numbers):

```ts
// convex/lib/recognitionEligibility.ts
export function recognitionPartition(modelVersion: string, venueId?: Id<"museums">): string {
  return JSON.stringify([modelVersion, venueId ?? "established"]);
}

// convex/identify.ts, runScan
ctx.vectorSearch(venueId ? "tentativeEmbeddings" : "embeddings", "by_vector", {
  vector,
  limit: MAX_CANDIDATES,
  filter: (q) => q.eq("partition", recognitionPartition(scan.modelVersion, venueId)),
});

// convex/lib/vectorStore.ts, insertVector
return ctx.db.insert("vectors", { ...identity, embeddingId, contentHash: await vectorHash(vector) });
```

Match the object-form function registrations with explicit args/returns in
`convex/ingest.ts`. External calls belong in actions; mutations queue work
atomically. Unexpected action failures use `withErrorReporting` from
`convex/lib/observability.ts`, which omits credentials and user content.
Use `convex/lib/vectorStore.test.ts`, `convex/revert.test.ts`, and
`scripts/data/pipeline/push_test.py` as test patterns.

## Scope

Modify only the following, plus their co-located tests and generated API output:

- `convex/schema.ts`, `convex/lib/vectorStore.ts`, new `convex/lib/upstashVector.ts`,
  new `convex/vectorSync.ts`, and new `convex/crons.ts`.
- `convex/identify.ts`, `convex/contributions.ts`, `convex/lib/tentativeEntries.ts`,
  `convex/promotion.ts`, `convex/placements.ts`, `convex/contributionRemoval.ts`,
  `convex/revert.ts`, `convex/lib/recognitionEligibility.ts`,
  `convex/museumDownloads.ts`, `convex/ingest.ts`, `convex/lib/testFactories.ts`,
  and `convex/lib/observability.ts` if a safe diagnostic code is needed.
- `scripts/data/pipeline/push.py`, `scripts/data/pipeline/convex_writer.py`,
  a new `scripts/data/vector-recall.py` and `vector-recall_test.py`,
  and `scripts/data/README.md`.
- Dependency manifests/locks if a verified SDK reduces complexity, `.env.example`,
  root `README.md` setup claims, `docs/operations/production.md`,
  `docs/operations/corpus.md`, `docs/todos/terms-and-privacy/README.md`, and this plan/index.
  Keep new source names kebab-case outside Convex; leave existing filenames intact.

Out of scope: PCA or a new embedding model; changes to match thresholds or the
calibrator; removing provenance or rights checks; moving the rest of the database;
UI redesign; automatic production imports; EAS/store commands. Do not introduce
permanent dual-provider fallback or legacy schema branches.

## Steps

### 1. Record the baseline and configure an isolated test index

Recheck Upstash's dimension, namespace, capacity, batch, request-rate, region,
consistency, backup, and pricing limits. Select a cosine index in a region near
the actual Convex deployment. Keep dev and production indexes separate.
Read the installed SDK types before coding. Use `npx expo install @upstash/vector`
if adding that dependency, per the project package rule.

The current [cosine score formula](https://upstash.com/docs/vector/features/similarityfunctions)
is `(1 + cosine) / 2`; normalize with `2 * score - 1` exactly once at the adapter
boundary. [Namespaces](https://upstash.com/docs/vector/features/namespaces) isolate
queries and writes. Derive a deterministic, reversible namespace from each
`recognitionPartition`; confirm naming/length limits rather than using an
unverified raw JSON name. Use `String(vectorIdentityId)` as the external ID.
Metadata may include `objectId`, model version, and partition; never include
photos, labels, credentials, or personal identifiers unnecessary for search.

Create fake-client tests for score conversion (-1/0/1), invalid/NaN/out-of-range
scores, namespace isolation, topK=32, timeout, rate limiting, and malformed results.
Capture Convex's top-32 candidates and final recognition decisions on a fixed,
rights-cleared local sample before removing its indexes. The inventory's 10K
production sample is historical evidence, not permission to query production.
Use local corpus shards and a fresh test deployment to recreate that sample.

**Verify:** `npm run test:convex -- convex/lib/upstashVector.test.ts` passes;
`uv run --project scripts/data pytest -q scripts/data/vector-recall_test.py`
passes without contacting services. Record the baseline artifact under `.context/`.

### 2. Retain rebuildable payloads and queue synchronization atomically

Replace the two Convex search payload tables with one unindexed retained-payload
table referenced directly by the small `vectors` rows. A float16 `v.bytes()` copy
is the proposed storage format; use a tested existing encoder if available.
Validate finite values, length, endianness, norm, and round-trip error. Retain
float32 instead if float16 fails the recognition gate; report the measured tradeoff.

Add an indexed durable sync job/outbox keyed by vector identity. The vector-store
helpers must commit the latest desired revision and job with each upsert/delete.
A deletion job retains the external ID and namespace even after deleting its
Convex identity/payload. Handle a moved namespace by deleting the old copy.
Actions perform external requests and acknowledge only the revision they sent.
Serialize work for a vector; recheck desired state after requests so delayed
upserts cannot permanently resurrect deletes. Retry transient errors with bounded
backoff, report exhausted failures through Sentry, and retain failed jobs for retry.
Periodic reconciliation repairs missing/stale vectors and tombstones in bounded
pages. No network request inside a mutation.

Update `readVector` so museum packages, training exports, duplicate/group checks,
promotion, and sampled import readback keep working from Convex's retained copy.
Retain `contentHash` semantics or update every producer/comparison together.

**Verify:** `npx convex codegen`, `npx tsc --noEmit`, and
`npm run test:convex -- convex/lib/vectorStore.test.ts convex/vectorSync.test.ts convex/museumDownloads.test.ts convex/ingest.test.ts`
all pass. Tests cover lost responses, duplicate jobs, revision races, failed deletes,
namespace moves, crash/retry, and rebuilding an index solely from retained payloads.
Classify the codegen/development target before running deployment-affecting commands.

### 3. Switch both query paths and preserve synchronous eligibility

Replace the two searches in `identify.runScan` and the established duplicate search
in `contributions.contribute`. Share the score-normalizing adapter. Resolve returned
identity IDs in Convex and check current eligibility there; remote metadata is a
hint, never an authorization decision. Missing identities, stale revisions, banned
devices, withdrawn contributions, merged/reverted works, opt-outs, and takedowns
must remain invisible even while Upstash is stale. Preserve one-hop merge semantics,
max-score object deduplication, model isolation, and venue-only tentative matches.

Use an explicit bounded timeout and report unexpected failures through the existing
Sentry helper. Preserve failed-scan/retry behavior: an outage must not become a
successful empty search. Keep the existing per-device contribution serialization
and transactional checks across the paginated duplicate search.

**Verify:**
`npm run test:convex -- convex/identify.test.ts convex/contributions.test.ts convex/promotion.test.ts convex/placements.test.ts convex/revert.test.ts convex/accounts.test.ts`
passes with fake Upstash responses, including results that are deliberately stale.
`rg 'ctx.vectorSearch|\.vectorIndex\(' convex -g '*.ts' -g '!*.test.ts'`
returns no active Convex vector-search implementation when cutover is complete.

### 4. Checkpoint import sync and prove recognition/deletion behavior

Keep Convex as the ingestion authority. `push.py` must not bypass the outbox with
independent direct Upstash writes. Add bounded sync progress/status queries and
record acknowledged revisions separately from Convex row acknowledgements.
A completed import requires zero pending/failed jobs for that run; lost responses
resume safely and unchanged vectors produce no remote upserts. Checkpoints must
bind corpus fingerprint, model version, Convex deployment, and the Upstash index
identity (never the token). Retain sampled readback and exact vector-view identities.

Implement the recall command with explicit endpoint selection and local fixtures.
It must emit machine-readable counts for baseline/new target recall@32, confident
false positives, final match decisions, score drift, and p50/p95 latency. Test known
positives, distractors, aliases, venue-only tentative entries, and two model versions.
Gate cutover on no additional known-target misses and no new false-confident results
on the fixed sample. If approximation or precision fails that gate, stop and report;
do not silently loosen thresholds. Run a live test on the isolated index: upsert,
query, withdraw/ban/takedown/account removal, simulate one failed delete, confirm
immediate Convex suppression, recover the job, then confirm remote deletion.

**Verify:** `uv run --project scripts/data pytest -q scripts/data/pipeline/push_test.py scripts/data/pipeline/convex_writer_test.py scripts/data/vector-recall_test.py`
passes. `uv run --project scripts/data python scripts/data/vector-recall.py --help`
exits 0 and documents the exact live invocation. Run that invocation only against
the explicitly identified test index; save a passing JSON report. Current billing
and latency measurements, not old estimates, determine whether to proceed.

### 5. Update operations/privacy and finish the cutover

Document required server-only Upstash URL/token placeholders and index configuration.
If adding a local env variable, mirror it to the primary checkout as required by
`AGENTS.md`; never copy secrets into docs. Update privacy/data deletion disclosures
before sending real user-derived embeddings to another service. Read the hackathon
guide before changing README setup/model claims. Describe replay/reconciliation,
alerts, index rebuild, bounded cost checks, and how to stop/resume a failed import.
Remove obsolete Convex vector indexes/tables and old query code in the final change.
Deploy on a fresh non-production database; do not add compatibility migrations for
pre-release rows. A production rollout remains a separate explicitly authorized action.

**Verify:** `npx tsc --noEmit`, `npm run lint`, `npm run test:convex`, the Python
checks above, and `npm run ios`. On iOS light mode verify established recognition,
venue tentative recognition, feedback/contribution, and offline retry after a
simulated provider outage. Record any unavailable live checks explicitly.

## Done criteria

- [ ] Typecheck, lint, backend tests, and relevant Python tests exit 0.
- [ ] Score and namespace contract tests pass; both query paths use the adapter.
- [ ] All vector writes/deletes enqueue transactional, revision-safe sync work.
- [ ] Stale remote matches are excluded immediately by Convex eligibility tests.
- [ ] Live deletion/retry/reconciliation checks pass on the isolated index.
- [ ] Fixed-sample recall report has no additional target misses or false-confident matches.
- [ ] Museum packages, calibrator export, duplicate checks, promotion, and index rebuild work from retained vectors.
- [ ] No unchanged remote upserts on resumed or repeated imports; sampled readback remains bounded.
- [ ] Old Convex search indexes are removed; no permanent dual-provider path exists.
- [ ] Operations/privacy docs match the implementation; plan/index status reflects remaining live verification.

## STOP conditions and maintenance

Stop if the code no longer matches the current-state contracts, a required provider
limit/region/consistency guarantee cannot be verified, precision/recall fails its
gate, or a change would require relaxing eligibility/privacy boundaries. Report
out-of-scope requirements before implementing them. Failed deletion is a retained
and visible job, never a reason to report success. Keep account/rights cleanup tests
coupled to any future vector writer. Future model changes must get a distinct
namespace and regenerate both retained and indexed payloads deliberately.

Work in the assigned branch; do not rename it, commit, push, or open a PR without
instruction. Existing commit style includes `refactor(convex): ...` and `feat(...): ...`.

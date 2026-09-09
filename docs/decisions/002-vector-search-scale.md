# 002 — Convex vector search scale spike

Date: 2026-09-08. Plan: [00.02](../plans/00-kickoff-spikes/02-convex-vector-search-at-scale.md).

## Decision and measured scope

**Keep Convex provisionally; the 1M-vector architecture gate remains open.**
The available team is on Convex Starter (S16), not Pro (S256). This run follows
the plan's 30k fallback. There is no evidence here to trigger Qdrant, and these
measurements cannot establish latency or storage at 300k/1M on Pro. Re-run the
checked-in harness on Pro before treating the scale assumption as validated.

The project `artlog-spike-vectors` and dev deployment `quick-schnauzer-888` were
created solely for this spike in US East (N. Virginia). Neither the app backend
nor the team's subscription was changed. Reproduction instructions and raw
results live in [the isolated spike](../../spikes/convex-vector-scale/README.md).

The corpus has 1536-dimensional float64 unit vectors, a deterministic seed of
`20260908`, and 1% noisy alternate views sharing an object ID. v2 repeats the same
vectors under a second version to isolate version-filter behavior. This is a
synthetic performance/crowding test, not a real-artwork recall evaluation.

## 1. Search latency

The final tables are computed from the checked-in JSONL samples and can be
regenerated with `summarize.py`. `searchMs` times only `ctx.vectorSearch` inside the action.
Client HTTP round trips and subsequent metadata hydration are measured
separately. Each full phase has 200 calls/configuration after 5 warmups,
interleaving equality/OR filters and limits 32/256. Half the queries are random;
half target known multi-view objects. Percentiles use linear interpolation.

| Corpus size | Status |
| --- | --- |
| 30,000 | Measured on Starter/S16; 200 calls/configuration |
| 100,000 | Unmeasured: Pro run unavailable; exceeds Free raw-float storage allowance |
| 300,000 | Unmeasured: team is on Starter; plan limits this run to the fallback |
| 1,000,000 | Unmeasured: same reason; p95≈300 ms fallback threshold cannot be evaluated |

Final single-version table: 30k active v1 rows following the smaller migration.
The OR filter includes v2, which has been deleted; the populated two-version
case is reported in section 4.

| 30k active v1 | p50 ms | p95 ms | p99 ms | Client p95 ms |
| --- | ---: | ---: | ---: | ---: |
| v1, limit 32 | 5.60 | 10.01 | 10.30 | 269.91 |
| v1 OR v2, limit 32 | 5.60 | 10.00 | 10.61 | 240.61 |
| v1, limit 256 | 8.80 | 13.21 | 14.01 | 539.47 |
| v1 OR v2, limit 256 | 9.00 | 13.21 | 14.00 | 467.77 |

All 800 measured calls returned the requested result count, with no filter
violations or missing hydrated documents. All 100 seeded target-object queries
per configuration found their target. A separate system query confirmed 30,000
documents and both indexes in `done` state (`final-state.json`). These numbers
are warmed samples from one run, not a cold-start or sustained-concurrency SLO.

## 2. Inserts

Both requested batch sizes exceeded the HTTP request-body limit:
`400 BadJsonBody: Failed to buffer the request body: length limit exceeded`.
The runner halved batches and continued at 250 rows. The first rejected attempt
is preserved in the log, including the retry after teaching the runner this
specific server error message.

The exact Python/HTTP envelopes for this seed are 8.17 MiB at 250 rows,
9.81 MiB at 300, 16.34 MiB at 500, and 32.68 MiB at 1,000. Only 250, 500,
and 1,000 were sent in the recorded run; the 300-row size is calculated.
See `payload-sizes.json`. JSON expansion, not raw float bytes alone, governs
the observed request rejection.

| Phase | Requested rows/batch | Accepted rows/batch | Rows inserted | Wall time | Rows/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial v1 | 1,000 | 250 | 5,000 | 47.56 s | 105.14 |
| Append v1 | 500 | 250 | 10,000 | 79.85 s | 125.23 |
| Insert v2 during searches | 250 | 250 | 15,000 | 112.75 s | 133.04 |
| Final append v1 | 250 | 250 | 15,000 | 112.99 s | 132.76 |

These wall times include generation, Python conversion/JSON encoding, HTTP
transport, server work, and rejected size probes within the successful process.
The aborted initial attempt is separate. Total time to 1M is **unmeasured**;
extrapolating these laptop/HTTP rates is not a measured Pro throughput result.
The three v1 seeding phases total **240.40 seconds** to insert 30k rows,
excluding the intervening migration, searches, and separate failed launch.

The Python 0.7.0 WebSocket seed attempt stalled without completing a batch;
an independent small query eventually completed. All recorded runs use the same package's bundled
`ConvexHttpClient` with `set_admin_auth`. This transport deviation affects client
throughput, while search latency remains measured inside the action.

## 3. Storage and cost

Dashboard storage accounting supplied no sample for this newly created project
before cleanup, including repeated checks at 30k. Empty query results are
recorded as unavailable, not zero.
The CLI usage endpoint reports activity, not instantaneous storage. Database and
search storage at 300k/1M are unmeasured because those datasets were not loaded.

Raw float payload alone is `rows × 1536 × 8` bytes (decimal GB):

| Rows | Raw float GB, calculated | Billed database GB | Billed search GB |
| ---: | ---: | --- | --- |
| 30,000 | 0.36864 | Unmeasured | Unmeasured |
| 100,000 | 1.2288 | Unmeasured | Unmeasured |
| 300,000 | 3.6864 | Unmeasured | Unmeasured |
| 1,000,000 | 12.288 | Unmeasured | Unmeasured |
| 2,000,000 | 24.576 | Unmeasured | Unmeasured |

These are lower bounds on database payload, excluding document metadata and
database/search indexes. Do not use them as billed storage measurements.

At published US-region Pro rates, the monthly storage projection is
`$0.20 × max(DB_GB − remaining_DB_allowance, 0) + $0.50 × max(search_GB − remaining_search_allowance, 0)`.
Full unused allowances are 50 GB database and 1 GB search. Search traffic costs
`$0.10 / 1000 query-GB` beyond its 50,000 query-GB monthly allowance. Pro also has
a $25/developer/month subscription; it was not purchased for this run. A dollar
projection for the 300k/1M index remains unmeasured until its search storage is
observed. Allowances are shared with the team's other projects.
[Pricing](https://www.convex.dev/pricing), [limits and deployment classes](https://docs.convex.dev/production/state/limits).

Starter is pay-as-you-go beyond included resources; it is not the Free plan's
hard 0.5 GB cap. Its rates are $0.22/GB-month for database storage and $0.55/GB-month
for search storage after 0.5 GB each. This corrects the plan's conflation of
Free and Starter, but does not justify substituting Starter measurements for Pro.
[Pricing](https://www.convex.dev/pricing).

The last CLI usage snapshot reported **4.729 GB database I/O**, **473.18 query-GB**,
**6,906 function calls**, and **0.004648 Convex-action GB-hours**. It was marked
`seedStatus: partial`, so these are observed counters, not a settled bill.
Reported I/O alone corresponds to about **$0.82–$1.04** at Starter's $0.22/GB,
depending on how much of the 1 GB allowance remains; this excludes delayed
usage and other charges. Exact total cost is unmeasured. The project was deleted,
so it has **no continuing retained-data storage cost**.
[Pricing](https://www.convex.dev/pricing).

## 4. Version doubling and deletion

The fallback exercises **15k v1 → 15k v1 + 15k v2 → 15k v1**, then appends v1
to 30k for the final steady measurement. The requested 1M→2M migration is
unmeasured. Insertion and search logs have timestamps so only overlapping
searches are counted as concurrent-insert samples.

Deletion uses bounded 250-row pages of `by_objectId_modelVersion`. Its leading
field is `objectId`, so it cannot seek by model version alone; deleting one
version must scan both versions. The report records scanned rows, deleted rows,
elapsed time, preserved v1 count, and a direct v2-only search after deletion.
Missing documents during result hydration are separate from vector-index
consistency because the hydration query is a later transaction.
[Vector search consistency and transaction boundaries](https://docs.convex.dev/search/vector-search).

The strict overlapping interval contains the following samples. Only client
calls wholly within the first-insert-start to last-insert-commit interval are
included; the insertion finished before the full 200-call sequence, so this
table does not claim 200 concurrent-insert calls per configuration.

| During 15k→30k insert | Samples | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| v1, limit 32 | 71 | 6.20 | 7.15 | 81.55 |
| v1 OR v2, limit 32 | 70 | 8.20 | 10.06 | 19.25 |
| v1, limit 256 | 71 | 9.00 | 10.30 | 31.98 |
| v1 OR v2, limit 256 | 71 | 11.00 | 13.40 | 19.11 |

These p99 estimates are sensitive to individual outliers in the small sample.
The independent dashboard system query confirmed 30,000 documents at the
doubled stage and both indexes in `done` state; see `doubled-state.json`.

At the stable doubled stage (15k/version, 30k total), all configurations completed
200 calls. Times below exclude metadata hydration:

| Stable doubled table | p50 ms | p95 ms | p99 ms | Median distinct objects |
| --- | ---: | ---: | ---: | ---: |
| v1, limit 32 | 5.20 | 5.70 | 6.01 | 31 |
| v1 OR v2, limit 32 | 5.20 | 5.70 | 5.90 | 19 |
| v1, limit 256 | 8.00 | 8.50 | 9.64 | 254 |
| v1 OR v2, limit 256 | 8.10 | 8.80 | 9.00 | 147.5 |

Deleting v2 scanned **30,000** rows and deleted **15,000** in **59.67 seconds**.
The next direct v2-only search returned `[]`. The v1 checkpoint remained at
15,000 rows. After deletion, each configuration completed another 200 calls:

| After v2 deletion (15k v1) | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| v1, limit 32 | 5.40 | 6.10 | 7.34 |
| v1 OR v2, limit 32 | 5.40 | 6.10 | 6.40 |
| v1, limit 256 | 8.30 | 8.80 | 9.62 |
| v1 OR v2, limit 256 | 8.50 | 9.11 | 20.73 |

All 800 post-deletion searches had zero filter violations, missing hydrated
documents, or missed known targets. This is evidence for the tested operations,
not a general proof of index consistency under every concurrent workload.

## 5. Result cap, object crowding, and downstream recommendations

The 256-result API cap does not prevent the current 32-vector request in plan
04.03. A vector hit is not necessarily a distinct object: alternate views and
two versions of the same object can occupy multiple slots. The harness records
distinct-object counts for every query, including queries targeting a noisy
alternate-view pair. In the stable doubled table, OR/32 returned a median of
only **19 distinct objects** (range 13–26), compared with **31** for equality/32. OR/256
returned a median of 147.5 objects. Object grouping does not recover candidates
that never made the vector result limit.

**Recall caveat:** equality/32 missed **3 of 100** seeded multi-view target
objects in the stable doubled stage. Equality/256 and both OR configurations
found all 100 in that phase. The missed targets were `object-000000198`,
`object-000000598`, and `object-000000698`; an indexed database read confirmed
both stored views exist and each primary vector exactly equals the query
(`recall-data-check.json`). These are observed retrieval misses with matching
stored data; the internal index cause was not diagnosed. All three targets
were found again at both limits after deleting v2 (`recall-recheck.json`).
This does not measure artwork-identification accuracy. The result
invalidates an unconditional claim that 32 is sufficient just because the
product requests 32 candidates.

- **Plan 02.05:** use **250 rows/batch** for this 1536-dimensional Python/HTTP JSON
  payload, and halve explicit size rejections. Do not reuse the planned 500/1000
  batch sizes. The existing ≤300 recommendation is a ceiling, not measured
  evidence that every 300-row payload fits.
- **Plan 04.03:** provisionally prefer **limit 256 for candidate retrieval with
  the requested modelVersion equality filter**, then group objects and cap
  geometric verification separately. At the stable doubled stage, 256 recovered
  all known targets at p95 8.5 ms, versus three misses at 32. Validate recall on
  real embeddings and Pro before reducing the limit. Hydrating 256 vector rows
  has a substantial I/O cost: observed client p95 including hydration/HTTP was
  496 ms versus 253 ms at 32 in that phase. These client timings are not the
  action-side vector-search budget. OR queries also require object grouping.
- **Plan 02.08:** version deletion with the planned object-first index scales
  with all rows scanned. Decide whether a version-first index is warranted when
  implementing full-scale reembedding; the spike keeps the planned index shape.

## Verification and cleanup

- Isolated TypeScript check passes. Three convex-test tests cover insert
  resumption, atomic rejection, filters, and paginated deletion. Four Python
  tests cover deterministic unit vectors/multi-view generation, percentiles,
  size-only batch reduction, and concurrent-window selection. These tests are not latency measurements.
- A live unauthenticated `bench:stats` query was rejected as non-public; see
  `anonymous-access-check.json`. The spike's npm audit found no vulnerabilities.
- `npx convex codegen` generated the checked-in API/data-model/server bindings;
  `npx convex dev --once` successfully pushed to the disposable dev deployment.
- Root `npx tsc --noEmit` fails on existing web CSS imports in
  `src/components/animated-icon.web.tsx` and `src/constants/theme.ts`. The same
  errors reproduce with only the unchanged app sources included. Spike tooling
  is excluded from the app tsconfig to keep its dependencies/types isolated.
- ESLint is not installed/configured, so lint cannot run. No app behavior
  changed; iOS UI verification is not applicable to this backend-only spike.
- Deleted the disposable project and its deployment at **2026-09-08 11:16:32 UTC**.
  The API returned HTTP 200, the project was absent from the subsequent team
  project list, and all other pre-existing projects remained. The temporary
  local credential and spike environment files were removed. See `cleanup.json`
  and `usage-final.json`; no paid subscription was added or changed.

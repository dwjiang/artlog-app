# Pinecone retrieval benchmark

Measured workload: a 13,617-vector development index in the `recognition` namespace. Results describe this dataset and run method, not live deployment state.

## Dataset and method

- 13,617 stored 512-dimensional cosine vectors; every local baseline vector matched its Convex content hash and Pinecone count.
- 600 queries: 125 in-index Met artworks × 4 augmentations (500), plus 25 out-of-index Met artworks × 4 (100). Known artwork keys and artwork identities were excluded from the earlier 5,499-object calibration sample. Out-of-index objects have distinct artwork keys from all indexed objects.
- Deterministic seeded sampling. Perspective/crop, glare, low light, and frame/blur; images downscaled to at most 1,536 pixels before augmentation, then letterboxed to 512. Query embeddings came from the shipped CoreML model through the existing macOS harness; ORB uses the project extractor.
- Exact baseline: normalized float64 NumPy cosine against all stored vectors, same model/venue partitions and top 32. Both candidate lists pass through the same live Convex hydration, ORB verification and lr-v3 calibration code. No scan records or model-service calls were created.
- 300 global-only scans and 300 scans with venue context. The measured corpus contained no tentative visitor vectors, so venue searches return empty results. Quality run uses concurrency 5; independent timed load runs use the same 60 shuffled mixed queries at concurrency 1, 5 and 10 without exact-baseline work.

## Retrieval and recognition

- Successful queries: 600/600.
- Mean recall@32: 99.3646%; worst query: 93.7500%; tie-aware recall@32: 99.3646% (cosine tolerance 1e-6).
- Exact top-1 score agreement: 561/600. Maximum cosine score difference: 0.00457089.
- Confidence outcomes changed: 0/600. Accepted (confident or soft) winning objects changed: 0. One rejected unknown query had a different best candidate; both providers returned a miss.
  Pinecone scores and raw ordering are approximate: top-1 order matched exact search on 561/600 queries, and score differences reached 0.00457. The ORB/calibrator stage preserved all confidence outcomes in this sample. Approximation-sensitive thresholds require evaluation on the intended corpus.

| Query group   | Provider | Confident | Soft | Miss | Incorrect confident |
| ------------- | -------- | --------: | ---: | ---: | ------------------: |
| known (500)   | pinecone |       499 |    0 |    1 |                   0 |
| known (500)   | exact    |       499 |    0 |    1 |                   0 |
| unknown (100) | pinecone |         0 |    1 |   99 |                   0 |
| unknown (100) | exact    |         0 |    1 |   99 |                   0 |

## Latency from Convex

| Concurrent requests | Search p50 / p95 | Recognition core p50 / p95 | Mac → action → Mac p50 / p95 | Errors |
| ------------------: | ---------------: | -------------------------: | ---------------------------: | -----: |
|                   1 |       15 / 21 ms |               572 / 654 ms |                 820 / 920 ms |   0/60 |
|                   5 |       17 / 37 ms |               593 / 652 ms |                 831 / 907 ms |   0/60 |
|                  10 |       16 / 41 ms |               612 / 681 ms |                 849 / 966 ms |   0/60 |

Search includes the parallel provider calls. Recognition core includes search, Convex document hydration, ORB file reads, verification and calibration. It excludes image capture, on-device inference, auth/rate limiting, scan persistence, UI rendering and docent work. These are warm short runs (60 samples per concurrency); p99 and maxima are in summary.json, but are not stable tail-latency estimates.

## Metered usage and full-corpus projection

| Scan shape | Observed RU/scan | Metered egress/scan | At 100,000 scans/month |
| ---------- | ---------------: | ------------------: | ---------------------- |
| global     |             1.00 |          5265 bytes | 100,000 RU; 0.526 GB   |
| venue      |             2.00 |          5282 bytes | 200,000 RU; 0.528 GB   |

Estimated vector storage, including IDs and serialized partition metadata: **0.031 GB for the sample**, **0.915 GB for all 402,139 vectors** (2276 bytes/vector). Keeping both dev and full production copies would total about 0.946 GB. Decimal GB; projected from the measured record format, not a billed storage reading.

Provider storage, read/write units, and egress allowances are shared across
indexes and maintenance traffic. Verify pricing and entitlement before using a
projection as a budget. Observed queries reported 1 RU each. A metadata filter
does not shrink the billable namespace. Query response `usage.readUnits` and
`usage.egressBytes` are measured separately from response JSON bytes.

A separate 32-record synthetic venue probe (same ID/partition byte lengths, isolated from recognition traffic) measured 5,937 billed bytes for a full venue response. Combined with the observed global response, two full result sets at 100K scans project **1.120 GB egress** and **200,000 RU**. Extra fetches also contribute to usage. Evaluate both populated global and venue responses when estimating traffic.

## Consistency and cleanup

Five isolated temporary records exercised insert, overwrite and delete. Times below run from write acknowledgement to the first successful query response; they include client network time and 200 ms polling intervals, so they are visibility upper bounds.

| Operation | Median | Maximum observed |
| --------- | -----: | ---------------: |
| insert    | 898 ms |          1011 ms |
| update    | 360 ms |          1006 ms |
| delete    | 873 ms |           930 ms |

Stale content versions were rejected by live Convex hydration in all 5 trials. This measures provider visibility after acknowledgement, not mutation-to-scheduler queue latency.

## Interpretation limits

This is a fixed development retrieval comparison: one museum source, synthetic
camera effects, 25 unknown artworks, no populated tentative venue partition,
no real museum camera captures, no sustained soak test, and no full-corpus
latency/recall measurement. It cannot establish a zero false-match rate or
production recognition accuracy. The measured recognition pipeline used
`lr-v3`; [active weights](../../convex/lib/calibrator/weights.ts) define the app's
calibrator independently of this benchmark.

The backend benchmark surface is
[searchBenchmark.ts](../../convex/searchBenchmark.ts). Quality comparison and
timed load runs must stay separate so exact-baseline work does not distort
provider latency.

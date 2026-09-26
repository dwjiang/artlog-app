# Pinecone development benchmark — 2026-09-26

Target: Convex `dev:usable-owl-256`, Pinecone `artlog-dev-512`, namespace `recognition`. The production deployment was not accessed or changed.

## Dataset and method

- 13,617 stored 512-dimensional cosine vectors; every local baseline vector matched its Convex content hash and Pinecone count.
- 600 queries: 125 in-index Met artworks × 4 augmentations (500), plus 25 out-of-index Met artworks × 4 (100). Known artwork keys and artwork identities were excluded from the earlier 5,499-object calibration sample. Out-of-index objects have distinct artwork keys from all indexed objects.
- Deterministic seed 20260926. Perspective/crop, glare, low light, and frame/blur; images downscaled to at most 1,536 pixels before augmentation, then letterboxed to 512. Query embeddings came from the shipped CoreML model through the existing macOS harness; ORB uses the project extractor.
- Exact baseline: normalized float64 NumPy cosine against all stored vectors, same model/venue partitions and top 32. Both candidate lists pass through the same live Convex hydration, ORB verification and lr-v3 calibration code. No scan records or model-service calls were created.
- 300 global-only scans and 300 scans with venue context. The restored corpus has no tentative visitor vectors, so venue searches return empty results. Quality run uses concurrency 5; independent timed load runs use the same 60 shuffled mixed queries at concurrency 1, 5 and 10 without exact-baseline work.

## Retrieval and recognition

- Successful queries: 600/600.
- Mean recall@32: 99.3646%; worst query: 93.7500%; tie-aware recall@32: 99.3646% (cosine tolerance 1e-6).
- Exact top-1 score agreement: 561/600. Maximum cosine score difference: 0.00457089.
- Confidence outcomes changed: 0/600. Accepted (confident or soft) winning objects changed: 0. One rejected unknown query had a different best candidate; both providers returned a miss.
  Pinecone scores and raw ordering are approximate: top-1 order matched exact search on 561/600 queries, and score differences reached 0.00457. The live ORB/calibrator stage preserved all confidence outcomes in this sample. Recheck score-sensitive thresholds at full-corpus scale.

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

Estimated vector storage, including IDs and serialized partition metadata: **0.031 GB now**, **0.915 GB for all 402,139 vectors** (2276 bytes/vector). Keeping both dev and full production copies would total about 0.946 GB. Decimal GB; projected from the current record format, not a billed storage reading.

[Pinecone Starter](https://www.pinecone.io/pricing/) currently includes 2 GB storage, 1M RU/month, 2M WU/month and 1 GB/month egress for $0. The sampled workload fits those allowances at 100K scans/month, including estimated full-corpus storage. Other indexes, ingestion, maintenance, fetches and traffic share these allowances.

Observed queries report 1 RU each. [The current cost guide](https://docs.pinecone.io/guides/manage-cost/understanding-cost) describes a lower 0.25-RU minimum and namespace-size scaling; budget from the measured 1 RU here and remeasure the full index. A metadata filter does not shrink the billable namespace. Query response `usage.readUnits` and `usage.egressBytes` are the measured meters; response JSON bytes are also retained separately.

A separate 32-record synthetic venue probe (same ID/partition byte lengths, isolated from recognition traffic) measured 5,937 billed bytes for a full venue response. Combined with the observed global response, two full result sets at 100K scans project **1.120 GB egress** and **200,000 RU**. This exceeds the 1 GB Starter egress allowance. Extra fetches also count. Starter blocks reads after the allowance is exhausted; the current Builder plan is $20/month. No plan upgrade was made.

## Consistency and cleanup

Five isolated temporary records exercised insert, overwrite and delete. Times below run from write acknowledgement to the first successful query response; they include client network time and 200 ms polling intervals, so they are visibility upper bounds.

| Operation | Median | Maximum observed |
| --------- | -----: | ---------------: |
| insert    | 898 ms |          1011 ms |
| update    | 360 ms |          1006 ms |
| delete    | 873 ms |           930 ms |

Stale content versions were rejected by live Convex hydration in all 5 trials. All temporary records were removed; final remote count is 13,617 and the durable sync queue is ready. This measures provider visibility after acknowledgement, not mutation-to-scheduler queue latency.

## Restore and limits

The earlier development reset left Convex empty while Pinecone retained orphaned IDs. Before measurement, restored only the existing 10,001-canonical-object sample (13,617 vector views), its aliases, ORB references and 793 required venues from local corpus files. Kept a local recovery snapshot of orphaned remote records, removed those exact IDs, imported with fresh resumable checkpoints, and verified counts plus the importer’s deterministic 2% readback. The 402,139-vector production upload remains deferred.

This is a development migration check, not a production recognition certification: one museum source, synthetic camera effects, 25 unknown artworks, no populated tentative venue partition, no real museum camera captures, no sustained soak test and no full-corpus latency/recall run. This sample cannot establish a zero false-match rate. Repeat against the full corpus and real camera captures before production launch.

Verification: `npx tsc --noEmit`, `npm run lint`, and the backend suite (1,080 passed; two opt-in tests skipped). No iOS UI or capture behavior changed for the benchmark; the earlier migration simulator check does not cover a physical camera scan.

Raw artifacts are under `.context/pinecone-benchmark/`: `accuracy.jsonl`, `exact-matches.json`, `latency-{1,5,10}.jsonl`, `freshness.json`, `summary.json`, restore checkpoints/reports, query manifest and image fixtures. Credentials are loaded locally and are not written to these reports.

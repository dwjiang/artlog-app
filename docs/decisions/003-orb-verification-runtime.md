# 003 — ORB verification in the Convex runtime

Date: 2026-09-09. Plan: [00.03](../plans/00-kickoff-spikes/03-orb-verification-in-convex-runtime.md).

## Decision

**Go for a scalar WASM matcher, keeping RANSAC in JavaScript. Recommend a
10-candidate verification cap and retain the 500-keypoint cap.** The existing
JavaScript verifier takes 201 ms p95 for 10×500 positive pairs, but 318 ms for
10×500 pairs with inconsistent geometry. Twenty positive pairs already take
404 ms, or 421 ms across separate action invocations. The planned 100–300 ms
JavaScript budget for roughly 20 candidates is not supported at 500 keypoints.

The isolated WASM prototype returns identical default matches and exceeds the
plan's 2× speedup threshold. It is a measured prototype, not an integration into
the production verifier. `convex/lib/orb/` in the main app was not changed.

For [04.03](../plans/04-backend/03-identify-action.md), integrate the scalar
matcher before treating the accelerated timings as the identify action's
budget. Keep candidate retrieval separate: [decision 002](002-vector-search-scale.md)
recommends retrieving up to 256 vectors; group by object, rank, then verify at
most 10 candidates. Unverified candidates are not proven negative. Evaluate the
recall cost of this cap on real artwork scans before raising it.

For [03.04](../plans/03-on-device/04-orb-module.md), keep 500 features on the
phone and the existing wire format. Reducing both sides to 300 lowers CPU cost,
but this synthetic timing test does not establish that the resulting recall is
acceptable. A query-only reduction to 300 would not have the measured 300×300
cost when reference rows still contain 500 features.

## Environment and measurement boundaries

Temporary **dev** deployment `neat-reindeer-108`, project `artlog-spike-orb`,
team `daniel-jiang`, US East (N. Virginia), Convex Starter (documented S16
allocation). Convex JS/CLI 1.45.0; default V8 runtime for every action. The
production ORB source is pinned at commit
`f650ab81c425903959d07bb5bc6f8e12ea4f972f`, with byte-for-byte snapshot hashes in
[`source-manifest.json`](../../spikes/orb-runtime/source-manifest.json).
[`environment.json`](../../spikes/orb-runtime/results/2026-09-09/environment.json)
records the compiler and binary hash.

The current [runtime documentation](https://docs.convex.dev/functions/runtimes)
supports `performance.now()` in actions and bundled `.wasm` imports. The
[limits documentation](https://docs.convex.dev/production/state/limits) lists
64 MiB for the default runtime, a 32 MiB code limit, and 16 MiB action arguments
and returns. Its current default-action timeout is 30 minutes; the plan's
10-minute timeout applies to Node actions. No Node runtime is used here.

The full [reproduction instructions](../../spikes/orb-runtime/README.md) define
the workloads. Highlights:

- Exactly 300×300 or 500×500 features; the fixture's extra query outliers are
  shuffled and trimmed into new, correctly sized buffers. About 77% of retained
  query features have real synthetic correspondences, with 6% bit flips and
  0.7 px noise. The default homography and default verifier options are retained.
- One distinct fixture per pair, held for the action; pairs run sequentially.
  The main matrix has five warmup rounds and 100 timed rounds per configuration.
  Timed intervals exclude fixture generation and network transport. Raw JSONL
  contains every per-pair time, total time, inlier count, and verified count.
- Percentiles interpolate linearly at `(n − 1) × p`. Samples from one action
  share fixtures and runtime state. A separate 100-action check uses new seeds
  and no in-action warmup; it does not claim a new isolate per request.
- These fixtures establish CPU and memory behavior, not artwork accuracy or a
  production latency distribution. Real near-duplicate imagery may exercise
  different RANSAC behavior. No measurements establish Pro/S256 performance.

## 1. Existing JavaScript verifier

All times are milliseconds measured **inside** the action. Each row contains
100 sequential verification rounds after five warmups.

| Query × reference | Pairs | Batch p50 | Batch p95 | Per-pair p50 | Per-pair p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 300 × 300 | 1 | 7.40 | 7.81 | 7.40 | 7.81 |
| 300 × 300 | 10 | 73.30 | 73.61 | 7.30 | 7.50 |
| 300 × 300 | 20 | 148.00 | 148.82 | 7.40 | 7.60 |
| 500 × 500 | 1 | 20.20 | 20.70 | 20.20 | 20.61 |
| 500 × 500 | 10 | 200.40 | 201.42 | 20.00 | 20.20 |
| 500 × 500 | 20 | 401.20 | 404.12 | 20.00 | 20.30 |

Across **100 separate** 20×500 action invocations, the batch p50/p95 was
**418.65 / 421.21 ms** (range 416.50–426.80 ms). All main and separate-action
positive pairs verified successfully. These totals exclude setup and HTTP;
`rpcMs` in the raw records includes them.

The following controls have **10 rounds** after one warmup, so their tails are
stress observations with a smaller sample count:

| Control | Keypoints per side | Pairs | Batch p50 | Batch p95 |
| --- | ---: | ---: | ---: | ---: |
| Unrelated descriptors | 300 | 10 | 71.65 | 71.96 |
| Unrelated descriptors | 300 | 20 | 143.60 | 144.72 |
| Unrelated descriptors | 500 | 10 | 199.55 | 203.40 |
| Unrelated descriptors | 500 | 20 | 397.80 | 398.31 |
| Matching descriptors, inconsistent geometry | 300 | 10 | 168.40 | 168.66 |
| Matching descriptors, inconsistent geometry | 300 | 20 | 335.45 | 337.83 |
| Matching descriptors, inconsistent geometry | 500 | 10 | 317.20 | 317.66 |
| Matching descriptors, inconsistent geometry | 500 | 20 | 631.65 | 633.75 |

All controls failed verification as intended. The inconsistent-geometry case
preserves descriptor matches but randomizes query coordinates, driving RANSAC
to its 1,000-iteration ceiling. Its 10×500 result triggered the conditional
WASM investigation even though the positive baseline was under 300 ms.

## 2. Memory

The probe holds independent query/reference buffers for every pair, verifies
every pair, then reads every buffer into a checksum so buffers remain live
through verification. It does not expose peak V8 heap telemetry.

| 500-keypoint pairs | Retained raw buffer bytes | MiB | Result |
| ---: | ---: | ---: | --- |
| 10 | 480,000 | 0.46 | Passed |
| 20 | 960,000 | 0.92 | Passed |
| 40 | 1,920,000 | 1.83 | Passed |
| 80 | 3,840,000 | 3.66 | Passed |
| 160 | 7,680,000 | 7.32 | Passed |
| 320 | 15,360,000 | 14.65 | Passed |
| 640 | 30,720,000 | 29.30 | Passed |
| 1,024 | 49,152,000 | 46.88 | Passed |
| 1,536 | 73,728,000 requested | 70.31 | OOM during the action |

The failure explicitly reported “JavaScript execution ran out of memory
(maximum memory usage: 64 MB).” The larger 2,048-pair probe was not attempted
after that failure. The wall is bracketed between these tested workloads,
not an exact buffer capacity: objects, temporary fixtures, matches, solver
allocations, code, and runtime overhead also consume memory.

Twenty stored references occupy 480,000 bytes; adding one shared query gives
504,000 bytes. The 20-pair probe holds 960,000 bytes because every reference has
its own query. Neither the 20- nor 40-pair workload approached a demonstrated
memory failure. Subsequent actions and the WASM deployment succeeded after OOM.
The WASM matcher adds a fixed **131,072-byte** memory, reused between candidates.

## 3. WASM go/no-go

**GO.** AssemblyScript 0.28.20, optimization level 3, stub runtime, SIMD and
relaxed SIMD disabled. The module is **322 bytes**, contains scalar `i32.popcnt`
operations, imports no host functions, and instantiates from a Convex `.wasm`
import in about **0.1 ms**. The readable WAT and build configuration are committed.

The comparison times matching only: both descriptor copies into WASM memory,
the 2-NN ratio/distance tests, result conversion, and stable sorting are included.
JS/WASM execution order alternates by round; each result is checked for exact
equality outside the timer. The unchanged JavaScript RANSAC is timed separately.
Each row has five warmups and 100 measured rounds.

| Profile | Keypoints per side | Pairs | JS match p95 | WASM match p95 | Matching speedup, p50 | WASM match + JS RANSAC p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Positive | 300 | 10 | 72.30 | 11.80 | 6.26× | 13.31 |
| Positive | 500 | 10 | 199.90 | 31.40 | 6.39× | 33.70 |
| Positive | 500 | 20 | 398.80 | 62.70 | 6.39× | 68.60 |
| Inconsistent geometry | 300 | 10 | 72.50 | 11.80 | 6.25× | 109.81 |
| Inconsistent geometry | 500 | 10 | 199.60 | 31.50 | 6.39× | 153.22 |
| Inconsistent geometry | 500 | 20 | 398.91 | 62.81 | 6.38× | 308.51 |

The prototype implements the currently used forward matcher (`crossCheck:
false`). Unlike the JS implementation, it does not maintain unused reverse
nearest-neighbor bookkeeping. The measured speedup therefore includes that
work reduction, as well as scalar WASM execution. It does not implement the
optional cross-check API and is not a drop-in replacement for every library
option. Local parity tests cover all three profiles, 20/300/500/1,000 features,
empty and unequal sets, tied descriptors, thresholds, and memory reuse. Every
cloud pair also passed exact match-array equality.

With 10×500, WASM matching plus JS RANSAC has p95 **33.70 ms** for
the positive fixture and **153.22 ms** for inconsistent geometry. Twenty
inconsistent pairs still reach **308.51 ms**, because RANSAC dominates after
matching is accelerated. This supports the conservative **10-candidate cap**.
Adding the separately measured roughly 50–55 ms for 20 descriptor rows leaves
room under 300 ms at 10 candidates in these workloads. This arithmetic is a
planning estimate, not a measured joint percentile or an end-to-end latency SLA.

The match-plus-RANSAC measurements omit the verifier's final corner projection
and quad sanity checks; do not present them as a measured full WASM
`verifyOrb` or identify action. Production integration must preserve that final
verification gate and rerun the full action benchmark. No WASM SIMD or native
service is needed to achieve the measured matcher speedup.

## 4. Descriptor reads

Each query returns **20 complete rows** through 20 parallel `by_objectId`
lookups. Descriptor fields and the index match production; a minimal `objects`
table supplies real IDs. Seeding/upserts happen before timing. Every sample
checks row count, decoded keypoint count, and both buffer sizes.

| Keypoints per row | Raw bytes | Query arguments | Read p50 | Read p95 | First read, separate |
| ---: | ---: | --- | ---: | ---: | ---: |
| 300 | 288,000 | Repeated, cache eligible | 3.30 | 3.70 | 48.70 |
| 500 | 480,000 | Repeated, cache eligible | 4.70 | 5.40 | 55.10 |
| 300 | 288,000 | Different permutation each call | 33.50 | 43.42 | 42.40 |
| 500 | 480,000 | Different permutation each call | 45.15 | 48.75 | 54.90 |

Each row has 100 measured reads, plus the separately recorded first read.
Permutations change the query cache key while retaining the same 20 indexed
objects; underlying database pages may still be hot. Use roughly **50–55 ms**
for this measured 20-row read workload, not the 5 ms cache-hit result. This is
action-side query latency, including row serialization/transfer, not network
latency from the phone. Decode/validation after the read had p95 **0.1 ms** in
all configurations; zero-valued samples reflect timer granularity, not free work.

## Verification and evidence

- Root `npx tsc --noEmit` and `npm run lint` pass. Isolated typecheck passes.
- Seven spike tests pass, including rebuilding WASM and checking exact parity.
  These tests establish correctness, not cloud performance.
- `npx convex codegen` and `npx convex dev --once` succeed on the disposable dev
  deployment, including the `.wasm` import. Generated bindings are committed.
- An unauthenticated live call was rejected as non-public; all functions are
  internal. No secrets are included in the spike or results.
- The main app and its backend were not changed, so there is no changed iOS
  behavior to exercise with `npm run ios`.
- Raw samples, environment, usage, and cleanup evidence are under
  [`results/2026-09-09/`](../../spikes/orb-runtime/results/2026-09-09).
  `node summarize.mjs results/2026-09-09` recomputes summaries, verifies stored
  percentiles, and checks positive/negative outcomes and read completeness.
  The last usage snapshot still reports `seedStatus: partial`; it is not a
  final billing total.

Deleted the disposable project and deployment at **2026-09-09 11:41:27 UTC**.
The management API returned HTTP 200; a subsequent complete team project list
omitted the spike and retained every pre-existing project. Temporary credential
and generated environment files were removed. No subscription was changed.

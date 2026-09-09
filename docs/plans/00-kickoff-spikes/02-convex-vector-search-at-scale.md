# Spike 00.02: Measure Convex vector search at 300k and 1M vectors

> **Executor instructions**: Time-boxed investigation (1 day). Deliverable is a
> decision record. Record numbers honestly; stop at the time box. Update the
> status row in `docs/plans/README.md` when done.
>
> **Drift check**: `ls docs/decisions/002-vector-search-scale.md` must not exist.

## Status

- **Priority**: P0 (gates the decision to keep Convex as the vector store; there is no pre-chosen fallback — the numbers decide)
- **Effort**: S–M (1 day + background insert time)
- **Risk**: LOW (throwaway deployment; costs a few dollars of storage while it exists)
- **Depends on**: none (a Convex account on the Pro plan is required for the 300k/1M runs — Free/Starter allows 0.5 GB)
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.2 puts vector search inside the `identify` action with a ~50–100 ms budget (§9) and states "Convex vector search is unproven at this scale" (§11). Storage math in §5.7 doubles now that the embedding is 1536-wide (plan 01.03): ~12 KB of floats per row plus search-index storage. This spike measures latency, storage accounting and the filter behavior so the architecture decision is made on numbers.

## Facts established during planning

- `vectorIndex(name, { vectorField, dimensions (2–4096), filterFields (≤16) })`; ≤4 vector indexes per table; `ctx.vectorSearch` is action-only, `limit` 1–256, returns `[{ _id, _score }]` (cosine); `filter: q => q.eq(field, value)` / `q.or(...)`; "consistent and fully up-to-date"; docs claim "millions of vectors".
- Pro pricing: search storage 1 GB included then $0.50/GB-month (shared with text search); search queries 50,000 query-GBs included then $0.10 per 1,000; DB storage 50 GB included then $0.20/GB; the float array also counts toward DB storage.
- Per-mutation limits: 16,000 documents / 16 MiB written; Pro write throughput 8 MiB/s. Python client `convex` 0.7.0: `ConvexClient(url).mutation("file:fn", args)`, `set_admin_auth(deploy_key)`; floats map to `v.float64()`.
- Convex-test's in-memory `vectorSearch` is brute force — useless for this measurement; it must run on a real deployment.

## Questions to answer

1. p50/p95/p99 `vectorSearch` latency measured **inside an action** (`performance.now()` around the call) at 100k, 300k and 1M rows with `limit` 32 and the `modelVersion` filter; with `q.or` over two versions; and with `limit` 256.
2. Insert throughput from Python (rows/s at 500 and 1,000 rows per mutation) and total wall time to reach 1M.
3. Storage accounting on the dashboard: DB storage and search storage at each size; projected monthly cost.
4. Behavior while the table doubles (simulating a `reembed` migration, §5.4): latency during a concurrent bulk insert of a second `modelVersion`; deletion time of one version's rows (`by_objectId_modelVersion` index) and whether search stays consistent.
5. Whether the 256-result cap matters for the design (it does not need more than 32; confirm) and whether results within the same object cluster (multi-view vectors) crowd out other objects at `limit` 32.

## Method

Create a throwaway project under `spikes/convex-vector-scale/` (its own `package.json`, `convex/schema.ts` with only `vectors { objectId: string, modelVersion: string, source: string, vector: array(float64) }` + the same vector index and `by_objectId_modelVersion` index as plan 01.03, `convex/bench.ts` with `insertBatch` internal mutation, `search` action, `deleteVersion` paginated mutation, and `stats` query). `npx convex dev --once` on a **new** Convex project named `artlog-spike-vectors` (Pro team). Python `seed.py` generates deterministic pseudo-random unit vectors (seeded; 1536-d; a 1% subset duplicated with small noise to simulate multi-view rows) and inserts via `ConvexClient` with `set_admin_auth` (deploy key from the dashboard, kept in env). `bench.py` calls the `search` action 200 times per configuration and prints percentiles; it also reads the `stats` query.

Run sizes in order 100k → 300k → 1M, recording after each. For question 4, start the 1M→2M insert of `modelVersion: "v2"` and run `bench.py` concurrently; then delete `v2` and time it.

Delete the project (dashboard → settings → delete) at the end, or leave it only if the operator wants to keep it; record the monthly cost either way.

## Deliverable

`docs/decisions/002-vector-search-scale.md`: decision (Convex stays, or what the numbers say has to change — no standby VM is on the table), latency tables, insert throughput, storage and cost at 300k/1M, migration-window behavior, and the recommended `limit` and batch size for plans 04.03 and 02.05.

## Done criteria

- [ ] Decision record exists with all five questions answered or marked unmeasured with a reason
- [ ] `spikes/convex-vector-scale/` committed (no deploy keys; `.env.local` ignored)
- [ ] Throwaway deployment deleted or its cost recorded
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- The team is not on Pro and cannot be — run only the 100k size (fits in Free with ~1.2 GB? it does not: 100k × 12 KB ≈ 1.2 GB DB) → run 30k, report, and mark 300k/1M unmeasured.
- Inserts are rejected for size (>16 MiB) at 1,000 rows — halve and continue; report.

## Maintenance notes

- If p95 at 1M exceeds ~300 ms, report the options the numbers support (a smaller first-release corpus, a lower `limit`, or a different vector store); an always-on Qdrant VM was removed from the design on 2026-09-08, and the choice belongs to the operator, not this spike.

# Spike 00.03: Time ORB matching and RANSAC inside a real Convex action

> **Executor instructions**: Time-boxed investigation (1 day). Deliverable is a
> decision record. Update the status row in `docs/plans/README.md` when done.
>
> **Drift check**: `ls docs/decisions/003-orb-verification-runtime.md` must not exist.

## Status

- **Priority**: P1
- **Effort**: S (1 day)
- **Risk**: LOW
- **Depends on**: `docs/plans/04-backend/01-orb-match-and-ransac.md` (the library to measure)
- **Category**: spike
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §9 budgets ~100–300 ms for "Hamming matching and RANSAC for the top candidates in JavaScript" across ~20 candidates inside the `identify` action, in Convex's default runtime (64 MiB memory, no cold start). §12 asks: per-candidate time in JavaScript, the memory ceiling against ~20 candidates' descriptors, and whether a WASM build is usable if JavaScript is too slow. Plan 04.01 gives us the library and a vitest timing; only a real deployment tells us the truth.

## Facts established during planning

- Default runtime: V8 isolate, 64 MiB memory, WebAssembly supported (`WebAssembly.instantiate`, `.wasm` imports bundled, count toward 32 MiB code size), `performance.now()` available, no `setTimeout`. Node runtime: 512 MiB, 10-minute limit, slower cold path.
- Descriptor payloads: 500 keypoints = 16,000 B descriptors + 8,000 B keypoints (4 float32) = 24 KB per image; 20 candidates ≈ 480 KB.
- Function argument limit 16 MiB; `v.bytes()` values < 1 MiB each.

## Questions to answer

1. Time inside an action for `verifyOrb(query, ref)` with 500×500 descriptors: single pair, and 10 and 20 pairs sequentially (p50/p95 over 100 runs). Same at 300×300.
2. Peak memory (approximate: does it ever OOM at 20 pairs × 500 keypoints? try 40 pairs to find the wall).
3. Whether a WASM Hamming matcher (AssemblyScript or Rust `wasm32-unknown-unknown`, SIMD off) beats the JS `Uint32` SWAR path by ≥ 2× — build it only if JS exceeds 300 ms for 10 pairs.
4. Time to read 20 `descriptors` rows through `ctx.runQuery` (payload ~480 KB) — the other half of the budget.

## Method

In the throwaway project from spike 00.02 (or a new `spikes/orb-runtime/` with its own `convex/`), copy `convex/lib/orb/` and its `testFixtures.ts` from the main repo (do not modify them), add `convex/orbBench.ts` with an action `bench({ pairs, keypoints, runs })` that generates synthetic pairs with the fixture generator, times `verifyOrb` per pair with `performance.now()`, and returns percentiles; a second action `benchRead({ n })` inserts `n` descriptor rows once and times a query that loads them. Run with `npx convex run orbBench:bench '{"pairs":20,"keypoints":500,"runs":100}'`. For question 3, add `convex/orbBenchWasm.ts` importing a `hamming.wasm` built from `spikes/orb-runtime/wasm/` and compare only the matching stage.

## Deliverable

`docs/decisions/003-orb-verification-runtime.md`: measured tables, memory findings, WASM go/no-go, and the recommended verification cap (candidates verified per scan) and keypoint cap for plans 04.03 and 03.04.

## Done criteria

- [ ] Decision record exists with questions 1, 2 and 4 answered; question 3 answered or marked "not needed (JS under budget)"
- [ ] `spikes/orb-runtime/` committed without copying secrets
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- The library from plan 04.01 does not exist yet — run plan 04.01 first.
- The action hits the 64 MiB limit at 10 pairs — report immediately; the design's assumption is wrong.

## Maintenance notes

- Re-run this bench whenever the ORB library or keypoint cap changes; the numbers feed §9's latency table in the README (plan 06.02).

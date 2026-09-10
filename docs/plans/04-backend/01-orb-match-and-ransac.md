# Plan 04.01: Implement ORB descriptor matching and RANSAC homography as a pure-TypeScript library under `convex/lib/orb/`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/lib/orb vitest.config.mts package.json`
> If `convex/lib/orb/` already exists, STOP: someone started this plan; reconcile with them.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (pure logic, fully unit-testable, no I/O)
- **Depends on**: `docs/plans/01-foundation/01-verification-baseline.md` (vitest), `docs/plans/01-foundation/03-convex-project-and-schema.md` (the `convex/` directory exists and `npx convex dev --once` pushes)
- **Category**: feature (greenfield)
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Identification is retrieval-first: a vector search returns ~20 candidate paintings, and the
second gate — "is this literally the same object?" — is geometric verification of the phone's
ORB descriptors against each candidate's **stored** descriptors, run in JavaScript inside the
Convex `identify` action (design §4.1 step 4, §5.2). No reference image is ever needed, which is
what lets in-copyright works be verified at all, and the recovered homography gives the card the
artwork's corners for free. This library is that gate. It is also the single place where the
descriptor wire format is defined; the phone (plan 03.04) and the index build (plan 02.04) both
serialize to it.

From `docs/design/art-identifier.md`:

- §4.1 step 4: "ORB matching + RANSAC homography, in JavaScript: the phone's descriptors against each candidate's stored descriptors… Paintings are flat, rigid and textured — geometric verification is fast (tens of milliseconds per pair even in JavaScript), precise for 'is this literally the same object,' and yields the artwork's corners for free."
- §4.3: "The ORB inlier count is an input and, for textured works, a hard requirement: no consistent homography, no *confident* match."
- §5.1: descriptors are "capped at ~300–500 keypoints (~11–18 KB)".
- §6: "brute-force Hamming matching with a ratio test, RANSAC homography (a small pure-TypeScript implementation)".
- §9: budget for "Hamming matching and RANSAC for the top candidates in JavaScript (~100–300 ms)" across ~20 candidates.

## Current state

- `convex/` exists with `schema.ts`, `_generated/`, `convex.config.ts` (from plan 01.03). There is no `convex/lib/` yet.
- Vitest runs Convex-side tests with `npm run test:convex` (from plan 01.01); config in `vitest.config.mts` includes `convex/**/*.test.ts` under the `edge-runtime` environment. Any file under `convex/` that is not a Convex function module is bundled only if imported by one; test files are excluded from the deploy bundle by the CLI (plan 01.01 verified this with `npx convex dev --once`).
- Conventions (`AGENTS.md`): Convex modules use camelCase filenames; tests co-located as `*.test.ts`; tests organized by observable behavior; comments only for non-obvious reasons; `npx tsc --noEmit` must pass.
- Convex runtime facts the code must respect (default V8 runtime, where `identify` runs): `ArrayBuffer`/typed arrays are available; `v.bytes()` arguments and fields arrive as `ArrayBuffer`; there is no Node `Buffer`. Do not import anything from `node:*`. Keep allocation low (memory ceiling in the default runtime is small — plan 00.03 measures it).

### Wire format (this plan owns it)

**ORB feature set v1** — two `ArrayBuffer`s per image:

| Field | Bytes | Layout |
|---|---|---|
| `descriptors` | `count × 32` | ORB binary descriptors, 256 bits each, row-major, exactly as OpenCV `ORB.detectAndCompute` returns (`uint8`, shape `(count, 32)`) |
| `keypoints` | `count × 16` | `Float32` little-endian tuples `[x, y, size, angle]` per keypoint, same order as descriptors; `x`,`y` in pixels of the letterboxed square input (`0 ≤ x,y < inputSize`), `size` = OpenCV `KeyPoint.size`, `angle` in degrees |

`count` is derived: `descriptors.byteLength / 32`; `keypoints.byteLength` must equal `count × 16`; `count ≤ 1000`. Anything else is a format error. Keypoint order must be the OpenCV output order (response-sorted by `nfeatures`), not re-sorted.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Convex tests | `npm run test:convex` | all pass |
| Single test file | `npx vitest run convex/lib/orb` | all pass |
| Convex push check | `npx convex dev --once` | "Convex functions ready" (no bundling errors) |

## Suggested executor toolkit

- Skill `convex-expert` (`.agents/skills/convex-expert/SKILL.md`) for the import rules that apply to any file under `convex/`.
- OpenCV docs for reference semantics only: `ORB`, `BFMatcher(NORM_HAMMING)` with `knnMatch(k=2)` + Lowe ratio, `findHomography(RANSAC, 5.0)`. This plan re-implements the subset, not the API.

## Scope

**In scope** (create only):

- `convex/lib/orb/features.ts` — types, decode/validate, `OrbFormatError`
- `convex/lib/orb/hamming.ts` — popcount and 256-bit Hamming distance
- `convex/lib/orb/match.ts` — brute-force 2-NN matching with ratio test
- `convex/lib/orb/homography.ts` — DLT solve, RANSAC, projection helpers, deterministic PRNG
- `convex/lib/orb/verify.ts` — `verifyOrb()` façade the identify action will call
- `convex/lib/orb/index.ts` — barrel re-exporting the public API
- `convex/lib/orb/testFixtures.ts` — synthetic feature-set generator used only by tests
- `convex/lib/orb/*.test.ts`

**Out of scope** (do NOT touch):

- `convex/schema.ts`, `convex/identify.ts` — consumers; plan 04.03 wires this library in.
- Any native code (`modules/`) or Python (`jobs/`) — they implement the *same* wire format in plans 03.04 and 02.04; you only define it here.
- WebAssembly or SIMD builds — plan 00.03 decides whether JS is fast enough; do not pre-empt it.

## Git workflow

- Current workspace branch; do not rename or push unless told.
- Conventional Commits with scope `convex`: e.g. `feat(convex): add ORB hamming matcher`, `feat(convex): add RANSAC homography`, `test(convex): cover ORB verification`.

## Steps

### Step 1: Types, decoding and validation (`features.ts`)

```ts
export const DESCRIPTOR_BYTES = 32;
export const KEYPOINT_FLOATS = 4; // x, y, size, angle
export const MAX_KEYPOINTS = 1000;

export type OrbFeatures = {
  count: number;
  descriptors: Uint8Array;   // count * 32
  keypoints: Float32Array;   // count * 4
};

export class OrbFormatError extends Error {}

export function decodeOrbFeatures(descriptors: ArrayBuffer, keypoints: ArrayBuffer): OrbFeatures
export function encodeOrbFeatures(f: OrbFeatures): { descriptors: ArrayBuffer; keypoints: ArrayBuffer }
```

`decodeOrbFeatures` throws `OrbFormatError` when `descriptors.byteLength % 32 !== 0`, when `keypoints.byteLength !== count * 16`, when `count > MAX_KEYPOINTS`, or when any keypoint coordinate is not finite. Views are created over the input buffers without copying (both buffers must start at offset 0 — Convex hands you standalone `ArrayBuffer`s). `encodeOrbFeatures` is the inverse, used by tests and later by the phone-side TypeScript.

**Verify**: `npx vitest run convex/lib/orb/features` → tests for round-trip, each rejection reason, and `count === 0` pass.

### Step 2: Hamming distance (`hamming.ts`)

Implement `hammingDistance32(a: Uint32Array, aWord: number, b: Uint32Array, bWord: number): number` operating on eight 32-bit words per descriptor with SWAR popcount:

```ts
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
```

Provide `descriptorWords(f: OrbFeatures): Uint32Array` that returns a `Uint32Array` view over `f.descriptors` (the buffer starts at offset 0 and `count*32` is a multiple of 4, so the view is valid; if `byteOffset % 4 !== 0`, copy into a fresh aligned buffer — this is the one allocation allowed).

**Verify**: `npx vitest run convex/lib/orb/hamming` → identical descriptors → 0; all-ones vs all-zeros → 256; a single flipped bit → 1; random pairs equal a naïve per-byte reference implementation for 1000 samples.

### Step 3: Brute-force matching with ratio test (`match.ts`)

```ts
export type Match = { queryIdx: number; refIdx: number; distance: number };
export type MatchOptions = { ratio?: number; maxDistance?: number; crossCheck?: boolean };
export function matchDescriptors(query: OrbFeatures, ref: OrbFeatures, opts?: MatchOptions): Match[]
```

Defaults: `ratio = 0.8`, `maxDistance = 64`, `crossCheck = false`. For every query descriptor find the best and second-best reference distances (single pass, no sorting, no per-row allocation); keep the match when `best <= maxDistance && best < ratio * second` (when only one reference descriptor exists, treat `second` as 257). With `crossCheck`, also require that the reference descriptor's best query match is the same pair. Return matches sorted by `distance` ascending.

Performance requirement: matching 500×500 descriptors must complete in under 60 ms on the developer machine (`performance.now()` around the call inside a test; assert `< 150` to leave CI headroom, and print the measured time).

**Verify**: `npx vitest run convex/lib/orb/match` → synthetic fixture (Step 6) gives recall ≥ 0.7 on true correspondences and ≤ 5% false matches among outliers; the timing test passes and prints its number.

### Step 4: Homography solve and RANSAC (`homography.ts`)

- `mulberry32(seed: number): () => number` — deterministic PRNG.
- `solveHomography(src: number[][], dst: number[][]): Float64Array | null` — DLT with `h33 = 1`, solving the `2n × 8` linear system by normal equations (`AᵀA h = Aᵀb`) with Gaussian elimination and partial pivoting; apply Hartley normalization (translate to centroid, scale to mean distance √2) to both point sets before solving and denormalize after. Return `null` when the system is singular (pivot below `1e-12`).
- `applyHomography(H, x, y): [number, number]` (divide by `w`; return `NaN`s if `|w| < 1e-9`).
- `isDegenerateSample(points4)` — true if any three of the four points are collinear (|cross| < 1e-6 relative to spread).
- `ransacHomography(matches, query, ref, opts)`:
  ```ts
  export type RansacOptions = { threshold?: number; maxIterations?: number; confidence?: number; seed?: number };
  export type RansacResult = { H: Float64Array | null; inlierMask: Uint8Array; inlierCount: number; iterations: number };
  ```
  Defaults: `threshold = 5` px (reprojection error, ref→query), `maxIterations = 1000`, `confidence = 0.995`, `seed = 1`. Sample 4 distinct matches, skip degenerate samples, solve, count inliers by reprojection distance, keep the best, update the adaptive iteration bound `k = log(1 − confidence) / log(1 − w⁴)` where `w = inliers/matches`. Return `H: null` when `matches.length < 4` or no sample yields ≥ 4 inliers. After the loop, refit `H` on all inliers of the best model (least squares via the same solver) and recompute the mask once.

**Verify**: `npx vitest run convex/lib/orb/homography` → exact 4-point recovery of a known `H` (max reprojection error < 1e-6); with 30% outliers and 1 px noise, recovered inliers ≥ 90% of true correspondences and reprojection error on inliers < 2 px; same seed → byte-identical result; `matches.length < 4` → `H: null` without throwing.

### Step 5: Verification façade (`verify.ts`)

```ts
export type VerifyOptions = MatchOptions & RansacOptions & { minInliers?: number; inputSize: number };
export type VerifyResult = {
  matchCount: number;
  inlierCount: number;
  homography: number[] | null;         // 9 numbers row-major, ref → query
  corners: [number, number][] | null;  // ref square corners projected into query space
  verified: boolean;
};
export function verifyOrb(query: OrbFeatures, ref: OrbFeatures, opts: VerifyOptions): VerifyResult
```

`minInliers` defaults to 15. `verified` is true only when `inlierCount >= minInliers` **and** the homography is sane: determinant of the upper-left 2×2 not within `[−1e-6, 1e-6]`, the projected quad is convex with consistent winding, and its area is between 0.05× and 20× of `inputSize²`. Corners are `(0,0), (S,0), (S,S), (0,S)` with `S = inputSize` projected through `H`. When `count < 4` on either side, return zeros with `verified: false` — never throw for small inputs; only malformed buffers throw (Step 1).

**Verify**: `npx vitest run convex/lib/orb/verify` → the synthetic positive pair verifies with corners within 3 px of ground truth; an unrelated random pair gives `inlierCount < 8` and `verified: false`; a pair with `count = 3` returns `verified: false` without throwing.

### Step 6: Synthetic fixtures (`testFixtures.ts`)

`makeSyntheticPair({ seed, count, inputSize, outlierFraction, bitFlipFraction, homography })` produces `{ ref, query, truth: { H, correspondences: [refIdx, queryIdx][] } }`: reference keypoints uniformly random in `[16, S−16)`, descriptors random bytes; query = reference points mapped through `homography` (default: 10° rotation + mild perspective + translation) plus Gaussian noise σ=0.7 px, descriptors copied with `bitFlipFraction` (default 0.06) of bits flipped; `outlierFraction` (default 0.3) extra query features with random positions and descriptors; shuffle query order with the seeded PRNG and record the correspondence map. Keep this file out of the barrel export.

**Verify**: it is exercised by Steps 3–5; `npm run test:convex` → all green.

### Step 7: Barrel, push check, and budget note

`index.ts` re-exports `decodeOrbFeatures`, `encodeOrbFeatures`, `OrbFormatError`, `matchDescriptors`, `ransacHomography`, `applyHomography`, `verifyOrb` and the types. Run `npx convex dev --once` to confirm the deploy bundle still builds with the new files present (the library is not yet imported by a function, so this only proves nothing under `convex/lib/orb` breaks bundling).

**Verify**: `npx convex dev --once` → success; `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

## Test plan

Files: `features.test.ts`, `hamming.test.ts`, `match.test.ts`, `homography.test.ts`, `verify.test.ts` under `convex/lib/orb/`, run by vitest (edge-runtime environment; no Convex backend needed — these are pure functions, do not use `convexTest` here).

Cases (all listed above per step), organized by behavior:

- Wire format: round-trip; each malformed input; empty set.
- Distance: identity, complement, single-bit, agreement with a naïve reference.
- Matching: recall/precision on synthetic pair; ratio-test rejection when second-best is close; cross-check reduces false matches; 500×500 timing.
- Homography: exact recovery; robustness to outliers and noise; determinism by seed; degenerate/too-few inputs.
- Verification: positive pair corners; negative pair; tiny inputs; sanity rejection when the refit quad is non-convex (construct by feeding a reflected `H`).

Pattern to model after: none exists yet in this repo for pure logic under `convex/`; use `describe('<behavior>')` + `it('<observable outcome>')` with `expect` from vitest.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test:convex` exits 0 and includes ≥ 20 tests under `convex/lib/orb/`
- [ ] Timing test prints a 500×500 match time and asserts `< 150` ms
- [ ] `npx convex dev --once` succeeds
- [ ] `grep -rn "from 'node:\|from \"node:\|Buffer\." convex/lib/orb` → no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `convex/lib/orb/` already exists (drift).
- `npm run test:convex` does not exist or vitest is not configured (plan 01.01 not done).
- The 500×500 match cannot get under 150 ms even with the `Uint32Array` + SWAR path — report the number; plan 00.03 owns the WASM decision.
- Vitest's `edge-runtime` environment lacks `Float32Array`/`DataView` behavior you need (it should not) — report rather than switching environments.

## Maintenance notes

- The wire format is a cross-language contract. Plans 03.04 (phone ORB) and 02.04 (index build) must produce identical layouts; each includes a fixture test that decodes a byte string generated by the other side. If the format ever changes, bump to "v2" in this file's header comment and update all three.
- Keypoint coordinates are in **letterboxed input pixels**; the letterbox spec lives in plan 02.04 / 03.02. A resolution mismatch between phone and index silently ruins verification — the drift check in plan 02.04 is the guard.
- Reviewers should scrutinize: allocation inside the matching loop (none allowed), determinism (`seed` threaded everywhere), and that `verified` requires both inliers and a sane quad.
- Deferred on purpose: WASM/SIMD acceleration (plan 00.03 decides), GPU/native verification, descriptor compression.

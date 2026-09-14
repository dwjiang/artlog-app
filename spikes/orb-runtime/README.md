# ORB in the Convex runtime

Disposable cloud benchmark for the unchanged TypeScript ORB verifier. The
[ORB findings](../../docs/todos/experiment-findings/README.md#orb-verification) contain
the findings and downstream caps. Raw action samples are in `results/2026-09-09/`.

## Reproduce

From this directory:

```sh
npm ci
npm run typecheck
npm test
```

`convex/lib/orb/` preserves the measured production library, including
`testFixtures.ts` and excluding its tests. Documentation comments were cleaned
without changing compiled code. `source-manifest.json` retains the original
commit and `measuredSourceSha256`; its `sha256` map identifies the current
snapshot bytes. The runner checks the current hashes before calling Convex.
To measure a changed verifier, replace the snapshot and update the manifest;
write the new measurements to a separate directory.

Create a disposable **dev** project/deployment using an existing CLI login:

```sh
npx convex project create artlog-spike-orb --team YOUR_TEAM
npx convex deployment create YOUR_TEAM:artlog-spike-orb:orb-spike --type dev --region us --expiration 'in 1 day'
```

Copy `.env.example` to `.env.spike.local`, fill in the deployment name and URL,
and save the temporary credential there:

```sh
npx convex deployment token create orb-runtime-spike --deployment YOUR_TEAM:artlog-spike-orb:orb-spike --save-env .env.spike.local
node --env-file=.env.spike.local node_modules/convex/bin/main.js codegen
npx convex dev --once --env-file .env.spike.local
```

Load the env file as dotenv data; do not source it as a shell script (deploy
keys contain `|`). Convex
may also create `.env.local` and a redundant `.gitignore` here during setup;
remove those generated files after the spike. Keep the main app's environment
pointed at its own deployment.

Choose one new directory for the run and use it for every mode and the summary.
Run the modes sequentially to avoid competing benchmark actions:

```sh
ORB_RESULTS_DIR="results/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
npm run bench -- matrix "$ORB_RESULTS_DIR/matrix.jsonl"
npm run bench -- reads-permuted "$ORB_RESULTS_DIR/reads-permuted.jsonl"
npm run bench -- controls "$ORB_RESULTS_DIR/controls.jsonl"
npm run bench -- fresh "$ORB_RESULTS_DIR/fresh.jsonl"
npm run bench -- memory "$ORB_RESULTS_DIR/memory.jsonl"
npm run bench -- wasm "$ORB_RESULTS_DIR/wasm.jsonl"
node summarize.mjs "$ORB_RESULTS_DIR"
```

Each mode accepts an explicit JSONL output path as its second argument. The
default is `results/<UTC date>/<mode>.jsonl`; existing files are never appended
across separate invocations. The summarizer requires the directory containing
that run's JSONL files. For example:

```sh
npm run bench -- matrix results/rerun/matrix.jsonl
node summarize.mjs results/rerun
```

All functions are internal. A direct CLI call uses the ignored env file:

```sh
npx convex run orbBench:bench '{"pairs":20,"keypoints":500,"runs":100}' --env-file .env.spike.local
npx convex run orbBench:benchRead '{"n":20,"keypoints":500,"runs":100,"permute":true}' --env-file .env.spike.local
```

The runner requires matching `dev:` deployment, cloud URL, and deploy-key prefix.
It stops on a failed measurement; the memory mode stops at the first memory
error. Its first matrix call checks ten pairs and stops on an out-of-memory error.

## Measurement contract

- The default V8 runtime is used throughout; there is no `"use node"` directive.
  Timings wrap synchronous `verifyOrb` or action-side `ctx.runQuery` using
  `performance.now()`. Client HTTP elapsed time is recorded separately as
  `rpcMs`; it includes fixture generation, warmups, summaries, and transport.
- Matrix: 300 and 500 features **on each side**, 1/10/20 independent pairs
  verified sequentially, five warmup rounds, then 100 timed rounds in one action
  per configuration. Every pair has a different seed, but each round reuses that
  action's fixtures. Generation is excluded from timed intervals.
- The fixture adds 30% random query features, shuffles, then the harness copies
  the first N rows into exactly sized buffers. About 77% of retained query
  features correspond to the reference, with 6% bit-flip probability, 0.7 px
  noise, and the fixture's default homography. One pair has two separate feature
  sets; holding 20 pairs uses more buffer memory than one shared query plus 20
  references. This is a synthetic workload, not an artwork accuracy evaluation.
- Controls: unrelated random reference descriptors; and descriptor matches with
  random query geometry, stressing the default 1,000-iteration RANSAC cap. Ten
  rounds after one warmup per configuration. These are stress observations, not
  a production distribution. The summarizer requires all positives to verify
  and all negative controls to fail verification.
- Fresh: 100 separate 20×500 action invocations, no in-action warmups, distinct
  seeds per invocation. This checks the repeated-action workload without
  claiming a cold start or a new isolate for each request.
- Reads: production descriptor fields, byte buffers, and `by_objectId` index;
  a minimal `objects` table supplies real IDs. Setup runs outside the timer and
  upserts by ordinal so reruns do not duplicate rows. One query does 20 indexed
  lookups in parallel and returns every full row. Each action records its first
  read separately and then 100 measured reads. `matrix` repeats the same query
  arguments (cache eligible); `reads-permuted` uses a seeded permutation for
  every call to avoid the same query cache key. Database pages may still be hot.
  Decode/validation runs after the read timer and checks all counts and bytes.
- Memory: retain both feature sets for every pair, verify all pairs sequentially,
  then checksum every buffer so it stays live during verification. Raw buffer
  bytes are a lower bound, not peak heap telemetry. Probe 10/20/40 pairs, then
  increase through 80/160/320/640/1024/1536/2048 until failure. No failure at 40
  establishes headroom for this workload, not the exact runtime memory limit.
- WASM: built only after the 10×500 inconsistent-geometry control exceeded
  300 ms. AssemblyScript 0.28.20 compiles `wasm/hamming.ts` with SIMD disabled
  into the committed `convex/hamming.wasm` and readable `wasm/hamming.wat`.
  Rebuild with `npm run build:wasm` (also run by `npm test`). The scalar matcher
  has no imports or allocations and uses two fixed 64 KiB memory pages.
  It implements 2-NN, ratio and distance tests, with cross-check disabled,
  matching the verifier's defaults. JavaScript sorts the output stably.
  The wrapper copies both descriptors and returns fresh match objects on every
  call; these costs are included in the WASM timing. Instantiation is timed
  separately, once per action. Each pair alternates JS/WASM execution order
  across rounds, checks exact match equality outside timers, and times the
  unchanged JS RANSAC separately. Five warmups precede 100 measured rounds.
  Match plus RANSAC timings exclude the verifier's final quad checks and are
  not measurements of a fully integrated WASM `verifyOrb`.
- Percentiles use linear interpolation at `(n - 1) × p`. `summarize.mjs`
  recomputes and checks action summaries against raw samples, validates controls
  and read completeness, and writes `summary.json`. Unit tests establish
  measurement correctness; only the cloud runs establish latency.

## Cleanup

Save measurements and `npx convex deployment usage --json` output first. Delete
only the disposable project in Convex Dashboard → Project settings → Delete
project, verify it is absent from the team project list, and record the result.
Remove `.env.spike.local` and any generated `.env.local` afterward. The one-day
expiration is a backup, not the cleanup procedure. The recorded run's cleanup
evidence is in `results/2026-09-09/cleanup.json`.

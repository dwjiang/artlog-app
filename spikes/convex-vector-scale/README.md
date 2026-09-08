# Convex vector scale spike (00.02)

This is a disposable backend, separate from the Expo app and its deployment.
The [decision record](../../docs/decisions/002-vector-search-scale.md) records the
measured scope, limitations, and architecture recommendation. Checked-in JSONL
under `results/` contains raw samples; unit tests only check correctness.

Recompute search summaries, including the strict concurrent-insert window:

```sh
uv run python summarize.py results/2026-09-08
```

## Setup

From this directory, install the pinned tooling:

```sh
npm ci
uv sync --frozen
npm test
npm run typecheck
```

Create a new project on the intended team and a **dev** deployment. Use a Pro
team for the 100k/300k/1M sequence. Existing Starter access is sufficient for the
30k fallback, but its S16 performance cannot establish Pro S256 performance.
Review current [pricing](https://www.convex.dev/pricing) and team usage first.

```sh
npx convex project create artlog-spike-vectors --team YOUR_TEAM
npx convex deployment create YOUR_TEAM:artlog-spike-vectors:scale-spike --type dev --region us --expiration 'in 1 day'
```

Copy `.env.example` to `.env.spike.local` and fill in the deployment name and URLs
printed by the CLI. Generate the temporary deploy key into that ignored file:

```sh
npx convex deployment token create vector-scale-spike --deployment YOUR_TEAM:artlog-spike-vectors:scale-spike --save-env .env.spike.local
npx convex dev --once --env-file .env.spike.local
uv run --env-file .env.spike.local npx convex codegen
```

These commands load `.env.spike.local` as dotenv data and keep its variables
scoped to the invoked process. The CLI writes an unquoted deploy key containing
`|`, so sourcing the file as a shell script would interpret the key as a
pipeline. The scripts check that
`CONVEX_DEPLOYMENT` is `dev:` and matches `CONVEX_URL`. All backend functions are
internal; the Python client uses `set_admin_auth(CONVEX_DEPLOY_KEY)`.

## Full Pro run

Use a new output directory for each independent run. `--target` is a cumulative
row count for that version; rerunning a seed resumes its server checkpoint.
Only one writer may append a given version. Do not manually change vector rows
or checkpoints. A deleted version cannot be seeded again in the same deployment.

```sh
uv run --env-file .env.spike.local python seed.py --target 5000 --batch-size 1000 --output results/pro/insert-1000.jsonl
uv run --env-file .env.spike.local python seed.py --target 10000 --batch-size 500 --output results/pro/insert-500.jsonl
uv run --env-file .env.spike.local python seed.py --target 100000 --output results/pro/insert-100k.jsonl
uv run --env-file .env.spike.local python bench.py --rows 100000 --output results/pro/search-100k.jsonl
uv run --env-file .env.spike.local python seed.py --target 300000 --output results/pro/insert-300k.jsonl
uv run --env-file .env.spike.local python bench.py --rows 300000 --output results/pro/search-300k.jsonl
uv run --env-file .env.spike.local python seed.py --target 1000000 --output results/pro/insert-1m.jsonl
uv run --env-file .env.spike.local python bench.py --rows 1000000 --output results/pro/search-1m.jsonl
uv run --env-file .env.spike.local python bench.py --rows 1000000 --migration --output results/pro/migration.jsonl
```

Record the dashboard's database and search storage after **each** stable size,
including 2M before deletion. Capture its observation time and whether accounting
has caught up; the CLI's `convex deployment usage --json` reports metered usage,
not instantaneous storage. An absent/delayed sample is unmeasured, not zero.
The migration runner starts the doubled measurement immediately after insertion,
then deletes v2; capture storage concurrently or run those phases manually via
the functions in `benchmark.py` when dashboard accounting needs time.

For the 30k fallback, use the same `uv run --env-file .env.spike.local python`
prefix: seed v1 to 15,000, run `bench.py --rows 15000 --migration`,
then append v1 to 30,000 and run `bench.py --rows 30000`. This measures a smaller
15k→30k migration without exceeding the fallback row count. Do not run 100k
on Free: its raw float payload alone is 1.229 GB.

## Measurement contract

- 1536-dimensional float64 unit vectors, seed `20260908`. Every 100th row is a
  noisy second view of the preceding object: exactly 1% alternate-view rows.
  Generation depends on the row ordinal, so changing batch boundaries does not
  change the dataset. v2 repeats the same objects and vectors to isolate the
  effects of version filters and storage doubling; it is not a real model export.
- Four interleaved configurations: v1 equality / v1 OR v2, each at limit 32/256.
  Each configuration gets 5 warmups and 200 measured calls. Half the measured
  queries are independent random vectors; half target known multi-view objects.
  `searchMs` wraps **only** `ctx.vectorSearch`; `rpcMs` includes HTTP transport
  and document hydration. Percentiles use NumPy's default linear interpolation.
- Migration JSONL has timestamps for both searches and insert commits. Restrict
  analysis to their overlapping interval when reporting “during insert”; do not
  label an entire mixed-phase percentile as concurrent performance. Separate
  doubled and after-delete files preserve their own 200 calls/configuration.
- Read-after-delete checks search the removed version directly. Hydration runs
  in a separate query and can race deletion; missing documents are counted
  independently from filter violations. Synthetic nearest-neighbor checks are
  not a real-artwork recall benchmark.
- The vectors table uses exactly the planned fields and indexes. A tiny
  `progress` table holds one atomic counter/checkpoint per version so stats and
  resumes do not scan gigabytes of floats. It adds one indexed checkpoint read
  and write per insert transaction; measured throughput includes that overhead.
- `deleteVersion` scans bounded pages of the planned object-first index. It
  cannot seek by model version alone. Both scanned and deleted rows are logged;
  deletion cost therefore scales with the entire table. Writes to the deleted
  version are blocked after deletion starts.
- Python uses Convex 0.7.0's bundled **HTTP** client. In the observed run,
  WebSocket seeding stalled and a separate small query eventually completed; HTTP
  was used consistently for the recorded measurements. Oversized HTTP requests
  are logged and halved; unrelated errors stop the run. Restarts are safe after
  an ambiguous insert response because the server checks the next row ordinal.

Recommended batch size is **250** for these 1536-dimensional JSON payloads.
Both 1,000 and 500 were rejected by the HTTP request-body limit in the observed
run. This limit is distinct from Convex's 16 MiB transaction-write limit.

## Cleanup

After saving the results and usage evidence, delete this **disposable project**
in Dashboard → Project settings → Delete project. This also removes its
deployment and credential. Verify it is absent from the team project list and
record that in the decision. The one-day expiration is a backup, not a substitute
for cleanup. Remove the local credential file after cleanup; never commit it.

# Artlog data pipeline

Local Python jobs for venue seeding, corpus builds, Convex imports, enrichment,
and calibrator training. For existing data, start with the
[corpus inventory](../../docs/operations/corpus.md); deployment state lives in the
[production reference](../../docs/operations/production.md).

## Setup

Requires `uv` and Python 3.12 or newer. From the repository root:

```sh
cd scripts/data
uv sync --locked
export SCRATCH_DIR="$PWD/scratch"   # or an absolute path to an existing corpus
```

Run the commands below from `scripts/data/` unless stated otherwise. Each job
lists its options with `uv run python -m pipeline.<job> --help`. Prefix long
runs with `caffeinate -i` to prevent idle sleep on macOS.

Settings read the process environment, then the root `.env.local`. See
[`.env.example`](../../.env.example) for placeholders; keep credentials out of git.

| Variable                        | Purpose / default                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `CONVEX_URL`                    | Target deployment URL; match the app's `EXPO_PUBLIC_CONVEX_URL`                    |
| `CONVEX_DEPLOY_KEY`             | Admin deploy key for that same deployment                                          |
| `SCRATCH_DIR`                   | Downloads, metadata, features, and checkpoints; defaults to `scripts/data/scratch` |
| `DEVICE`                        | Torch device; defaults to MPS, then CUDA, then CPU, depending on availability      |
| `CRAWLER_CONTACT`, `USER_AGENT` | Optional crawler contact or full User-Agent override                               |
| `LOG_LEVEL`                     | Defaults to `INFO`                                                                 |

Before live jobs, confirm the target and deploy this workspace's backend functions.
Worktrees share the dev deployment and can replace one another's function set.
For the configured **dev** deployment, run from the repository root:

```sh
npx convex dev --once
```

## Venue seed and bundled database

Seed venues before building metadata or importing objects:

```sh
caffeinate -i uv run python -m pipeline.seed_venues --all --out out/
sqlite3 out/venues.db 'PRAGMA integrity_check; SELECT count(*) FROM venues;'
cp out/venues.db ../../assets/venues.db
```

Commit `assets/venues.db` after a successful full run. Its IDs must come from the
same deployment the app uses. The export records the deployment's latest venue
change; every 30 days phones fetch the venues added or edited after it, so
re-export only for the next app build.

For a smaller seed, replace `--all` with `--countries US,GB,FR`. Country-filtered
runs still export every museum already in the deployment; use them for local
checks, not to replace the bundled full census. Repeat a command to resume;
use `--refresh` once for a fresh census, then omit it when resuming.

To fill `city`, `cityKey` and `country` on the venues already in the deployment
without a census, replace `--all` with `--cities-only`. It resolves each museum's
city from its Wikidata administrative areas, falling back to its location and the
towns its street address names, then exports as above, so it is also the quick way
to re-export after a venue-column change.

## Build the corpus

### 1. Corpus metadata

```sh
uv run python -m pipeline.sources.fetch --met --aic --aic-live
caffeinate -i uv run python -m pipeline.sources.fetch --wikidata
caffeinate -i uv run python -m pipeline.build_metadata --sources met,aic,wikidata
```

Source snapshots go under `$SCRATCH_DIR/dumps/`. Normalized metadata goes under
`$SCRATCH_DIR/metadata/`; `stats.json` marks completion. This stage makes no
Convex writes and downloads no image bodies. It reads seeded venue keys from
Convex unless `--venues /path/to/keys.json` supplies a saved JSON array.

Repeat commands to resume. Use a new scratch directory for a fresh snapshot,
and keep one writer per directory. After Met access recovers, use
`build_metadata --retry-met-denied` to retry cached denials and unchecked rows.
AIC defaults to a complete live metadata snapshot; its blocked images are omitted.

### 2. Index build

First create `scripts/model/out/fakequant_state.pt` using the
[model export guide](../model/README.md), or pass `--fakequant /path/to/file.pt`.

```sh
caffeinate -i uv run python -m pipeline.build_index --stage download,drift,embed
```

For a pilot, add `--limit 1000`. Use a separate scratch directory and rebuild
metadata before switching from a pilot to a full build. Resume requires the
same image inputs, limit, shard size, and model weights.

Every embedding run checks model drift against the iPhone reference, then
processes one image shard at a time and deletes its images after embedding.
Features, metadata, and checkpoints remain. Repeat the command after an
interruption; `build_index --stage cleanup` removes leftover images.

### 3. Dedupe

```sh
caffeinate -i uv run python -m pipeline.build_index --stage dedupe
```

This validates metadata against the feature build and writes
`$SCRATCH_DIR/merged/`, retaining source aliases, embedding views, and one ORB
reference per indexed survivor. Keep this snapshot unchanged during import.
[Hub scoring is deferred](../../docs/todos/hub-scoring/README.md); imports need
no penalty files and set corpus penalties to zero.

### Small corpus for development and previews

Imports default to 1,000 surviving objects sampled across sources. Export a
portable package to a new directory and inspect its import plan:

```sh
uv run python -m pipeline.push --in "$SCRATCH_DIR/merged" --export "$SCRATCH_DIR/small-corpus"
uv run python -m pipeline.push --in "$SCRATCH_DIR/small-corpus" --dry-run
```

Both commands are offline and need no credentials. For a different size, pass
the same `--limit N` to export, dry-run, and upload. The package retains aliases, metadata,
placements, and features; `selection.json` lists counts and required museum keys.

Configure credentials for the intended deployment and seed its required museums,
then upload with a deployment-specific checkpoint:

```sh
uv run python -m pipeline.push --in "$SCRATCH_DIR/small-corpus" --checkpoint "$SCRATCH_DIR/push-dev.json"
```

Repeat the same command to resume. Changed inputs or a different deployment
require a separate checkpoint. Imports upsert: existing rows remain, and
different selections accumulate. Reports are written beside the checkpoint.

Unchanged metadata, vector payloads, descriptor references, and zero penalties
are not rewritten. Vector overlap checks read small identity rows. Each import
verifies a deterministic 2% sample per source and stage, including actual vector
and ORB bytes, and audits thumbnails for sampled objects. This is a sample, not
proof that every stored row matches. The report records its fraction, timestamp,
checked counts, and mismatches. A completed checkpoint reuses its successful
verification; use a new checkpoint to verify the same inputs again.

Use `--verify-fraction 1` for an explicit full readback, or another fraction in
`(0, 1]`. A failed readback is not cached. Counts must still match the full
baseline plus input overlap calculation.

The vector schema now separates `vectors` identities from `embeddings` and
`tentativeEmbeddings` payloads. Deploy to a fresh database, or reset and reseed
the pre-release deployment before using it; old inline-vector rows are incompatible.
Start a new import checkpoint after a reset.

Full imports use `push --in "$SCRATCH_DIR/merged" --full` and require every shard
from a full build; pilots and exported subsets are refused. The
[full production upload](../../docs/todos/production-upload/README.md) remains deferred.

## Exhibition checklists

Use the [JSON example](../../shared/sources/fixtures/checklist-example.json) for
permissioned checklists. `owner` identifies the lending museum; the host venue
is separate. Dates are inclusive local dates at the host venue.

```sh
uv run python -m pipeline.ingest_checklist ../../shared/sources/fixtures/checklist-example.json --dry-run
uv run python -m pipeline.ingest_checklist /path/to/checklist.json
```

The dry run validates locally without credentials or writes. CSV is also
supported; see `ingest_checklist --help` for required exhibition arguments.
Imports report unresolved rows for correction and retry. Repeated placements
are reused; a later batch failure leaves earlier batches committed.

## Enrichment

Set `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `FACT_SHEET_MODEL`, and `DOCENT_MODEL`
alongside the Convex credentials. Use the same model settings as the backend;
see [`.env.example`](../../.env.example).

```sh
uv run python -m pipeline.enrich.run --artwork met:436535 --dry-run
uv run python -m pipeline.enrich.run --budget 200 --batch 20
```

**Enrichment dry runs spend provider usage and record it in Convex**, while
leaving artwork content and claims untouched. `--budget` limits attempted
artworks, including failures. Daily provider caps still apply. Review JSON Lines
on stdout and the summary on stderr before another run.

## Calibrator training

Requires an imported, stable index, Convex credentials, and the model export
used for embedding. The default sample requires at least 5,000 eligible
public-domain corpus objects with images, vectors, and descriptors.

```sh
uv run python -m pipeline.calibrator.sample --fakequant /path/to/fakequant_state.pt
uv run python -m pipeline.calibrator.train
```

Use the index build's accepted dtype (`--dtype float16` or `--dtype float32`).
Outputs default to `out/`; keep the training manifest, feature rows, model JSON,
metrics, and report together. Training does not install weights. See the
[output contract](../../shared/calibrator/README.md) and
[evaluation findings](../../docs/experiments/README.md#calibrator-v2).

## Verification

From `scripts/data/`:

```sh
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

For changes to Convex ingest or the shared ORB format, also run from the repo root:

```sh
npm run test:convex
npm run test:app -- --runInBand shared/orb/python-fixture.test.ts
```

Implementation and co-located tests live in `pipeline/`. Fixture attribution is
in [fixtures/README.md](fixtures/README.md). Keep generated data in gitignored
`scratch/`, `out/`, and `checkpoints/` directories or outside the repository.

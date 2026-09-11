# artlog jobs

Python batch jobs that build and maintain the index and write it to Convex
through `convex/ingest.ts` (plan 02.01). Every job runs locally with

```sh
cd jobs
uv sync                                   # once; creates .venv with Python ≥ 3.12
uv run python -m artlog_jobs.<job> [args]
caffeinate -i uv run python -m artlog_jobs.<job> [args]   # long runs: no idle sleep
```

The same package runs unchanged inside the Nebius containers of plan 02.10;
only environment variables differ.

## Environment

Settings load from the process environment first, then from the repo root
`.env.local` (`artlog_jobs/config.py`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `CONVEX_URL` | Deployment URL the jobs write to (same value as `EXPO_PUBLIC_CONVEX_URL`) | required for Convex calls |
| `CONVEX_DEPLOY_KEY` | Deploy key for that deployment; `npx convex deployment token create artlog-jobs-local --deployment dev --save-env` writes it into `.env.local` | required for Convex calls |
| `SCRATCH_DIR` | Working directory for downloads, features and `checkpoints/<job>.json`; resolved to an absolute path | `jobs/scratch` |
| `DEVICE` | Torch device override (`mps`, `cuda`, `cpu`) | `mps` if available, else `cuda`, else `cpu` |
| `CRAWLER_CONTACT` | Contact appended to the fetcher User-Agent as `mailto:` | unset (no mailto) |
| `USER_AGENT` | Full User-Agent override | `artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app[; mailto:…])` |
| `LOG_LEVEL` | Python logging level | `INFO` |

Never commit `.env.local`; `.env.example` documents the names with placeholders.

`SCRATCH_DIR` is a local directory on the operator's Mac (gitignored). A build
processes images shard by shard and deletes each shard's images as soon as
they are embedded, so nothing under scratch outlives its shard except
features, metadata and checkpoints.

## Shared modules

| Module | Contract |
| --- | --- |
| `config.py` | `Settings` (above), `get_settings()`, `setup_logging()` |
| `model_version.py` | `MODEL_VERSION`, `EMBEDDING_DIM`, `INPUT_SIZE`, `ORB_MAX_KEYPOINTS` from `../shared/model-version.json` |
| `letterbox.py` | `letterbox(img, size)`: RGB, bilinear resize so the long side equals `size`, centered on a `size×size` canvas filled with the resized image's per-channel mean (half-up rounded). The phone's Swift version (plan 03.02) must match it |
| `orb.py` | `extract_orb(gray, nfeatures)` → `OrbFeatures(descriptors, keypoints, count)` in plan 04.01's wire format; `extract_from_image(img)` letterboxes first; `python -m artlog_jobs.orb <image> <fixture.json>` writes `shared/fixtures/orb-features-v1.json` |
| `convex_writer.py` | `ConvexWriter(settings)`: `upsert(fn, rows, batch_size≤500, on_batch)` splits (descriptor batches capped at 200 rows), retries transient errors (never `ConvexError`), merges returned `ids`; `query`, `mutation` |
| `checkpoint.py` | `Checkpoint.for_job(settings, job)`: per-stage `done` key sets and cursors, written atomically after every change |
| `polite_http.py` | `PoliteClient(user_agent, per_host_rps)`: per-host spacing and robots checks on each page redirect, robots.txt cache (daily refresh; 5xx, 401/403/429 or HTML ⇒ disallow all; 404 ⇒ allow), `Crawl-delay`, `Retry-After`, ETag / Last-Modified conditional GETs |
| `smoke.py` | Prints interpreter, device, an fp16 matmul shape, scratch path and Convex `ingest:counts` |

Python ints are sent to Convex as float64 by the client, which is what every
`v.number()` field expects; use `convex.ConvexInt64` only for `v.int64()`.

HTTP response bodies use a least-recently-used cache capped at 16 MiB and 128
entries. Set `cache_max_bytes=0` for one-pass image downloads; bodies larger
than the budget are never cached. Cached compressed responses replay their
decoded bytes with matching headers.

A server `Retry-After` longer than `max_retry_after` (default 120 seconds)
raises `RetryLater`, exposing `host` and the remaining `retry_after` seconds
so the job can defer that work. The client remembers the full host cooldown,
including on the final retry attempt; other hosts remain available. Shorter
delays are waited out before another request to that host.

## Verification

```sh
cd jobs && uv run pytest -q
cd jobs && uv run ruff check . && uv run ruff format --check .
npm run test:convex                                          # convex/ingest.test.ts
npm run test:app -- --runInBand shared/orb/python-fixture.test.ts
npx convex dev --once                                        # push ingest functions
```

All worktrees push to the one dev deployment, and a push replaces the whole
function set. Run `npx convex dev --once` right before any live check
(`smoke`, `npx convex run ingest:counts`) because another worktree may have
pushed in between.

### Smoke run, 2026-09-09 (Apple M5 Pro, macOS 26.5)

```
$ uv run python -m artlog_jobs.smoke
python=3.13.15
device=mps
torch=2.14.0
matmul_shape=(64, 64)
scratch_dir=/Users/dwjiang/conductor/workspaces/artlog-app/san-jose/jobs/scratch
user_agent=artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app)
model_version=c-radiov3-b-int8-512-dinov2-v1
counts={"artworks": 0, "descriptors": 0, "museums": 0, "objects": 0, "placements": 0, "vectors": 0}
```

`DEVICE=cpu uv run python -m artlog_jobs.smoke` prints `device=cpu` with the
same counts and also exits 0.

## Layout

- `artlog_jobs/` — the package; tests co-located as `*_test.py`
- `../shared/source-scores.json` — Tavily domain scores from spike 00.05, shared with `convex/lib/sourceScores.ts`
- `fixtures/` — test inputs (attribution in `fixtures/README.md`)
- `scratch/`, `out/`, `checkpoints/` — gitignored run outputs

## Venue seed and bundled database (02.02)

```sh
# From the repo root, push this workspace's functions to the configured dev deployment:
npx convex dev --once
cd jobs
uv run python -m artlog_jobs.seed_venues --countries IS --out out/
uv run python -m artlog_jobs.seed_venues --countries US,GB,FR --out out/
caffeinate -i uv run python -m artlog_jobs.seed_venues --all --out out/ --publish
sqlite3 out/venues.db 'SELECT count(*) FROM venues; SELECT * FROM meta;'
cp out/venues.db ../assets/venues.db
cd ..
npx convex data venueTables
npx convex run venueTable:latest '{}'
npx expo export --platform ios --output-dir /tmp/artlog-export
git add assets/venues.db
```

Re-commit `assets/venues.db` after a successful **full** run, and remove the
temporary export directory after checking its database asset. Country-filtered
runs upsert only those countries, but export **all museums already in Convex**;
their database is suitable for local smoke checks, not the bundled full census.
`--publish` uploads the exact exported bytes to Convex storage, then records the
same version and row count as SQLite's `meta` row. `venueTable.latest` is public;
upload and publication require the jobs' admin deploy key. No EAS command is used.
The SQLite IDs belong to the exporting deployment: bundle an asset from the same
deployment the app connects to.

Wikidata requests are sequential POSTs with the configured User-Agent, JSON
responses, a 65-second client timeout for the service's 60-second deadline, and
three attempts for transport failures, 429, and 5xx (honoring `Retry-After`).
Country slices include museum (`Q33506`) and art gallery (`Q1007870`) subclasses
with **both `P625` and `P856` claims**, matching decision 005's query. Wikidata
unknown-value nodes are not coordinates or URLs: unknown coordinates are excluded;
an unknown website is represented as a missing optional website. At the 20,000-row
cap or after a country timeout, direct `P131` administrative slices plus a slice
for missing or unknown `P131` replace that country result. A still-failing administrative
slice is reported, other countries continue, and export/publication is refused.

`config/countries.json` was resolved from Wikidata `P297` on 2026-09-09 using:

```sparql
SELECT DISTINCT ?country ?iso WHERE {
  ?country wdt:P297 ?iso . FILTER(REGEX(?iso, "^[A-Z]{2}$"))
} ORDER BY ?iso ?country
```

It retains all Q-IDs per code (including historical codes/territories) so `P17`
claims are not lost. `--all` also queries venues with no mapped country and
assigns `country:unknown`. It enumerates museum/gallery IDs in the constant class
slices measured in spike 00.05, subtracts the country census locally, then fetches
metadata for the remaining IDs. Global country anti-joins timed out in the live
run. Rows are deduplicated by Q-ID, keeping the first
website/coordinates; multiple country claims use the first selected ISO code
in sorted order. Labels prefer English, then any available label, then Q-ID.

`shared/regions.json` is the sole region config, copied from the Tavily spike
with its proposed centers. The metro administrative IDs were verified against
Wikidata: San Francisco `Q62`, New York City `Q60`, London `Q84`, Paris `Q90`.
The importer resolves `P131` ancestry to those IDs. Within the venue's country,
an administrative match takes precedence; otherwise the nearest metro within
60 km wins, with region key breaking distance ties. Other venues receive
`country:<ISO>`; a missing country domain list does not imply global coverage.

Downloaded country rows and completed writes live in
`SCRATCH_DIR/venue-seed/<deployment-and-config-hash>/`. Repeat the same command
to resume; interrupted upserts replay idempotently from the cached country.
Changing the country selection resets completed writes and replays cached rows,
so a full run restores its country assignments after a country-only run.
For a quarterly census, add `--refresh` **once** to discard the selected
countries' caches/checkpoints, then omit it if resuming. Keep one seed process
per scratch directory. Natural keys preserve the Convex IDs used by the phone.

A full run must stay within 5% of the spike's 42,444 venues before export.
Over 150,000 venues stops the job. SQLite is vacuumed; if it exceeds 10,000,000
bytes, the export clears `website` to NULL (retaining the schema) and vacuums
again. A still-oversized asset stops without replacing the previous database.
The console reports row count, version, bytes, and whether websites were omitted.

Metro recognizes `.db` and the root layout imports `src/lib/venue-asset.ts` so
the file is actually included in iOS exports. Plan 03.05 can pass its
`bundledVenueAsset` to `SQLiteProvider`'s `assetSource.assetId` and implement
resolution/background refresh. This seed does not open SQLite on the phone.

```sh
cd jobs
uv run pytest -q artlog_jobs/wikidata_test.py artlog_jobs/regions_test.py artlog_jobs/seed_venues_test.py
uv run ruff check .
uv run ruff format --check .
cd ..
npx vitest run convex/venueTable
```

### Initial full build — 2026-09-09

- Deployment: dev `usable-owl-256`; all 260 country/unmapped slices completed.
- SQLite and Convex `museums`: **42,452 venues**, eight more than decision 005
  (0.019% difference); **8,568,832 bytes**, with known websites retained.
- Version: **1788955449**. SHA-256:
  `a8288169b38c4d337e38c2c771547a135c75051d6451aeb5b5c2eaa366da5299`.
- Independent global ID census: 41,194 museums, 1,515 galleries, 256 shared IDs,
  42,453 distinct IDs. `Q141374919` has an unknown `P625` value and is excluded.
  `Q7459214` has an unknown `P856` value, represented as a missing optional website.
- `PRAGMA integrity_check` returned `ok`; the public download, committed asset,
  and iOS export contain identical database bytes. iPhone 17 Pro launch verified
  in light mode. The 98 Python, 149 Convex, and 22 app tests, TypeScript, ESLint,
  and Ruff checks passed.

## Index build (02.04)

The initial index is built on the operator's Mac (Apple M5 Pro, 64 GB, PyTorch on
`mps`); compute cost is $0 where design §10 budgeted L40S hours. From `jobs/`:

```sh
uv run python -m artlog_jobs.drift_check                      # gate: iPhone reference vs the job model
uv run python -m artlog_jobs.embed --benchmark 256            # images/s on the configured device
caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed --limit 1000   # pilot
caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed                # whole build
uv run python -m artlog_jobs.build_index --stage cleanup      # remove any leftover images/
uv run python -m artlog_jobs.download --shard 0 --limit 50    # one shard by hand
uv run python -m artlog_jobs.embed --images scratch/images/shard-0
```

`build_index` runs the drift check before every invocation that includes `embed`
(even when `drift` is omitted from `--stage`), then every shard in order: download
shard *n* → embed shard *n* → delete `images/shard-<n>/`. At most one shard of
JPEGs exists at a time and none outlives the build (design §5.5). Images are
never copied out of scratch and no job other than `download.py`/`embed.py`
reads them. `--keep-images` is refused without `--limit`. A run is resumable at
shard granularity through `checkpoints/build_index.json`; interrupt it and
repeat the same command. If an image directory disappears before its shard was
embedded, the missing files are downloaded again. Embedding requires a completed
download receipt and exactly the planned images minus recorded terminal failures;
an interrupted or partially deleted shard cannot be accepted by `--stage embed`.
Cleanup also resumes for completed
shards whose images remain after an interruption. Ctrl-C stops workers after
their current image fetch returns. Resume requires the same `--limit`,
`--shard-size`, and downloadable object keys and image URLs. A SHA-256
fingerprint of those inputs is checked before any completed shard is reused;
reordering metadata or changing unrelated fields does not invalidate it.
`build_index` refuses mismatched or missing fingerprints, including checkpoints
from builds that predate fingerprinting. Completed features also require the same
`fakequantSha256` before drift checking or embedding can resume; changing the
weights file's path is allowed when its bytes are identical. Download receipts
record each shard's key/URL fingerprint before fetching begins. Both standalone
downloads and embedding validate it before reusing JPEGs or terminal failures.
Cached downloads without a matching receipt require fresh image and download-state
directories. For a new build,
move `features/`, `images/`, `downloads/` and
`checkpoints/build_index.json` aside (for example to `pilot-<date>/`) between a
pilot and the whole build.

Under `SCRATCH_DIR` (default `jobs/scratch`, gitignored):

| Path | Content |
| --- | --- |
| `metadata/objects.jsonl` | 02.03 output; only objects with an `imageRef` are downloadable |
| `images/shard-<n>/<quoted key>.jpg` | transient, ≤ 1024 px long side, JPEG q90, never the original |
| `downloads/shard-<n>.json`, `shard-<n>-failed.jsonl` | per-shard, per-source progress; dead links with a reason (02.05 skips them) |
| `features/vectors-<n>.npy` | float32 `[N, 1536]`, L2-normalized, one row per embedded image |
| `features/keys-<n>.json` | object keys in row order |
| `features/descriptors-<n>.bin` + `.json` | per image: `count×32` descriptor bytes then `count×4` float32 keypoints (plan 04.01 wire format); the index lists `{key, offset, keypointCount}`; `embed.read_features()` reads a shard |
| `features/manifest.json` | `limit`, `shardSize`, `downloadInputsSha256`, `modelVersion`, `inputSize`, `embeddingDim`, `orbMaxKeypoints`, `device`, `dtype`, `fakequantSha256`, `driftCheck`, per-shard reports, `counts`, timestamps |
| `features/drift-check.json` | the last drift result |
| `calibration/` | the 200 calibration images, hash-checked against `jobs/calibration/image-hashes.json` |

Objects are ordered by the SHA-256 of their key and cut into shards of 10,000,
so shards are deterministic for a given `objects.jsonl`, every shard mixes the
sources, and `--limit N` is a representative sample. Sources download
concurrently, each with its own polite client: Met CDN 8 req/s (documented
ceiling 20), AIC 1 req/s with `AIC-User-Agent` (no AIC object currently carries
an image reference, decision 005), and Wikimedia media within the Wikitech robot
policy's media rules: at most two concurrent connections and at most 25 Mbps
measured over 10-second windows (`BandwidthLimiter`, shared by both streams),
standard thumbnail sizes only. Each raw HTTP response read reserves up to
64 KiB before receiving bytes; reservations remain charged until the read
finishes, and received bytes remain charged for the next 10 seconds. Redirect
and retry bodies share the same budget. The budget must fit at least one
64 KiB read per window. Cooldowns are recorded when headers arrive and checked
again whenever a waiting worker wakes. Commons files are resolved through the
`imageinfo` API in batches of ≤ 50 titles (one call at a time, `iiurlwidth=960`,
a pre-rendered standard step that still exceeds the 512 px model input) and
fetched from the returned `thumburl` on `upload.wikimedia.org`. Files no wider
than 960 px would come back as originals, so they are queried again at the
largest standard step below their width (500, 330, 250, …): the media host
throttles originals far harder than thumbnails (27 of 27 429s across three
runs hit originals, none a thumbnail path), so the build never fetches an
original. `Special:FilePath?width=` was measured at 0.42 images/s because it is a two-hop
redirect chain on the Commons app servers, and `imageinfo` also renders
TIFF/PDF originals server-side. Files the API reports missing are recorded as
`commons_missing`. `--streams wikidata=1` and `--mbps` dial the media rules
down; the defaults are the policy's ceiling, with Wikimedia media requests
capped at 4 req/s across both streams. Override rates with
`--rate met=4,wikidata=3`. Transient statuses retry three times with backoff
and honor `Retry-After`; 20 consecutive 403/429 responses stop that source with
`SourceBlocked` (halve the rate and report). Temporary failures, including
403/429s and exhausted transport/server retries, remain pending instead of
entering the terminal failure journal. They leave the shard incomplete and
stop the build before embedding; repeat the command after recovery. These are
the sources' designated media endpoints, requested on the same footing as
`sources/fetch.py`'s dumps, so the client does not consult robots.txt.

### Model, numerics and drift

`model.py` loads RADIO at the pinned revision (`c0f3701…`, checkpoint SHA-256
verified) and overlays `spikes/coreml-export/artifacts/fakequant_state.pt`, the
state recovered from the CoreML int8 export (decision 001), then runs on
`settings.device` in fp16, the phone's compute dtype. The artifact is not
committed; reproduce it with the spike's `export.py --size 512 --precision fp16`
then `--weights int8` (README in `spikes/coreml-export/`). Reproduced
2026-09-10: package weight hash
`f6f6d2d8c75ed755718114cdbff2dcbf262527b5974c2eefa2916d8533c7b6a7`, identical to
the committed iPhone report, and `fakequant_state.pt` SHA-256
`15e4b7200da8ae3fcece41645646186aeb56ae7ebebe96c26ebf1561675cfaf5` (recorded in
the manifest of every build). RADIO needs `einops`, now a job dependency.

`drift_check.py` downloads the 200 calibration paintings (`jobs/calibration/`,
copied from the spike) and letterboxes them exactly as the iPhone reference
was produced (bicubic, black pad), so the comparison isolates the Mac build path
from the phone's Neural Engine on identical pixels; the index letterbox
(`letterbox.py`, mean pad) is the capture contract that plan 03.02 mirrors. It
exits non-zero below `--min-mean 0.99 --min-min 0.97`; `build_index` aborts on
failure. When fp16 is non-finite or misses the thresholds, fp32 with the same
weights is tried and the passing dtype is recorded and used for the embed stage.

| Run (2026-09-10) | Device / dtype | Mean cosine | Min cosine | Images |
| --- | --- | ---: | ---: | ---: |
| Job model vs iPhone 16 Pro int8 CPU + NE reference | `mps` / float16 | **0.99702** | **0.99295** | 200 |

The spike measured 0.997011 / 0.992918 for the same pair; fp32 was not needed.

`embed --benchmark` (forward pass only, letterboxed fixture pixels, `mps` fp16):
56.5 images/s at batch 64, 64.4 images/s at batch 128 (the default).

### Pilot 2026-09-10 (`--limit 1000`)

Inputs were rebuilt first: the 02.03 scratch output no longer existed, so the
Met/AIC/Wikidata fetch and `build_metadata` ran again (409,973 objects; Met
image metadata complete, 8 not found, 0 denied) with venue keys exported from
`assets/venues.db`. `caffeinate -i /usr/bin/time -l … build_index --stage
download,drift,embed --limit 1000` then took **955 s** wall clock, peak resident
set **1.92 GB**, and left no `images/` directory.

| Source | Objects in pilot | Downloadable in corpus | Achieved | Failed | Projected download |
| --- | ---: | ---: | ---: | ---: | ---: |
| met | 10 | 5,565 | 2.92 req/s (bandwidth-bound originals; 7.6 req/s on warm CDN edges) | 0 | 0.5 h |
| wikidata (Commons) | 990 | 396,582 | 1.10 images/s (one media request at a time) | 0 | 100 h |
| aic | 0 | 0 (images blocked, decision 005) | — | — | — |

Drift check (rerun inside the pilot): mean 0.99702 / min 0.99295, `mps`/float16.
Embed: 1,000 images → 1,000 vectors, keypoint count median 500, min 75, none
zero; the forward passes took 15 s (≈ 67 images/s). The pilot's reported
44.8 s included a 30 s DataLoader teardown stall (spawned workers returning
tensors) that was fixed afterwards; a 50-image shard now ends within a second
of its last batch. The manifest records `modelVersion
c-radiov3-b-int8-512-dinov2-v1`, `fakequantSha256 15e4b720…`, the drift result
and the shard report.

**Projection for the full corpus at the pilot's one-stream rate** (sources
download concurrently, so Commons sets the wall clock): ≈ 100 h of downloads
plus ≈ 2 h of embedding, about **4.3 days** of continuous, awake, online laptop
time, under the plan's ~5-day STOP line but not by much. That run was started
and then cancelled at shard 0 on 2026-09-10 as infeasible; the fetcher was then
brought up to the media rules' actual ceiling (two streams, 25 Mbps, 960 px
thumbnails) instead of one request per second, which decision 005 had taken
from the rules for other Wikimedia services (correction recorded there).

**Two-stream run, started 2026-09-10 02:47 PDT:** Commons sustains
**4.5 images/s** (first 500 files, 0 failed, ≈ 8 Mbps), so the corpus projects
to ≈ 25 h of downloads plus ≈ 2 h of embedding, about **27 h** wall clock.
Every thumbnail request is a CDN miss for these long-tail files: about half
are served from storage in ≈ 0.3 s and half are rendered on demand in ≈ 1 s,
at 960 px and 1280 px alike, so with the policy's two connections latency, not
bandwidth, sets the rate. It logs to `scratch/logs/full-run-2.log`; the
cancelled one-stream attempt's state is under `scratch/cancelled-2026-09-10/`. Any 429/403 streak
stops a source (`SourceBlocked`) and the run resumes from its checkpoint. The
operator decides between this local run, a reduced corpus (for example only
paintings with a current placement or a mapped owner), or pulling plan 02.10
forward; Commons' one-request-at-a-time policy applies wherever the job runs,
so cloud hardware does not shorten the download.

**Throttle finding and the running build (2026-09-10 04:43–04:50 PDT):** the
two-stream run drew HTTP 429 (`Retry-After: 11`) from `upload.wikimedia.org`
within minutes and fell to ≈ 3.2 images/s; capped at `--rate wikidata=3.0` it
still drew 12 in five minutes and fell to 2.0 images/s. Every one of the 27
429s across those runs was on an original-file URL (files no wider than
960 px, about a third of requests); thumbnail paths drew none at up to
4.5 req/s. The resolver now requests a narrower standard step for those files
so no original is fetched, and the build was restarted with `--rate
wikidata=4.0` (now the default): ≈ 3 images/s with no 429s in its first
minutes (`scratch/logs/full-run-3.log`, `full-run-4.log`). Projection: ≈ 37 h
of downloads plus embedding between shards, about **1.6 days**; interrupting
and repeating the command resumes.

The whole build was started on 2026-09-10 after the pilot, with the pilot's
outputs moved to `scratch/pilot-2026-09-10/`. It logs to
`scratch/logs/full-run.log`; interrupt it and repeat the command to resume:

```sh
cd jobs
caffeinate -i uv run python -m artlog_jobs.build_index --stage download,drift,embed
uv run python -m artlog_jobs.build_index --stage cleanup
```

Features for 410k objects need ≈ 10 GB under `scratch/features/` (6 KB vector +
≤ 16 KB descriptors + ≤ 8 KB keypoints each); a shard of images is ≤ 3 GB and
is deleted once embedded.

## Corpus metadata (02.03)

From `jobs/`, using the configured `SCRATCH_DIR` (default `jobs/scratch`):

```sh
uv run python -m artlog_jobs.sources.fetch --met --aic --aic-live
caffeinate -i uv run python -m artlog_jobs.sources.fetch --wikidata
caffeinate -i uv run python -m artlog_jobs.build_metadata --sources met,aic,wikidata
uv run python -m artlog_jobs.build_metadata --fixtures fixtures --out scratch/metadata-fixtures
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

The fetcher writes `dumps/met/`, `dumps/aic/`, and `dumps/wikidata/` inside
scratch. `build_metadata` writes `metadata/artworks.jsonl`, `objects.jsonl`,
`placements.jsonl`, and `stats.json`. Optional fields are omitted, matching
`convex/ingest.ts`. The job makes no Convex writes and downloads no image bodies.
`stats.json` is the completion marker; a directory without it is unfinished.
The counts, source coverage, rights and multiplicity distributions, unmapped
owners, and the venue-key snapshot hash are recorded there.

The Met revision is pinned before downloading. Dumps use byte-range downloads,
`If-Range`, atomic receipts, SHA-256 hashes, and resumable `.part` files. AIC
archive members are read directly, never extracted to archive-supplied paths.
Repeat commands against the same scratch directory to resume. Use a new scratch
and output directory for a fresh corpus snapshot; keep one writer per directory.
The Met's CSV `Object Number` maps to `ObjectRecord.accession`; `Object ID`
provides `sourceId` and `met:<id>`. Painting classification **contains**
`Paintings`, including compound classifications rather than only exact matches.
Only public-domain CSV rows request the per-object API, at one request/second.
A live false public-domain flag revokes image references from the older CSV.
403/404 responses are recorded separately from a successful response with no
image. A 403 gets at most two retries after 15- and 30-second cooldowns, extended
by `Retry-After`. Three denials or a cooldown exceeding 120 seconds stop further
requests; `dumps/met/image-access.json` persists that stop. A server-specified
cooldown remains in force across restarts. The report distinguishes forbidden,
not-found, unchecked, requested, and recovered records.

After access is restored, explicitly recover cached denials and unchecked rows:

```sh
caffeinate -i uv run python -m artlog_jobs.build_metadata --retry-met-denied
```

Successful responses and cached 404s are preserved. A plain rerun honors the
persisted stop and reuses cached denials; it does not silently retry them.

Wikidata enumerates direct `P31 = Q3305213` items with `P18`, groups them by the
200 largest collections plus a remainder, and requests metadata in batches of
500 IDs. Timed-out or truncated responses are subdivided by creator-death decade;
a still-failing slice is reported and the remaining slices continue. Incomplete
checkpoints preserve fetched records; reruns request only missing IDs, including
during decade recovery. Each successful slice is an atomic `paintings-*.json`
checkpoint. The final manifest
lists exactly the files belonging to that census, missing IDs, and failures.
Unknown-value image claims are excluded rather than turned into image URLs.
Multiple collection/location/accession claims remain unset when a single value
cannot be established. `P195` accession qualifiers stay attached to their
collection; a unique direct `P217` is used when no collection qualifier applies.
Institutional feed confidence is 0.9, Wikidata location 0.6, and collection-only
placement 0.5; Wikidata does not assert that a painting is currently on view.

Artwork merges use Wikidata IDs, preferring Wikidata metadata and retaining all
source objects. The most restrictive rights result wins; thumbnails are removed
on a downgrade. The policy and 70/100-year boundaries are specified in design
§5.5. Multiplicity uses normalized artist/title pairs across the Wikidata
snapshot. Series, versions, unknown artists (including Wikidata's anonymous
creator entity `Q4233718`), and incomplete coverage do not establish uniqueness.
Original CSV/JSON/archive responses remain in scratch as
rights, source-date, and licensing evidence.

### AIC snapshot and image access

The default `--aic-snapshot live` requires a complete API snapshot. Fetch it before
building. The official archive is still dated **2025-02-16**; the explicit
`--aic-snapshot dump` option can reproduce archived metadata and emits no current
placements.

```sh
uv run python -m artlog_jobs.sources.fetch --aic --aic-live
uv run python -m artlog_jobs.build_metadata --sources met,aic,wikidata --aic-snapshot live
```

The live refresh uses a single stream at one request/second and preserves response
license blocks. Each request sorts by ID and filters for IDs greater than the
last returned ID. Responses are checkpointed as `paintings-after-<id>.json`, and
the manifest names exactly the files in the snapshot. IDs must increase strictly,
and the remaining total must reconcile with the initial census. A stalled,
changing, or incomplete census cannot be selected as a live snapshot. Resuming
reuses successful responses; use a fresh `dumps/aic/live/` directory to refresh
them. API data can change during the run; it is not a transactional snapshot.

The earlier page-11 HTTP 403 was a JSON `Invalid number of results` error, not
the image host's Cloudflare block. Advancing by ID fetched all **3,912 paintings**
in 40 requests on 2026-09-09. The old offset-based pages are excluded.

An identified GET to the documented 843-pixel IIIF URL still returned Cloudflare
403 HTML on 2026-09-09. AIC normalized records therefore omit both `imageRef` and
`thumbnailUrl`; raw metadata preserves `image_id`. The adapter supports 1686 or
843 when access is established, but the build currently admits neither.

### Venue keys

Normally the job pages `ingest:exportVenues` once and caches the key set under
`metadata-venues/<deployment-hash>.json`. Both institutional keys must exist.
The initial build used the bundled key snapshot after an empty dev export.
A full recheck of dev `usable-owl-256` returned **42,452 venues** across 43 pages:
every natural key and Convex document ID matches `assets/venues.db`, including
the Met and AIC. The cause of the earlier empty export remains unknown. Recovery
uses the normal live export/cache path, with no reseeding or asset replacement.

Before 02.05 pushes objects, its target deployment must contain the corresponding
museum rows. `--venues` takes an explicit JSON array of previously exported keys;
it does not create museums or synthesize missing owners.

### Full metadata snapshot, 2026-09-09

The recovered full build produced **404,606 artworks, 409,926 objects,
and 296,329 placements** under `jobs/scratch/metadata/`. The initial output is
retained under `jobs/scratch/metadata-initial/` for comparison.

| Source | Normalized objects | Image references | Placements |
| --- | ---: | ---: | ---: |
| met | 9,727 | 5,565 | 9,727 |
| aic | 3,664 | 0 | 3,664 |
| wikidata | 396,535 | 396,535 | 282,938 |

The Met CSV contains 484,956 records; 9,727 classifications contain
`Paintings` (9,005 are exact matches). Its 612,687 physical lines include
newlines inside quoted fields, so the census uses `csv.DictReader`, not
`wc -l`. AIC's complete live census has 3,912 paintings, of which 3,664 have
`image_id`; 768 normalized objects are currently on view. Wikidata returned all
396,545 census items in 883 files with zero failed slices; ten unknown-value
`P18` claims were excluded. Compared with decision 005, the Met's painting
count differs by 8.02% because of the contains filter; AIC's image-bearing
count differs by 0.03%, and the Wikidata census by 0.02%.

Met recovery took approximately 91 minutes at one request/second. It made
5,414 API calls, resolved all 1,251 cached denials, and completed all 5,577
eligible records: **5,565 image URLs, eight HTTP 404s, four live public-domain
revocations, zero remaining denials, and zero unchecked records**. The four
revoked source objects remain metadata with `unknown` rights and no image URLs;
conservative merging also removes affected Wikidata thumbnails. API image
metadata is complete; image-body download/decoding remains part of 02.04.

The recovery command's request counts are in
`scratch/metadata-met-recovery/stats.json`. The combined rebuild reuses these
responses, so its own Met request/recovery counters are zero. AIC image access
remains blocked: an identified 843-pixel GET again returned Cloudflare 403 at
20:22:35 UTC. AIC's metadata and current placements are included; its images
and thumbnails remain excluded.

Final artwork rights: **341,453 public domain; 4,488 in copyright;
58,665 unknown**. Multiplicity: **285,906 unique; 26,482 multiple;
92,218 unknown**. There are 87,973 unmapped collection claims across 4,854
collection IDs. All 42,452 venue keys came through the live dev export/cache
path and match the committed asset.

The review-fix rebuild used cached sources and corrected three anonymous works
from `unique` to `unknown`; object and placement files are byte-identical.

Verification: **197 Python tests (99 new across 02.03)**, TypeScript, ESLint,
Ruff lint and formatting pass. The independent full-output audit verified
unique keys, all artwork/object/placement/venue references, current AIC
placements against the live records, the thumbnail rights gate, and raw rights
evidence for every public-domain output object (5,573 Met, 1,875 AIC,
338,960 Wikidata). It checked **344,525 final thumbnail references**;
per-source thumbnail counts precede conservative merge downgrades.
No app behavior changed, so no iOS run was required for this Python-only feature.
No Convex schema/function signatures changed, so no codegen or deployment ran.

| Output | Bytes | SHA-256 |
| --- | ---: | --- |
| `artworks.jsonl` | 102,370,077 | `4d9a1af2f1009f873622f273d451dc2f81254540f988259b026acc6215ed0c17` |
| `objects.jsonl` | 215,681,989 | `af68dbbea92d201b07ac3bfe3d4e1eb1d122306a568d4b562210cccab6674063` |
| `placements.jsonl` | 37,476,994 | `ee9dfa1e7e6685f25d31f06165e61217ab43584d5166de4c93c2ec191623b191` |
| `stats.json` | 77,829 | `7224115ce70a9eddf5e8b10c42dc7bce3ce88295b8704939c8e19b3ba86f5c85` |

Venue key-set SHA-256: `861b0149809145ac74a00be7a901df74045a671e78f29e843fa452522ac58087`.

## Dedupe, hubs and Convex import (02.05)

After the feature build, run from `jobs/`:

```sh
caffeinate -i uv run python -m artlog_jobs.build_index --stage dedupe,hubs,push
# Or run each stage, using explicit paths:
uv run python -m artlog_jobs.dedupe --features "$SCRATCH_DIR/features" --metadata "$SCRATCH_DIR/metadata" --out "$SCRATCH_DIR/merged"
uv run python -m artlog_jobs.hubs --features "$SCRATCH_DIR/merged" --out "$SCRATCH_DIR/merged/penalties.jsonl"
uv run python -m artlog_jobs.push --in "$SCRATCH_DIR/merged" --limit 1000
uv run python -m artlog_jobs.push --in "$SCRATCH_DIR/merged"
```

For these shell commands, set `SCRATCH_DIR` explicitly (for example,
`export SCRATCH_DIR="$PWD/scratch"`); Python also defaults to `jobs/scratch`.
The smoke limit selects 1,000 surviving objects and includes their other views
and merged source records. It can run on completed shards of an unfinished
build. A full push requires every expected shard in the feature manifest and
refuses a limited pilot. Objects with no features still retain their metadata.

`dedupe` reads the actual 02.04 shard format (`keys-N.json`, float32
`vectors-N.npy`, `descriptors-N.json` with `key/offset/keypointCount`, and the
packed descriptor/keypoint bytes). It validates dimensions, normalization,
model version, the passing drift check and binary bounds. It also checks that
the feature manifest's download fingerprint matches the current metadata,
refusing stale or unverified features before writing merged output. It copies completed
feature shards into `merged/`, retaining their original keys, and writes
`vector-index.jsonl` to map each original view to its survivor. Accession
matching uses NFKC, case folding and collapsed whitespace, preserving punctuation
and accession component boundaries. Embedding matching needs cosine ≥ 0.95,
a known matching artist, and the same nonempty owner. It cannot join groups
with overlapping sources or conflicting nonempty accessions, including conflicts
through aliases. Unknown or unidentified creator labels do not establish an artist
match. Museum records win over Wikidata, with key order breaking ties. Every
merged object points directly to its final survivor in `merges.jsonl`.
Artwork rights are reconciled across every connected merge group using the most
restrictive result; all linked objects lose thumbnails on a downgrade. Public-domain
survivors retain an admitted alias thumbnail when their own record has none.
Placements are re-keyed and deduplicated by object/venue/source, preferring
the survivor's record. Each survivor receives one descriptor set from its
highest-priority available view; all embedding views are retained.

`hubs` samples up to 20,000 vectors with seed `20260908`. The sample centroid
computes exactly the same mean cosines as the full pairwise matrix using
bounded memory. Vectors above mean + 3σ are capped at the top 0.5%; their
objects receive penalty 0.5. Other objects receive 0, clearing a previous
build's hub flag without changing feedback's separate rejection penalty.
The histogram and threshold are in `penalties.summary.json`.

Import order is artworks → objects (survivors first) → placements → vectors
→ descriptors → penalties. Batch ceilings are 500 metadata/penalty rows,
**250 vectors** (decision 002's measured HTTP size), and **200 descriptor sets**
(the writer's existing ceiling for 1,000-keypoint records). The Python writer
uses the official client's HTTP transport, with its `requests` dependency
explicitly installed; transport failures retry, application errors do not.
A size rejection saves half the batch size and stops with an error. Review the
error, then resume with the same command to use the smaller size. A server
system-operation timeout halves the affected batch and replays it automatically;
unrelated application errors still stop the job.

Corpus vectors use the original object key as `viewKey`. Ingest replaces
`(modelVersion, source, viewKey)` and updates its object assignment, so two
corpus views survive a merge and a rebuild can move a view to a new survivor
without duplicating it. User-created vectors do not need a corpus view key.
`countExisting` resolves overlaps with dev data before the first write, and
`counts()` must match the saved baseline plus new rows. A paginated
`auditThumbnails` must return zero violations; both Python and the object
mutation reject a thumbnail URL unless its artwork is public domain.

`push.json` (`push-smoke.json` for a limit) records the deployment, input
fingerprint, expected counts, per-stage offset and elapsed mutation time after
every batch. Resume replays a batch whose response was lost safely. Input
files and penalties are checked against their SHA-256 hashes; changed input
or a different deployment requires a separate checkpoint (`--checkpoint`).
Keep the merged snapshot unchanged while a push runs. The final report is
beside the checkpoint as `push.report.json` or `push-smoke.report.json`.
Copy `merges.jsonl`, `manifest.json`, `stats.json` and the reports into
`jobs/out/<run>/` for the build audit trail. No image pixels enter this stage.

### Partial build verification, 2026-09-11

The committed 02.04 branch was integrated before implementation. Its `paris`
workspace has **24 of 41** feature shards, with **239,995 vectors**; the full
build is unfinished. A copied snapshot in this workspace's
`jobs/scratch/merged/` contains **404,653 artworks, 409,973 objects,
289,806 merged placements, 239,995 vectors and 232,291 descriptor sets**.
There are **13,550 merges** and 169,978 metadata objects without features in
this partial snapshot; the latter includes unprocessed objects and must not
be reported as failed downloads. Dedupe took 20.69 seconds initially and
50.13 seconds on a repeat while other workspaces were compiling iOS apps.
The deterministic hub pass found no outliers (mean 0.422502, σ 0.113360,
threshold 0.762582, maximum observed mean cosine 0.596512).

The full corpus import and its database/search storage measurements remain
pending the other 17 shards. Decision 002 did not establish a billed search
storage projection, so its >50% comparison cannot yet be evaluated. Raw
float payload estimates are not dashboard storage measurements.


### Cloud smoke import, 2026-09-11

The shared dev deployment was replaced by concurrent workspaces during the
first attempt, and then contained newer account-sync fields that this branch
cannot validate. No corpus rows were written by those attempts. Verification
therefore used isolated **dev `elegant-caiman-324`** in the same project,
reference `dev/plan-02-05-smoke`, created with a one-day expiry. Its credentials
are under `.context/02-05-smoke.env`; the app's `.env.local` still targets
`usable-owl-256`. No production deployment changed.

The real smoke selected **1,000 surviving objects** and retained their source
aliases and all available views. Final counts matched the preflight exactly:
**3 museums, 1,123 artworks, 2,103 objects, 1,877 placements, 1,688 vectors and
1,000 descriptor sets**. The paginated thumbnail audit checked all 2,103
objects and found **zero violations**. `convex data vectors --limit 1`
confirmed a 1536-float `corpus` vector with its original-object `viewKey`;
`health.ping` passed on both the isolated and shared dev deployments.

| Stage | Rows | Rows/batch | Acknowledged write seconds | Rows/s |
| --- | ---: | ---: | ---: | ---: |
| Artworks | 1,123 | 500 | 9.96 | 112.8 |
| Objects | 2,103 | 500 | 54.47 | 38.6 |
| Placements | 1,877 | 500 | 18.11 | 103.6 |
| Vectors | 1,688 | 250 | 31.72 | **53.2** |
| Descriptors | 1,000 | 200 | 18.09 | 55.3 |
| Penalties | 2,103 | 500 | 15.38 | 136.8 |

These rates include HTTP serialization/transport and successful mutation time;
they exclude input validation, preflight reads, the final audit and aborted
attempts. One 500-object mutation hit a system-operation timeout after the
first 500 rows. Resumption replayed the failed batch and completed without
count drift. The replay did not hit the limit again; a regression test also
proves automatic halving if it recurs. No vector write-size error occurred.
The resumed invocation took 174.93 seconds including local validation and
museum seeding; this is not the wall time of all attempts combined.

Final review also corrected museum identity registration for merged aliases:
accession/page lookups now resolve to the surviving artwork, even when the
alias retains a different source artwork record. The regression test covers
both the shared accession and the alias page. Refreshing the 1,103 aliases
kept all counts unchanged; a live audit of 3,218 museum identities went from
345 pointing outside the surviving artwork set to **zero**. Audit artifacts, manifests and
merge records are retained in `jobs/out/02-05-2026-09-11/` (gitignored).

Database and search **dashboard storage remain unmeasured**. This smoke
establishes batch correctness and Mac-to-Convex throughput, not the full-corpus
storage projection. The full-push command was exercised and correctly refused
the 24/41-shard snapshot before making any network write.


Final verification: **286 Python tests pass**, **792 backend tests pass
(3 skipped)** with `npm run test:convex -- --maxWorkers=1`, including 19 ingest
tests. Ruff lint/format, `npm run lint`, `npx tsc -p convex/tsconfig.json
--noEmit`, codegen and the isolated dev deployment pass. An earlier host-spacing
fixture failure and backend timeouts during concurrent iOS compilation cleared
on the final complete runs. Root `npx tsc --noEmit` still fails on the
pre-existing `src/components/scan/label/contribute-result.tsx:16` TS7053 error:
`device_reverted` and `object_reverted` have no message mapping. No app UI changed;
`npm run ios` was not run for this jobs/backend task.

The smoke counts above predate the merge review fixes. An offline audit of the
same 24-shard snapshot with the corrected rules produces **7,844 merges**
(7,839 accession, five embedding), downgrades rights on 342 artwork records,
and recovers 1,345 survivor thumbnails, with zero thumbnail-rights violations.
The three reported pairs of distinct paintings remain separate. All **321
Python tests**, Ruff, and ESLint pass; root TypeScript still reports the same
unrelated error above. These corrections have not been pushed to Convex.
Regenerating import files was refused because the current upstream metadata
does not match the saved feature fingerprint. Rebuild from matching metadata
and feature snapshots before the next import; do not reuse the earlier merged
output or treat its smoke counts as verification of the corrected corpus.

## Exhibition checklists (04.10)

Supply a permissioned checklist as JSON using
[`shared/fixtures/checklist-example.json`](../shared/fixtures/checklist-example.json)
or as CSV with the header `title,artist,owner,accession,wikidata`. `owner` is the
lender's museum key, distinct from the host venue. CSV rows with a Wikidata ID
use that identity plus any owner/accession evidence; other rows need title and
artist. Dates are inclusive local calendar dates at the host venue; the server
uses its coordinates to determine the time zone. The shared fixture is synthetic.

```sh
cd jobs
uv run python -m artlog_jobs.ingest_checklist ../shared/fixtures/checklist-example.json --dry-run
uv run python -m artlog_jobs.ingest_checklist /path/to/checklist.json
uv run python -m artlog_jobs.ingest_checklist /path/to/checklist.csv \
  --venue-key example:venue --title 'Exhibition title' \
  --from 2026-10-01 --to 2026-10-30 \
  --source-url https://example.org/checklist.pdf --gallery 'Gallery 2'
```

`--dry-run` validates and prints the payload without credentials or writes.
Imports validate the whole file before calling `checklists:ingestChecklist`
through `ConvexWriter`, in batches of at most 100 works. Output is JSON with a
`placed` count (distinct resolved objects per batch, including already placed
objects) and every unresolved input with its reason. Correct and retry the file;
identical placements are reused. A later batch failure leaves earlier batches
committed. Ambiguous physical objects and title/artist-only matches stay
unresolved. Overlap replacement affects only checklist placements of listed,
resolved objects at the host venue, preserving exhibition provenance and saved
collection snapshots.

During its active dates, a checklist takes precedence over an off-view feed at
the lender. On-view feeds and manual placements remain stronger evidence; the
home placement is preserved outside the checklist window.

Placement proposals require deliberate review from the dashboard or CLI:

```sh
# From the repository root, on the intended deployment:
npx convex run placements:listProposals '{"status":"pending"}'
npx convex run review:listProposalsReady '{}'
npx convex run placements:reviewPlacement '{"proposalId":"<id>","decision":"approve","reviewer":"<name>"}'
```

`listProposals` returns `{ rows, cursor }`; pass a non-null cursor to fetch the next
page. Status is `pending`, `promoted`, or `rejected`; decisions are `approve` or
`reject`. Approval needs two distinct devices whose server-recorded scans span
at least 24 hours, or three distinct devices. Each device contributes only its
earliest and latest scans; valid agreement stops accumulating once ready for
review. New submissions revalidate the retained evidence and replace invalid
scans while the proposal is pending, recomputing readiness from the surviving
timestamps. Approval revalidates those scans and their timestamps. Reject may be
used before readiness. Repeated decisions are idempotent, and subsequent scans do not reopen
reviewed proposals. Unique works move; multiple/unknown works gain a separate
physical object, scan vectors, and a copy of the matched object's reference
descriptors. Missing reference descriptors block new-object approval.

Device bans and venue opt-outs undo affected moves, preserving subsequent valid
moves, structured location updates, corpus objects, and saved collection snapshots.
Prior placements resume after a superseding temporary placement ends, within
their original end dates; an open-ended structured update remains in effect.
Opt-out cleanup finishes the move rollbacks before marking the request applied.
The original review decision remains recorded, with `revertedAt` marking a
revoked move.

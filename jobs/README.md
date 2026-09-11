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
npm run test:convex                                          # convex/ingest.test.ts, convex/lib/orb/pythonFixture.test.ts
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

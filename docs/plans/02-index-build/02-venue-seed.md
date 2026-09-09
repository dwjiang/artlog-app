# Plan 02.02: Seed the venue table from Wikidata and build the app's bundled venue asset

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/seed_venues.py jobs/config assets/venues.db convex/venueTable.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 02.01; `docs/decisions/005-data-sources.md` (counts), `docs/decisions/007-tavily.md` (regions)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Venue resolution runs on the phone against a bundled table of every museum and gallery Wikidata knows with coordinates and a website (design §4.2 "The venue table", §5.1). The same rows exist in Convex `museums` so the server can key visits, placements and the crawl queue by `venueId`. This job seeds both, assigns each venue a `region` for "Right now", and publishes a refreshable copy of the table for the app.

## Current state

- `jobs/` scaffold with `ConvexWriter`, `PoliteClient`, checkpoints (02.01). `convex/ingest.ts` has `upsertMuseums` (keyed `wikidata:Q…`) and `exportVenues`.
- Verified facts: SPARQL endpoint `https://query.wikidata.org/sparql`, 60 s deadline, ≤ 5 parallel per IP, User-Agent required; museums query `?m wdt:P31/wdt:P279* wd:Q33506; wdt:P625 ?coord . OPTIONAL { ?m wdt:P856 ?website } OPTIONAL { ?m wdt:P17 ?country } OPTIONAL { ?m wdt:P131 ?admin }`; deep `OFFSET` paging times out — slice by country (`wdt:P17`) instead. Spike 00.05 recorded the row count and estimated asset size. Spike 00.07 proposed `regions.json` (`{ "<regionKey>": { "name", "domains": [...] } }`).
- Expo: `expo-sqlite` `SQLiteProvider` supports `assetSource={{ assetId: require('@/assets/venues.db') }}` to ship a database; Metro needs `config.resolver.assetExts.push('db')`. Convex file storage: `generateUploadUrl()` mutation → HTTP POST → `storageId`; `storage.getUrl(id)` for download.
- Schema: `museums` fields from plan 01.03 plus `key`/`by_key` (added in 02.01).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Run locally | `cd jobs && uv run python -m artlog_jobs.seed_venues --countries US,GB,FR --out out/` | writes `out/venues.db` |
| Full run (local, resumable) | `cd jobs && caffeinate -i uv run python -m artlog_jobs.seed_venues --all --out out/` | completes; writes `out/venues.db` |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/seed_venues_test.py` | pass |
| Convex | `npx convex dev --once`, `npm run test:convex` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/seed_venues.py` (+ test), `jobs/artlog_jobs/wikidata.py` (SPARQL client with slicing, retries, UA) (+ test), `shared/regions.json` (from spike 00.07; shared with Convex, which reads it for "Right now"), `jobs/config/countries.json` (ISO → Wikidata Q-id list used for slicing), `convex/venueTable.ts` (+ test), `convex/schema.ts` (add `venueTables { version: number, storageId: id('_storage'), rowCount: number, createdAt }` with `by_version`), `assets/venues.db` (committed, ≤ 10 MB) , `metro.config.js` (create with `assetExts.push('db')`), `README` note in `jobs/README.md`.

**Out of scope**: the phone-side resolution (03.05); POI venues (04.05); crawl profiles (02.06).

## Steps

### Step 1: Wikidata client with slicing

`wikidata.py`: `sparql(query, *, user_agent) -> list[dict]` (POST, JSON, tenacity retries on 429/5xx with `Retry-After`, ≤ 2 concurrent); `iter_museums(country_qids) -> Iterator[VenueRow]` running one query per country with `VALUES ?country { wd:Q… }`, `LIMIT 20000`, and a second pass per admin region if a country hits the limit. `VenueRow = { qid, name (rdfs:label en, else any), lat, lng, website?, country_iso, admin_qid? }`; drop rows without coordinates; collapse duplicate websites per qid (keep the first).

**Verify**: unit test parses a saved SPARQL JSON fixture into rows; a live smoke for one small country (`--countries IS`) returns > 20 rows.

### Step 2: Region assignment

`regions.py`: `region_for(row, regions_config) -> str`: metro match by admin area Q-id or by distance ≤ 60 km from a metro center listed in `shared/regions.json` (`{ "sf-bay-area": { "name": "San Francisco Bay Area", "center": [37.77, -122.42], "domains": [...] } }`), else `country:<ISO>`. Copy spike 00.07's proposed list into `shared/regions.json` (Convex imports the same file in plan 04.09) and add `center` coordinates per metro.

**Verify**: tests: a Bay Area museum → `sf-bay-area`; a rural US museum → `country:US`.

### Step 3: Seed Convex and export the asset

`seed_venues.py`: iterate countries (all, or `--countries`), upsert rows via `upsertMuseums` in batches of 500 with `key = f"wikidata:{qid}"`, `seedSource: "wikidata"`, `region`, checkpointing per country; then page `exportVenues` and write `out/venues.db` (SQLite: `CREATE TABLE venues (id TEXT PRIMARY KEY, key TEXT, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, website TEXT, region TEXT NOT NULL)`, plus `meta (version INTEGER, generatedAt TEXT, rowCount INTEGER)`; `VACUUM`); print row count and file size.

**Verify**: local run with three countries produces a `.db`; `sqlite3 out/venues.db 'select count(*) from venues'` matches the console count.

### Step 4: Publish the table for background refresh

`convex/venueTable.ts`: `requestUpload` (internal mutation → `generateUploadUrl`), `publish` (internal mutation args `{ storageId, rowCount, version }` inserting into `venueTables`), `latest` (public query → `{ version, rowCount, url: storage.getUrl }`). `seed_venues.py --publish` uploads `out/venues.db` (HTTP POST to the upload URL, `Content-Type: application/octet-stream`), then calls `publish` with `version = int(time())`.

**Verify**: `npx vitest run convex/venueTable` → `latest` returns the newest version; a local `--publish` run creates a `venueTables` row (check with `npx convex data venueTables`).

### Step 5: Bundle the asset

Copy the full-run `venues.db` to `assets/venues.db`; add `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('db');
module.exports = config;
```

Document in `jobs/README.md` how to regenerate and re-commit the asset.

**Verify**: `ls -la assets/venues.db` ≤ 10 MB (if larger, drop `website` from the asset and note it — plan 03.05 only needs id/name/coords/region); `npx expo export --platform ios --output-dir /tmp/artlog-export` includes the `.db` asset (then delete the export dir).

## Test plan

- `wikidata_test.py` (fixture parse, slicing), `regions_test.py`, `seed_venues_test.py` (db writer with a fake writer), `convex/venueTable.test.ts`.

## Done criteria

- [x] Full run completed locally and `museums` count in Convex matches the record in `docs/decisions/005-data-sources.md` ± 5%
- [x] `assets/venues.db` committed and ≤ 10 MB; `metro.config.js` present
- [x] `venueTables` has a published full table; `latest` returns a downloadable URL
- [x] All tests, tsc, lint pass; `docs/plans/README.md` status row updated

Completed 2026-09-09: 42,452 venues, 8,568,832 bytes, version `1788955449`,
published to dev `usable-owl-256`. All 260 country/unmapped slices completed;
the global class-ID census found 42,453 IDs, with one unknown coordinate excluded.
The bundle and published download match byte-for-byte, and the iOS export includes
the database. Verified launch on iPhone 17 Pro in light mode. Tests: 98 Python,
149 Convex, 22 app; TypeScript, ESLint, and Ruff pass. Regeneration details and
the asset hash are in `jobs/README.md`.

## STOP conditions

- The full Wikidata row count exceeds 150k or the asset exceeds 10 MB even without `website` — report; the operator decides on regional shards.
- SPARQL keeps timing out for a large country even with admin-region slicing — report the country and continue with the rest.

## Maintenance notes

- Re-run quarterly; the app refreshes from `venueTables.latest` (plan 03.05) so a re-run does not need an app release.
- `shared/regions.json` is also read by `rightNow` (plan 04.09) through `museums.region`; keep keys stable.

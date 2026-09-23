# Venue city keys: fill them with a census and make republishing cheap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, tick the checklist in "Done criteria"
> and update the "Open work" line for this todo in `docs/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 48e6b73..HEAD -- scripts/data/pipeline/seed_venues.py scripts/data/pipeline/seed_venues_test.py scripts/data/README.md README.md assets/venues.db`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (about 40 lines of Python and tests; the census itself is hours of unattended wall-clock)
- **Risk**: MED (step 4 writes 42k `museums` rows and a new venue table to the shared dev deployment)
- **Depends on**: none
- **Category**: data + dx
- **Planned at**: commit `48e6b73`, 2026-09-17

## Why this matters

The journal groups visits by place using `cityKey` (a Wikidata city id such as `wikidata:Q62`).
Every `cityKey` in the system is null today: the column was added on 2026-09-14 (#73), but no
Wikidata census has run since, so neither the Convex `museums` table, the bundled
`assets/venues.db`, nor the table published to the dev deployment carries a value. Two visits
to different museums in the same city therefore never merge into one "San Francisco" row; the
journal falls back to per-venue keys.

Separately, the only documented way to republish the venue table is the full census
(`seed_venues --all --publish`), which takes hours and re-fetches Wikidata. On 2026-09-17 the
published table had to be replaced because it predated the `cityKey` column and every app
build since #73 rejected it once a day ("Venue table refresh failed … no such column:
cityKey"); that replacement was done with a throwaway script. An `--export-only` flag makes the
next schema change a one-minute republish instead.

## Current state

Files and their roles:

- `scripts/data/pipeline/seed_venues.py` — the census + export + publish job.
  - `seed_countries` (lines 40–121) fetches Wikidata per country, caches to
    `scratch/venue-seed/<scope>/countries/<ISO>.json`, and upserts rows (including
    `cityKey` when Wikidata provided one) through `ingest:upsertMuseums`.
  - `export_asset` (lines 124–200) reads `ingest:exportVenues` pages from Convex and writes a
    SQLite file whose `venues` table already has the `cityKey` column.
  - `publish_asset` (lines 203–221) uploads the file and calls `venueTable:publish`.
  - `main()` (lines 224–273) always runs the census before exporting:

    ```python
    # scripts/data/pipeline/seed_venues.py:224-274 (abridged)
    def main() -> None:
        parser = argparse.ArgumentParser(description="Seed Wikidata museums and galleries and export SQLite")
        selection = parser.add_mutually_exclusive_group(required=True)
        selection.add_argument("--countries", help="Comma-separated ISO codes, e.g. US,GB,FR")
        selection.add_argument("--all", action="store_true", help="All country slices, including unknown country")
        parser.add_argument("--out", type=Path, default=Path("out"))
        parser.add_argument("--publish", action="store_true", help="Upload and publish the exported asset")
        parser.add_argument("--refresh", action="store_true", help="Start a fresh Wikidata census; omit when resuming")
        args = parser.parse_args()
        settings = get_settings()
        setup_logging(settings)
        ...
        writer = ConvexWriter(settings)
        log.info("Seeding %s (%d country slices)", settings.convex_url, len(countries))
        total = seed_countries(writer, countries, regions, checkpoint, user_agent=settings.user_agent)
        if args.all and abs(total - BASELINE_VENUES) / BASELINE_VENUES > 0.05:
            raise RuntimeError(...)
        asset = export_asset(writer, args.out, version=int(time.time()))
        print(json.dumps({**asdict(asset), "path": str(asset.path), "seeded_venues": total}))
        if args.publish:
            print(json.dumps({"published_id": publish_asset(writer, asset), "version": asset.version}))
    ```

- `scripts/data/pipeline/wikidata.py:124–141` — derives `city_key` from the SPARQL `?city`
  binding (a `wdt:P131*` chain ending in a `wd:Q515` city) as `f"wikidata:{qid}"`. A fresh
  census is what fills the value; nothing else does.
- `convex/ingest.ts:166–168` — `upsertMuseums` validates `cityKey` against
  `/^wikidata:Q[1-9][0-9]*$/` and stores it.
- `src/lib/venue/venue-db.ts:24` — `VENUE_COLUMNS = 'id, key, name, lat, lng, website, region, city, cityKey, country'`;
  `validateVenueTable` runs `SELECT ${VENUE_COLUMNS} FROM venues LIMIT 0` on every downloaded
  table, so a table exported before a column was added is rejected.
- `src/lib/journal/history.ts:36–42` — the fallback this plan improves:

  ```ts
  export function placeIdentity(visit: JournalVisit): { key: string; name: string } {
    if (visit.cityKey) return { key: visit.cityKey, name: visit.city || visit.venueName };
    if (visit.city) return { key: `venue:${visit.venueId}`, name: visit.city };
    ...
  }
  ```

- `assets/venues.db` — bundled table, meta version `1788955449` (2026-09-09), 42,452 rows,
  `cityKey` column present but every value null.
- Dev deployment `usable-owl-256`: `venueTable:latest` returns version `1789666942`
  (published 2026-09-17, 42,454 rows, `cityKey` column present, all null). `museums` rows have
  no `cityKey` either (checked via the first `ingest:exportVenues` page).

Conventions to match:

- Python: `ruff` with line length 100, imports sorted (`I`), tests are `*_test.py` beside the
  module, using `unittest.mock.Mock` and `monkeypatch`. Model the new `main()` test on
  `test_full_census_restores_country_assignment_after_partial_refresh` in
  `scripts/data/pipeline/seed_venues_test.py:98–157`, which monkeypatches `seed_venues.DATA_DIR`,
  `seed_venues.get_settings`, `seed_venues.ConvexWriter`, `seed_venues.seed_countries`, and
  `sys.argv`, then calls `seed_venues.main()`.
- Commit messages are conventional commits, e.g. `refactor(scripts): move data pipeline under scripts/data (#67)`.
- Pipeline settings come from the repo root `.env.local` (`CONVEX_URL`, `CONVEX_DEPLOY_KEY`,
  a Convex admin deploy key). Never paste their values anywhere.

## Commands you will need

Run Python commands from `scripts/data/`.

| Purpose                                  | Command                                                                                    | Expected on success                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Install pipeline env                     | `uv sync`                                                                                  | exit 0 (fast; the uv cache is warm on this Mac) |
| Pipeline tests                           | `uv run pytest -q pipeline/seed_venues_test.py`                                            | all pass                                        |
| Pipeline lint                            | `uv run ruff check .`                                                                      | `All checks passed!`                            |
| Full census + publish                    | `caffeinate -i uv run python -m pipeline.seed_venues --all --refresh --out out/ --publish` | two JSON lines; the second has `published_id`   |
| Export-only republish (after step 1)     | `uv run python -m pipeline.seed_venues --export-only --out out/ --publish`                 | same two JSON lines, no census log lines        |
| Published version (repo root)            | `npx convex run venueTable:latest`                                                         | JSON with `version`, `rowCount`, `url`          |
| App typecheck / lint / tests (repo root) | `npx tsc --noEmit`, `npm run lint`, `npx jest src/lib/venue src/lib/journal src/db`        | exit 0                                          |

Do not `source .env.local` before `npx convex …`: its unquoted deploy-key line exports a stray
variable that breaks the CLI. The CLI and the Python settings both read the file themselves.

## Scope

**In scope** (the only files you should modify):

- `scripts/data/pipeline/seed_venues.py`
- `scripts/data/pipeline/seed_venues_test.py`
- `scripts/data/README.md`
- `README.md` (only the two `seed_venues` runbook lines, 178 and 280)
- `assets/venues.db` (replaced by the census output in step 5)
- `docs/README.md` (status of this todo only)

**Out of scope** (do NOT touch, even though they look related):

- `src/lib/venue/venue-db.ts` and `src/lib/venue/refresh.ts` — the client's column contract and
  daily refresh are correct; the fix is data, not app code.
- `src/lib/journal/history.ts` — the fallback order is intentional and tested.
- `convex/ingest.ts`, `convex/venueTable.ts`, `convex/schema.ts` — no backend change, and a
  `npx convex dev` push would overwrite other worktrees' functions on the shared deployment.
- `scripts/data/pipeline/wikidata.py` — the SPARQL query is the census; do not tune it here.
- The production deployment (`admired-goldfinch-660`, see `docs/todos/release/README.md`).
  This plan targets the dev deployment only.

## Git workflow

- Work on a feature branch (Conductor names them); never commit to `main` directly.
- Two commits: `feat(scripts): add an export-only venue table republish` (steps 1–3) and
  `chore(data): refresh the bundled venue table with city keys` (step 5).
- Do NOT push or open a PR unless the operator asked for it.

## Steps

### Step 1: Add `--export-only` to `main()`

In `scripts/data/pipeline/seed_venues.py`:

1. Change the selection group to `required=False` and add
   `parser.add_argument("--export-only", action="store_true", help="Skip the census; export and publish the deployment's current venues")`.
2. After `args = parser.parse_args()`, validate:
   - `if args.export_only and args.refresh: parser.error("--export-only cannot be combined with --refresh")`
   - `if not args.export_only and not (args.all or args.countries): parser.error("choose --all, --countries, or --export-only")`
3. Keep `settings = get_settings()` and `setup_logging(settings)` where they are. When
   `args.export_only` is set: build `writer = ConvexWriter(settings)`, log
   `"Exporting %s without a census"`, set `total = None`, and skip the country config,
   checkpoint, `seed_countries`, and baseline check. The existing export/print/publish tail
   runs unchanged for both modes (the printed JSON then has `"seeded_venues": null` in
   export-only mode).

Target shape of the tail of `main()`:

```python
    writer = ConvexWriter(settings)
    if args.export_only:
        log.info("Exporting %s without a census", settings.convex_url)
        total = None
    else:
        ... # existing country/checkpoint/seed_countries/baseline code, unchanged
    asset = export_asset(writer, args.out, version=int(time.time()))
    print(json.dumps({**asdict(asset), "path": str(asset.path), "seeded_venues": total}))
    if args.publish:
        print(json.dumps({"published_id": publish_asset(writer, asset), "version": asset.version}))
```

**Verify**: `uv run python -m pipeline.seed_venues --help | grep -c "export-only"` → `1`;
`uv run pytest -q pipeline/seed_venues_test.py` → all existing tests still pass.

### Step 2: Test the new mode

Add two tests to `scripts/data/pipeline/seed_venues_test.py`, modelled on
`test_full_census_restores_country_assignment_after_partial_refresh`:

- `test_export_only_skips_the_census_and_publishes(tmp_path, monkeypatch)`:
  monkeypatch `seed_venues.get_settings` to a `Settings(_env_file=None, convex_url="https://test.convex.cloud", scratch_dir=tmp_path)`,
  `seed_venues.ConvexWriter` to return a `Mock()` whose `query.side_effect` returns
  `{"page": [{**EXPORT_ROW, "cityKey": "wikidata:Q62"}], "isDone": True}`,
  `seed_venues.seed_countries` to a `Mock()`, and `seed_venues.publish_asset` to a
  `Mock(return_value="published-id")`. Set `sys.argv` to
  `["seed_venues", "--export-only", "--out", str(tmp_path / "out"), "--publish"]`, call
  `seed_venues.main()`, then assert: `seed_countries` was not called, `publish_asset` was
  called once, and `sqlite3.connect(tmp_path / "out/venues.db")` returns
  `[("wikidata:Q62",)]` for `SELECT cityKey FROM venues`.
- `test_export_only_rejects_refresh(tmp_path, monkeypatch)`: same setup, argv
  `["seed_venues", "--export-only", "--refresh", "--out", str(tmp_path / "out")]`, and
  `with pytest.raises(SystemExit): seed_venues.main()`.

**Verify**: `uv run pytest -q pipeline/seed_venues_test.py` → all pass, 2 more tests than before;
`uv run ruff check .` → `All checks passed!`.

### Step 3: Document the republish path

- `scripts/data/README.md`, after the paragraph that starts "`--publish` uploads the exported
  database" (line 52), add:

  > After changing the exported columns (`VENUE_COLUMNS` in `src/lib/venue/venue-db.ts` or the
  > `CREATE TABLE` in `export_asset`), republish the deployment's current venues without a census:
  > `uv run python -m pipeline.seed_venues --export-only --out out/ --publish`. Apps reject any
  > published table whose columns do not match, so do this the same day as the schema change.

- `README.md:178` — extend the trailing comment to
  `# or --all for the full 42k-venue census; --export-only republishes without one`.

**Verify**: `grep -c "export-only" scripts/data/README.md README.md` → `scripts/data/README.md:1` and `README.md:1`.

### Step 4: Run the census against the dev deployment (operator step)

Preconditions, checked from the repo root:

- `grep -c "^CONVEX_URL=https://usable-owl-256.convex.cloud" .env.local` → `1` (the dev
  deployment; STOP if it names any other deployment).
- `grep -c "^CONVEX_DEPLOY_KEY=" .env.local` → `1` (do not print the value).

Then, from `scripts/data/` (expect hours; Wikidata SPARQL is rate limited and the script
retries):

```sh
caffeinate -i uv run python -m pipeline.seed_venues --all --refresh --out out/ --publish
```

If it stops with `incomplete countries: …`, rerun the same command **without** `--refresh`; it
resumes from the checkpoint and the cached countries.

**Verify** (from `scripts/data/`):

- The first printed JSON line has `seeded_venues` between 40,300 and 44,600 (the script itself
  aborts outside ±5% of 42,444) and `"websites_omitted": false`.
- `sqlite3 out/venues.db "PRAGMA integrity_check; SELECT count(*), sum(cityKey IS NOT NULL) FROM venues"`
  → `ok`, then two numbers where the second is at least 20,000. STOP if it is `0`.
- From the repo root, `npx convex run venueTable:latest` → `version` equals the `version` in
  the second printed JSON line.

### Step 5: Replace the bundled asset

From `scripts/data/`: `cp out/venues.db ../../assets/venues.db`.

**Verify** (repo root):

- `sqlite3 assets/venues.db "SELECT version, rowCount FROM meta"` → the census version and row count.
- `ls -l assets/venues.db` → size below 10,000,000 bytes.
- `npx tsc --noEmit`, `npm run lint`, `npx jest src/lib/venue src/lib/journal src/db` → all exit 0.

Commit `assets/venues.db` as `chore(data): refresh the bundled venue table with city keys`.

### Step 6 (optional, manual): see the grouping change

On a signed-in simulator or device with at least two journal visits at different museums in
the same city, open the journal's place view: the two visits appear under one row named after
the city instead of two rows named after the venues. A fresh install picks the bundled table up
immediately; an existing install installs the published table on the launch after its next
daily check.

## Test plan

- New: the two tests in step 2 (export-only happy path with `cityKey` round-tripping into the
  SQLite file; `--export-only --refresh` rejected).
- Existing: all of `seed_venues_test.py` stays green; the `main()` census path is still covered
  by `test_full_census_restores_country_assignment_after_partial_refresh`.
- App side: no code change, so the existing `src/lib/venue/*.test.ts` and
  `src/lib/journal/history.test.ts` are the gate that the new asset still validates and groups.

## Done criteria

ALL must hold:

- [ ] `cd scripts/data && uv run python -m pipeline.seed_venues --help | grep -c export-only` → `1`
- [ ] `cd scripts/data && uv run pytest -q pipeline/seed_venues_test.py` → exit 0 with the two new tests
- [ ] `cd scripts/data && uv run ruff check .` → exit 0
- [ ] `grep -c export-only scripts/data/README.md README.md` → `1` in each file
- [ ] `sqlite3 assets/venues.db "SELECT version FROM meta"` → greater than `1789666942`
- [ ] `sqlite3 assets/venues.db "SELECT sum(cityKey IS NOT NULL) FROM venues"` → at least `20000`
- [ ] `npx convex run venueTable:latest` → `version` equals the bundled meta version
- [ ] `npx tsc --noEmit`, `npm run lint`, `npx jest src/lib/venue src/lib/journal src/db` → exit 0
- [ ] `git status --short` lists only files in the in-scope list
- [ ] This todo's line in `docs/README.md` "Open work" marked done or removed

## STOP conditions

Stop and report back (do not improvise) if:

- `main()` in `seed_venues.py` no longer matches the excerpt above (someone restructured the job).
- `.env.local` targets a deployment other than `usable-owl-256`, or the operator has not
  confirmed that writing 42k `museums` upserts to the shared dev deployment is acceptable today.
- The census finishes with `sum(cityKey IS NOT NULL)` equal to `0`: the SPARQL `?city` binding
  is not returning; this needs a query investigation, not a retry.
- The script raises the ±5% baseline error or `STOP: venue asset exceeds 10 MB`.
- `websites_omitted` is `true` in the export JSON (the bundled asset would lose websites).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any edit to `VENUE_COLUMNS` (`src/lib/venue/venue-db.ts`) or to the `CREATE TABLE` in
  `export_asset` invalidates every previously published table; republish with `--export-only`
  the same day. The client has no memory of a rejected version, so a stale table costs each
  device an 8.6 MB download and a warning per day until it is replaced.
- `--refresh` clears the seed checkpoint and the per-country caches under
  `scripts/data/scratch/venue-seed/<scope>/`; resuming without it reuses them, which is why an
  interrupted census is rerun without the flag.
- `cityKey` is only as complete as Wikidata's `P131*` chain to a city item; museums without one
  keep falling back to `city`, region, then country in `placeIdentity`.
- Reviewer focus: the `--export-only` branch must never reach `seed_countries`, and the printed
  JSON shape stays the same for both modes so the runbook's `sqlite3` checks still apply.
- Deferred: recording a schema tag in `venueTables` so `venueTable:latest` can filter on it.
  Republishing is cheap once this lands, so the extra backend surface is not justified yet.

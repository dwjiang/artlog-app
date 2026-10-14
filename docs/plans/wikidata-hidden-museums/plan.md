# Plan: Every Wikidata museum and gallery missing from prod is stored as a hidden venue

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, set **Status** below to DONE with the
> inserted count, or BLOCKED with a one-line reason.
>
> **Drift check (run first, from a checkout of `main`)**:
> `git diff --stat 45dfc4a7..HEAD -- convex/ingest.ts convex/museumAudit.ts convex/venueChanges.ts convex/schema.ts scripts/data/pipeline/regions.py shared/sources/regions.json shared/journal/countries.json shared/journal/limits.ts scripts/data/config/countries.json src/lib/venue/venue-db.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status**: TODO
- **Priority**: P3 (deferred by the user on 2026-10-13; run only when asked)
- **Effort**: M (~1.5 h wall clock, mostly unattended: ~30 min Wikidata fetch, ~40 min upload)
- **Risk**: MED — writes ~27,000 rows to the production database, and no deployed function deletes museums
- **Depends on**: none
- **Category**: direction (data backfill)
- **Planned at**: commit `45dfc4a7` (`origin/main`), 2026-10-13

## Why this matters

Prod's `museums` table holds 46,455 venues; 19,785 are hidden (`excludedFromDiscovery: true`) and 26,670 are visible
(readback 2026-10-13 ~03:11 UTC). The original seed only took Wikidata museums that have a website. On 2026-10-13
Wikidata listed 71,085 museum/gallery items with coordinates, and **26,932 of them are not in prod**. The user wants
them all stored **hidden**, so their identities are kept and no future crawl has to rediscover them. Hidden rows also
do work on the phone: `filterExcludedPlaces` drops Apple Maps places whose name matches a hidden venue within 100 m.
The user explicitly chose _not_ to classify these rows: every new row is hidden, including ~3,000 that Wikidata types
as art museums or galleries. Those are listed in `likely-art.json` for a possible later review.

## Current state

Production deployment: `admired-goldfinch-660` (prod). Dev is `usable-owl-256` and is **out of scope**.

- `convex/schema.ts:343` — `museums` table: `key` (unique via `by_key`), `name`, `lat`, `lng`, optional `website`,
  `city`, `cityKey`, `country`, `wikidataId`, `excludedFromDiscovery`, `mergedInto`; required `region`, `seedSource`,
  `optOut`, `contributionRevision`.
- `convex/ingest.ts:182` — `ingest:upsertMuseums` (internal mutation). Args `{ rows: museumRow[], insertOnly?: boolean }`,
  max 500 rows (`MAX_BATCH_ROWS`, line 28). With `insertOnly: true`, existing keys are left untouched, and new keys
  are inserted with `optOut: false, contributionRevision: 0`, **visible**. Every insert is recorded through
  `recordVenueChanges` so phones fetch it:
  ```ts
  } else {
    ids[row.key] = await ctx.db.insert("museums", { ...fields, optOut: false, contributionRevision: 0 });
    changed.push(ids[row.key]);
  ```
  `museumRow` = `{ key, wikidataId?, name, lat, lng, website?, city?, cityKey?, country?, region, seedSource }`.
  `country` must be in `shared/journal/countries.json` (`isCountry`, `shared/journal/limits.ts:64`) or the mutation throws `invalid_venue`.
- `convex/museumAudit.ts:40` — `museumAudit:byKeys` `{ keys }` (max 100, `MAX_LOOKUP_KEYS` line 23) → docs or `null`, in order.
- `convex/museumAudit.ts:49` — `museumAudit:exportPage` `{ cursor? }` → `{ page, isDone, continueCursor }`, 500 per page.
- `convex/museumAudit.ts:123` — `museumAudit:applyBatch` (internal action) `{ records: [{ key, excludedFromDiscovery, duplicateOf? }] }`
  → `{ changed, unchanged, ids }`. It patches only `excludedFromDiscovery`/`mergedInto` and records venue changes.
- `convex/venueChanges.ts:61` — phones page changed venues 500 at a time (`CHANGES_PAGE_SIZE`, line 8).
- `src/lib/venue/venue-db.ts:157` `nearest` filters `excludedFromDiscovery = 0`, and `:169` `filterExcludedPlaces`
  uses hidden rows to drop same-named Apple Maps places within 100 m.
- `scripts/data/pipeline/regions.py:8` — `METRO_RADIUS_KM = 100`. `region_for` picks the nearest metro in the
  same country within 100 km (or by admin-area match); otherwise it returns `country:<ISO>`. The provided script
  copies this logic and refuses to run if the constant changes.
- `scripts/data/pipeline/wikidata.py:153` — the seed's `_museum_pattern` requires `wdt:P856 ?website`. That is why
  these items are missing. Names follow the seed: English label, else any label.
- `scripts/data/pipeline/museum-audit.py:145` — `museum_row`: key `wikidata:<QID>`, `seedSource: "wikidata"`, `country`
  only when valid; region falls back to `country:unknown`. The provided script produces the same shape.

**Precedent (identical mechanism):** on 2026-10-13, 971 crawl-classified non-art museums were inserted and hidden
this way. Readback found 0 problems, and the visible count stayed at 26,670. This plan's scripts generalize those.

**Hard constraints from the user and the repo:**

- **Never deploy** (`npx convex deploy`, `convex dev`) to prod. Prod may run functions from other worktrees, and a
  deploy replaces all of them. Use only the four already-deployed functions above.
- **No Tavily, no Nebius, no paid model/provider calls.** Wikidata (SPARQL + `wbgetentities`) only.
- No repository file changes. Everything lives in the gitignored `.context/`.

## Commands you will need

Run from the repository root of a `main` checkout (≥ `45dfc4a7`) with `node_modules` installed (`npm ci` if missing).

| Purpose             | Command                                                                       | Expected on success                |
| ------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| Prod function check | see Step 1                                                                    | four `True` lines                  |
| Snapshot            | `node $P/prod-museums.mjs snapshot --work $W`                                 | JSON with `rows` ≥ 46455           |
| Build rows          | `python3 $P/fetch-and-build.py --work $W --prod-snapshot $W/prod-before.json` | JSON summary, `rows` 20,000–28,000 |
| Pilot               | `node $P/prod-museums.mjs apply --work $W --pilot`                            | `100/100 inserted and hidden`      |
| Full upload         | `caffeinate -i node $P/prod-museums.mjs apply --work $W`                      | ends `N/N inserted and hidden`     |
| Verify              | `node $P/prod-museums.mjs verify --work $W`                                   | receipt with `problemCount: 0`     |

`$P` = `docs/plans/wikidata-hidden-museums` (this plan's directory, holding both scripts); `$W` =
`.context/wikidata-hidden-museums` (your gitignored work directory).

## Scope

**In scope** (the only things you create or change):

- `.context/wikidata-hidden-museums/**` (work dir: caches, rows, checkpoint, receipt)
- Prod `museums` rows whose key is in `$W/rows.json` (insert, then set `excludedFromDiscovery: true`)
- The **Status** line of this file

**Out of scope** (do NOT touch):

- Any existing prod museum row. The scripts never patch rows outside `rows.json`; do not "fix" anything else you notice.
- The dev deployment `usable-owl-256`. It is shared by all worktrees and has its own museum IDs.
- `assets/venues.db` and the `seed_venues` pipeline. Re-exporting the bundled table is a separate release step
  (see Maintenance notes).
- `city`/`cityKey` resolution. Hidden rows don't display a city; don't run `seed_venues --cities-only`.
- Any change under `convex/`, `scripts/`, `src/`, or a deploy. If the work seems to need one, STOP.

## Git workflow

No commits, no branch, no PR unless the operator asks. The only tracked change is this file's **Status** line.

## Steps

### Step 1: Set up the work dir and confirm prod has the functions

```sh
P=docs/plans/wikidata-hidden-museums
W=.context/wikidata-hidden-museums && mkdir -p $W/cli-home
printf '{}\n' > $W/cli-home/convex.json
printf '{"private":true,"dependencies":{"convex":"1.45.0"}}\n' > $W/cli-home/package.json
(cd $W/cli-home && env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT -u CONVEX_URL ../../../node_modules/.bin/convex function-spec --deployment admired-goldfinch-660 < /dev/null) > $W/function-spec.json
python3 -c "
import json; names={f.get('identifier') for f in json.load(open('$W/function-spec.json'))['functions']}
for n in ['ingest.js:upsertMuseums','museumAudit.js:byKeys','museumAudit.js:applyBatch','museumAudit.js:exportPage']: print(n, n in names)"
```

The CLI uses the Mac's logged-in Convex account. The `cli-home` directory has no `.env.local` and the environment is
stripped, so the dev deploy key cannot redirect `--deployment`.

**Verify**: `ls $P` lists `fetch-and-build.py` and `prod-museums.mjs`, and the Python prints four lines ending in `True`. `head -c 80 $W/function-spec.json` shows `"url":"https://admired-goldfinch-660.convex.cloud"`.

### Step 2: Snapshot prod museums

```sh
node $P/prod-museums.mjs snapshot --work $W < /dev/null
```

Takes ~2 min (≈93 pages of 500).

**Verify**: printed JSON has `rows` ≥ 46455 and `hidden` ≥ 19785, and `$W/prod-before.json` exists.
Write down `visible`; it was 26670 on 2026-10-13.

### Step 3: Enumerate Wikidata, fetch entities, and build rows (no prod writes)

```sh
caffeinate -i python3 $P/fetch-and-build.py --work $W --prod-snapshot $W/prod-before.json
```

It runs three SPARQL enumerations (museum `Q33506`, art gallery `Q1007870`, art museum `Q207694` subclass trees, each
with `P625` coordinates). Then it calls `wbgetentities` for every QID absent from the snapshot, 50 per request at
1 request/s (~30 min for ~27K), cached in `$W/entities.jsonl`. Re-running resumes. Row rules (already in the script):

- best-rank `P625` on Earth, finite and in range; otherwise skipped
- name = English label, else `mul`, else the first label by language code; skipped if empty or longer than 300 characters
- `country` = the single ISO code mapped from best-rank `P17` via `scripts/data/config/countries.json`, kept only if
  valid; region via the copied `region_for` (`country:unknown` without a country)
- `website` = first best-rank `P856` starting with `http(s)://`
- skipped: redirects and missing items; keys already in prod; a same-named prod venue within 1 km; a same-named new
  row within 1 km (keeps the lowest QID)

**Verify**: the printed summary (also `$W/build-summary.json`) has `rows` between 20000 and 28000, `likelyArtRows`
roughly 2500–3500, and the `skipped` counts are each under 3000. Spot-check: `python3 -c "import json,random; r=json.load(open('$W/rows.json')); [print(x) for x in random.sample(r,10)]"`.
Every row has `key == "wikidata:" + wikidataId`, `seedSource == "wikidata"`, and a `region`.

### Step 4: Pilot one batch of 100 on prod

```sh
node $P/prod-museums.mjs apply --work $W --pilot < /dev/null
```

Each batch: `byKeys` check, then `upsertMuseums` with `insertOnly: true`, then `applyBatch` hiding the same keys.
The rows are visible for a second or two between the insert and the hide; that is accepted.

**Verify**: prints `100/100 inserted and hidden`, and `$W/checkpoint.json` lists 100 keys. Then confirm on prod:

```sh
K=$(python3 -c "import json; print(json.dumps({'keys':[r['key'] for r in json.load(open('$W/rows.json'))[:100]]}))")
(cd $W/cli-home && env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT -u CONVEX_URL ../../../node_modules/.bin/convex run museumAudit:byKeys "$K" --deployment admired-goldfinch-660 --codegen disable --typecheck disable < /dev/null) \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), sum(1 for x in d if x and x.get('excludedFromDiscovery') is True))"
```

→ `100 100`.

### Step 5: Upload the rest

```sh
caffeinate -i node $P/prod-museums.mjs apply --work $W < /dev/null
```

~40 min. It skips checkpointed batches; if interrupted, re-run the same command.

**Verify**: last line `N/N inserted and hidden`, where N = `rows` from Step 3.

### Step 6: Full readback

```sh
node $P/prod-museums.mjs verify --work $W < /dev/null
```

**Verify**: `$W/production-receipt.json` has `problemCount: 0`. `after.rows == before.rows + inserted + otherNewKeysDuringRun.length`.
`after.hidden == before.hidden + inserted`, give or take any `otherNewKeysDuringRun`/`changedPreservedRows` made by
other writers. `visibleAfter == visibleBefore`, except where `changedPreservedRows` explains a difference.

## Test plan

No repository code changes, so no new automated tests. The checks are the pilot (Step 4) and the full readback
(Step 6). Before handing over, the scripts were smoke-tested on 2026-10-13: Step 3 on 200 QIDs (199 rows, 1 skipped as
a same-named prod venue within 1 km), and `node --check` on `prod-museums.mjs`. The `apply` path is the same call
sequence that inserted the 971 rows on 2026-10-13 with zero readback problems.

## Done criteria

- [ ] `$W/production-receipt.json` has `"problemCount": 0`
- [ ] `inserted` in the receipt equals `rows` in `$W/build-summary.json`
- [ ] `visibleAfter == visibleBefore` (or every difference is listed in `changedPreservedRows` and none is a key from `rows.json`)
- [ ] `git status --porcelain | grep -v '^??'` lists at most `docs/plans/wikidata-hidden-museums/plan.md`
- [ ] **Status** in this file set to DONE with the inserted count

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 shows any function missing, the function-spec URL is not `admired-goldfinch-660`, or the CLI prints
  "Ignoring" a deployment flag or mentions `usable-owl-256`.
- The CLI asks you to log in or returns an auth error. Do not create deploy keys; ask the operator.
- The Step 2 snapshot has fewer than 46,455 rows or fewer than 19,785 hidden. Something deleted or unhid venues.
- Step 3 `rows` falls outside 20,000–28,000, or any script prints a line starting with `STOP:`.
- Wikidata keeps failing (the script exits after 6 retries), or answers HTTP 429 repeatedly.
- The pilot readback is not `100 100`, or the receipt shows `problemCount > 0`.
- Anything seems to require a deploy, a schema change, a dev write, Tavily, or Nebius.

## Maintenance notes

- **Phones download every new row.** Each installed app fetches ~27K changed venues on its next venue sync
  (`venueChanges:list`, 500 per page, so ~54 pages). Before the next app build, re-export `assets/venues.db`
  (`scripts/data/README.md` "Venue seed and bundled database") so new installs start past these changes. The asset is
  9.4 MB for 45,484 rows; it should grow by roughly 5–6 MB (estimate at ~205 bytes/row).
- **Art-typed rows are hidden by choice.** `$W/likely-art.json` lists rows Wikidata types as art museum or gallery.
  To show any of them later: `museumAudit:applyBatch { records: [{ key, excludedFromDiscovery: false }] }` after
  review. Don't do this in this plan.
- **No delete path.** No deployed function removes museums. Undoing an insert means keeping it hidden, or writing
  and deploying a delete function. That is why the pilot comes first.
- Future `seed_venues --all` runs upsert website-having Wikidata items. They may update a hidden row's name,
  coordinates, website or region, but never `excludedFromDiscovery`, so these rows stay hidden.
- Deferred: `city`/`cityKey` for hidden rows, and classifying art vs. non-art for the new rows.

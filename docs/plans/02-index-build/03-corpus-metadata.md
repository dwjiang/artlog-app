# Plan 02.03: Normalize the Met, AIC and Wikidata painting metadata into artwork / object / placement records

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/sources jobs/artlog_jobs/normalize.py jobs/artlog_jobs/rights.py`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (wrong `rightsStatus` or owner mapping is a legal/product defect)
- **Depends on**: 02.01, 02.02 (owner museums exist), `docs/decisions/005-data-sources.md`
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

Source correction approved by the operator, 2026-09-09: read Met CSV
`Object Number` into the normalized object's `accession`, consistent with
[Decision 005 §2](../../decisions/005-data-sources.md#2-met-counts-and-metadata-contract).
Three live CSV/API comparisons confirmed it matches API `accessionNumber`;
`Object ID` remains the source identifier.

## Why this matters

Design §5.7 step 2: "Metadata first. Pull the Met and AIC dumps and the Wikidata SPARQL results into normalized Artwork, Object and Placement records — with `rightsStatus`, `ownerId`, current location, accession, `onView`, imageUrl, pageUrl — before downloading any image." The artwork/object/placement split (§4.2) and the rights rule (§5.5) are decided here for the whole corpus; the embed job (02.04) and the push (02.05) only consume these records.

## Current state

- `jobs/` scaffold (02.01): `PoliteClient`, checkpoints, `ConvexWriter`, `SCRATCH_DIR` (a local directory on the operator's Mac by default); `museums` seeded with `key = wikidata:Q…` (02.02). Runs happen locally; long ones under `caffeinate -i`.
- Verified source facts (2026-09-08, Met header corrected 2026-09-09): Met CSV `MetObjects.csv` (Git LFS, CC0; columns include `Object ID, Is Public Domain, Classification, Title, Artist Display Name, Object Date, Object Begin Date, Object End Date, Medium, Dimensions, Object Number, Gallery Number, Link Resource, Object Wikidata URL, Artist Wikidata URL, Department`); image URLs only via the API `/objects/{id}` (`primaryImage`, `primaryImageSmall`, 80 req/s published limit — use 1 req/s after the recovery probe). AIC dump (`api-data` repo, monthly) with `artwork_type_title`, `image_id`, `is_public_domain`, `is_on_view`, `gallery_title`, `main_reference_number`, `artist_title`, `artist_id`, `date_display`, `date_start`, `date_end`, `medium_display`, `dimensions`, `copyright_notice`, `title`; IIIF `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`; 60 req/min if using the API instead. Wikidata paintings: `?item wdt:P31 wd:Q3305213; wdt:P18 ?image` with `P170` (+ creator `P570` death date), `P571` inception, `P276` location, `P6216` copyright status (`Q19652` public domain), `p:P195/ps:P195` collection + `pq:P217` inventory number, `P179` series; images as `Special:FilePath/<File>` (original) and thumbnails only at standard widths (use `?width=330`). Met = `Q160236`, AIC = `Q239303`. `huggan/wikiart` is dropped (license).
- Records (pydantic, in `normalize.py`):
  - `ArtworkRecord { key, wikidataId?, title, artist, artistId?, date?, yearStart?, yearEnd?, rightsStatus, multiplicity, seriesId? }`
  - `ObjectRecord { key, artworkKey, ownerKey?, accession?, medium?, dimensions?, source: 'corpus', sourceId, imageRef (full-size URL for embedding), pageUrl, thumbnailUrl? (public-domain only) }`
  - `PlacementRecord { objectKey, venueKey, gallery?, onView, source: 'wikidata' | 'feed', confidence }`

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Fetch dumps | `uv run python -m artlog_jobs.sources.fetch --met --aic --out $SCRATCH_DIR/dumps` | files present |
| Normalize | `uv run python -m artlog_jobs.build_metadata --sources met,aic,wikidata --out $SCRATCH_DIR/metadata` | `artworks.jsonl`, `objects.jsonl`, `placements.jsonl` |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/sources artlog_jobs/normalize_test.py artlog_jobs/rights_test.py` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/sources/{__init__,fetch,met,aic,wikidata_paintings}.py`, `jobs/artlog_jobs/{normalize,rights,multiplicity,owner_map,build_metadata}.py`, tests + fixtures (`jobs/fixtures/met-sample.csv`, `aic-sample.json`, `wikidata-paintings-sample.json`).

**Out of scope**: image downloads and embedding (02.04), pushing to Convex (02.05), crawled venues (02.06).

## Steps

### Step 1: Fetch dumps

`sources/fetch.py`: Met CSV via `git lfs` clone of `metmuseum/openaccess` (or the raw LFS URL) into `dumps/met/`; AIC `api-data` tarball into `dumps/aic/`; Wikidata paintings via `wikidata.sparql` sliced by creator's `P570` decade or by collection (`VALUES ?collection { … }` for the 200 museums with the most paintings, then a remainder pass), saved as `dumps/wikidata/paintings-*.json`. All downloads checkpointed and resumable; polite UA.

**Verify**: sizes logged; `wc -l` counts within ±10% of `docs/decisions/005-data-sources.md`.

### Step 2: Source adapters

Each adapter yields `(ArtworkRecord, ObjectRecord, PlacementRecord | None)` per painting:

- `met.py`: filter `Classification` containing `Paintings`; `key = met:<Object ID>`; artwork `wikidataId` from `Object Wikidata URL`; `rightsStatus` from `Is Public Domain`; `imageRef = primaryImage` (fetched from the API for public-domain rows only — in-copyright Met rows have no images anyway), `thumbnailUrl = primaryImageSmall` when public domain; placement `venueKey = wikidata:Q160236`, `gallery = Gallery Number`, `onView = Gallery Number != ''`, `source: 'feed'`, `confidence 0.9`.
- `aic.py`: `artwork_type_title == 'Painting'` and `image_id` present; `key = aic:<id>`; `rightsStatus` from `is_public_domain` (true → public_domain, else `rights.from_copyright_notice(copyright_notice)` → `in_copyright`/`unknown`); `imageRef` = IIIF `/full/1686,/0/default.jpg` (≤ max allowed; fall back to `843,` if 1686 is refused), `thumbnailUrl` = IIIF `843,` when public domain; placement `wikidata:Q239303`, `gallery_title`, `is_on_view`.
- `wikidata_paintings.py`: `key = wikidata:<Q>`; artist label + `artistId`; year from `P571`; `rightsStatus` via `rights.from_wikidata(P6216, creator_death_year)`; `imageRef = Special:FilePath original`, `thumbnailUrl = ?width=330` when public domain; owner from `P195` mapped through `owner_map` to a `museums` key (skip when the collection has no venue row); placement from `P276` if it maps to a venue (`source: 'wikidata'`, `confidence 0.6`, `onView` unknown → `false`), else from `P195` (`confidence 0.5`); accession from `P217` qualifier.

**Verify**: adapter tests on the sample fixtures produce the expected records (assert full dicts for 3 rows each).

### Step 3: Rights, multiplicity, owners

`rights.py`: `public_domain` only on an explicit source flag (Met/AIC flags, Wikidata `P6216 = Q19652`) or creator death year ≤ current year − 100; `in_copyright` on an explicit copyright notice or death year > current year − 70; otherwise `unknown`. (Conservative on purpose; §5.5 treats `unknown` as `in_copyright`.) `multiplicity.py`: Wikidata items sharing normalized `(artist, title)` → `multiple`; `P179` series → `seriesId = wikidata:<series Q>`; Met/AIC rows default `unknown`; known-unique → `unique` only when Wikidata says so (single item, no `P179`, no "version of" `P144`). `owner_map.py`: Met/AIC fixed keys; Wikidata `P195` Q-id → `wikidata:<Q>` if that key exists in `museums` (load the key set via `exportVenues` once, cached in scratch).

**Verify**: `rights_test.py` covers each branch; `multiplicity_test.py` covers duplicates/series.

### Step 4: Merge and write

`build_metadata.py`: run adapters, merge artworks by `wikidataId` when two sources point to the same item (prefer Wikidata artwork fields for title/artist, keep every object), write `artworks.jsonl`, `objects.jsonl`, `placements.jsonl` plus `stats.json` (counts per source, rights distribution, unmapped owners).

**Verify**: a run on the fixtures produces three files and `stats.json`; the full run on the Mac (`caffeinate -i uv run python -m artlog_jobs.build_metadata --sources met,aic,wikidata --out $SCRATCH_DIR/metadata`) completes with counts in `stats.json` — the Met CSV comes through Git LFS and the Wikidata slices are the slow part; expect hours and rely on the checkpoints.

## Test plan

Fixtures with 5–10 rows per source; tests per adapter, `rights`, `multiplicity`, `owner_map`, and the merge.

## Done criteria

- [x] `uv run pytest -q` passes (99 new tests, 197 total); `ruff` clean
- [x] Full metadata run produced `stats.json` in scratch; numbers recorded in `jobs/README.md`
- [x] `rights` distribution shows `unknown` for anything ambiguous (no `public_domain` without an explicit flag or a ≥ 100-year death)
- [x] `docs/plans/README.md` status row updated

Implemented and recovered on 2026-09-09: **404,606 artworks, 409,926 objects,
and 296,329 placements**. All 396,545 Wikidata census items were fetched into
883 checkpoint files; ten unknown-value image claims were excluded. An
independent audit verified all references, current AIC placements, thumbnail
restrictions, and raw rights evidence for every public-domain object. The 197
Python tests, TypeScript, ESLint, and Ruff checks pass. There are no app/backend
changes, Convex writes, or image-body downloads.

The Met image-metadata census is complete: 5,577 eligible records, 5,565 image
URLs, eight 404s, four public-domain revocations, and no denied or unchecked
records. Explicit recovery preserves successful responses and retries cached
403s at one request/second with bounded cooldowns. All 1,251 old denials were
resolved. AIC's page-11 403 was a result-limit error; ID-based pagination fetched
all 3,912 live paintings. The default live snapshot emits 3,664 objects and
current placements, including 768 on view. Dev's 42,452 venue keys and document
IDs match the bundled asset; the recovered build uses the live export/cache path.

**Remaining source verification:** identified AIC IIIF image GETs still return
Cloudflare 403. Following decision 005, its image references and thumbnails
remain excluded. Met image-body verification belongs to 02.04. Commands,
coverage, counts, and output hashes are recorded in
[jobs/README.md](../../../jobs/README.md#corpus-metadata-0203).

## STOP conditions

- Met CSV columns differ from the list above — report the header row.
- AIC dump lacks `artwork_type_title` — report; use the API listing at 60 req/min instead only if the operator agrees to the runtime.
- Wikidata slicing still times out after collection + decade slicing — report and proceed with the partial set, noting coverage.

## Maintenance notes

- `rights.py` is policy; changes need a note in `docs/design/art-identifier.md` §5.5 and counsel review before launch (§5.5 says so).
- Placement `confidence` values feed `currentPlacement` ranking (plan 01.03); keep feed > wikidata.

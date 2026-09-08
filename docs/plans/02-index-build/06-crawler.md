# Plan 02.06: The polite central crawler — discovery, fetch, extract, embed, write

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- jobs/artlog_jobs/crawler jobs/config/venues.seed.json convex/crawl.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (external sites; terms; the only component that can annoy third parties)
- **Depends on**: 02.05 (push helpers), 04.05 (Convex queue functions), `docs/decisions/005-data-sources.md` (venue profiles), `docs/decisions/007-tavily.md` (Map parameters)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §4.2 "The crawler": one scheduled pipeline indexes any museum with a collection site — discover (API/IIIF → sitemap → Tavily Map), fetch politely (per-host 1–2 rps, `Crawl-delay`, identified UA, robots and terms checked at enqueue, conditional requests), extract and embed (title, artist, date, accession, rights line, image URL; embed; ORB; discard the image), write in batches so the index is searchable mid-run, with `indexStatus` progress the app subscribes to. Opt-outs are honored retroactively. §8: the crawler only fetches sites of seeded museum rows or confirmed POIs, never user-typed URLs.

## Current state

- Convex (plan 04.05): `crawl.claimNext` (internal mutation → next queued venue with its profile, marks `building`, creates a `crawlRuns` row), `crawl.progress({ runId, pagesMapped, worksIndexed })`, `crawl.finish({ runId, status: complete|capped|failed|no_index, error? })` (flips `museums.indexStatus`, schedules `identify.rerunWaiting` on `complete`), `crawl.isOptedOut({ venueId })`.
- Jobs (02.01–02.05): `PoliteClient` (robots cache, per-host rps, conditional GETs), `letterbox`, `orb`, `Embedder` (GPU; on CPU jobs use the same code — ~1–2 s/image on 8 vCPU; acceptable because fetching at 1 rps dominates), `push.py` helpers (`push_objects(rows)` etc. per batch).
- Verified crawler facts: many eMuseum sites disable the JSON API, block non-browser UAs via Cloudflare, and set `Crawl-delay: 30`; opt-out signals: robots `Disallow`, `Crawl-delay`, Cloudflare `Content-Signal: ai-train=no` (treat as a training opt-out — we do not train on crawled works anyway, §5.5 — but record it), TDMRep (`/.well-known/tdmrep.json`, `tdm-reservation: 1` header, `<meta name="tdm-reservation" content="1">`) — treat `tdm-reservation: 1` as **do not index**; RFC 9309: robots 5xx ⇒ disallow all. Tavily Map: `map(url, { max_depth: 2, max_breadth: 100, limit: 2000, select_paths: [...], allow_external: False })`, 1 credit/10 pages; CollectionSpace public browsers are client-side apps (use their gateway JSON). Spike 00.05 produced per-venue profiles (`platform`, `collectionSiteUrl`, object URL regex, on-view listing URL, accession URL pattern, robots verdict).
- `jobs/config/venues.seed.json`: `{ "<museum key>": { "collectionSiteUrl", "platform": "emuseum|collectionspace|iiif|generic", "objectPathRegex", "onViewListingUrl"?, "accessionUrlPattern"?, "useTavilyCrawl": false } }` — created here from the spike's table; also pushed into `museums` via `upsertMuseums` (fields `collectionSiteUrl`, `platform`, `accessionUrlPattern`, `crawlPolicy`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Worker (drains the queue) | `uv run python -m artlog_jobs.crawler.worker --max-venues 1 --page-cap 2000` | logs per stage |
| Dry discovery | `uv run python -m artlog_jobs.crawler.discover --venue wikidata:Q… --dry-run` | prints candidate URLs and cost |
| Launch | `jobs/scripts/launch-job.sh artlog_jobs.crawler.worker -- --max-venues 5` | job completes |
| Tests | `cd jobs && uv run pytest -q artlog_jobs/crawler` | pass |

## Scope

**In scope**: `jobs/artlog_jobs/crawler/{__init__,worker,discover,fetch,extract,parsers/{emuseum,generic,iiif,collectionspace}.py,writer,optout}.py` (+ tests, HTML fixtures under `jobs/fixtures/crawler/`), `jobs/config/venues.seed.json`, `jobs/artlog_jobs/seed_crawl_profiles.py` (pushes the profiles into `museums`), `jobs/README.md`.

**Out of scope**: the Convex queue/priority logic (04.05), enrichment (02.07), placements from checklists (04.10), any UI.

## Steps

### Step 1: Profiles and opt-out gate

`seed_crawl_profiles.py` pushes `venues.seed.json` into `museums` (via `upsertMuseums` with the crawl fields). `optout.py`: `check(venue) -> Verdict(allowed: bool, reason)`: `museums.optOut`, `optOuts` table (via `crawl.isOptedOut`), robots.txt for the collection site (allowed path?), TDMRep file/header/meta on the collection root, `Content-Signal` recorded; result written back as `crawlPolicy` through `crawl.setPolicy` (internal mutation in 04.05 — if missing, add it there, in scope by exception). A venue that fails the gate finishes with `no_index`.

**Verify**: tests with fixture robots/TDM responses for allow, disallow, 5xx ⇒ disallow, TDM reservation ⇒ disallow.

### Step 2: Discovery

`discover.py`: returns an ordered list of object-page URLs and a `method`: (1) platform API/IIIF (`emuseum` JSON if enabled: `/objects/json?page=N`; `iiif` collection manifests) → (2) `sitemap.xml` (+ index) filtered by `objectPathRegex` → (3) Tavily Map with `select_paths: [objectPathRegex]`, `allow_external: False`, `limit: page-cap`, on-view listing first when `onViewListingUrl` exists (map it with `max_depth: 1`) → (4) Tavily Crawl only when `useTavilyCrawl`. Cap at `--page-cap` (2,000); record `pagesMapped`; dedupe URLs; remember the method on the run.

Apply [decision 007](../../decisions/007-tavily.md): its Cleveland Map probes returned no object URLs beyond the supplied starting URL; the object-start Crawl extracted that page. A broad Map control included a sibling shop host despite `allow_external: false`. Enforce the approved exact host, scheme, object path, deduplication, and page cap client-side, including after subsequent fetch redirects. Empty mapping is not successful indexing. Cleveland's on-view discovery should use its official API. Reserve each request's worst-case credits through the shared spend system before dispatch; a 2,000-page Map does not fit the free-tier default daily cap.

**Verify**: tests: sitemap parsing (index + children, `lastmod` captured), regex filtering, Map call shape (mock), sibling-host rejection, empty mapping does not mark the venue complete, on-view-first ordering.

### Step 3: Fetch and extract

`fetch.py`: `PoliteClient` per host with `rps = min(1.0, 1 / crawlDelay)` when `Crawl-delay` is present (a 30 s delay means 30 s), browser-like but **identified** UA (`Mozilla/5.0 (compatible; artlog-bot/0.1; +https://…; mailto:…)`), conditional requests using `changeDetection` from a prior run; 403/429 → back off; after 20 consecutive failures abort the run as `failed`. `extract.py` + `parsers/`: `emuseum` (title `h1`/`.titleField`, artist `.peopleField`, date, medium, accession `.invnoField`, rights `.rightsField`, image `og:image` or the primary media URL), `generic` (schema.org `VisualArtwork` JSON-LD, then `og:title`/`og:image`, `meta[name=author]`), `iiif` (manifest metadata), `collectionspace` (gateway JSON). Output `CrawledWork { title, artist, date?, accession?, rightsLine?, imageUrl?, pageUrl }`; skip pages without an image URL or a title.

**Verify**: parser tests on saved HTML fixtures from the five first venues (fetched once by hand, ≤ 5 pages per site, stored under `jobs/fixtures/crawler/`); rate-limiter test honoring a 2 s delay.

### Step 4: Embed and write

`writer.py`: download each image to scratch (≤ 1024 px), `letterbox` → `Embedder` (CPU or GPU) → `extract_orb`; artwork matching: `wikidata_match.title_artist(title, artist)` (SPARQL label search with `mwapi` or a cached title index; fall back to creating `crawl:` artworks) ; `rightsStatus` from the rights line via `rights.from_copyright_notice` else `unknown`; object `key = crawl:<host>:<id>`, `source: 'crawl'`, `imageRef = imageUrl`, `pageUrl`, `thumbnailUrl` only when public domain (hotlink); placement `venueKey`, `onView` from the on-view listing membership, `source: 'crawl'`, `confidence 0.8`; vectors `source: 'crawl'`; descriptors. Push every 50 works via `push.py` helpers; call `crawl.progress` after each batch; delete the scratch image immediately after extraction.

**Verify**: writer test with fakes checks batch cadence, progress calls, thumbnail rule, and that no image path survives after processing.

### Step 5: Worker loop and change detection

`worker.py`: loop `--max-venues` times: `claimNext` → opt-out gate → discover → fetch/extract/write → `finish(complete|capped)`; store `changeDetection` (sitemap `lastmod` map, ETags) in scratch keyed by venue and push a summary to `museums.changeDetection`; on a re-crawl only fetch URLs whose `lastmod`/ETag changed. Exit 0 when the queue is empty.

**Verify**: end-to-end run against one small real venue from the profiles (page cap 100) on Nebius CPU: `museums.indexStatus` goes `queued → building → complete`, works are searchable (`identify` in the app finds one of them from a photo of the page image — manual check), and a second run fetches ~0 unchanged pages.

## Test plan

Tests per module under `jobs/artlog_jobs/crawler/`; fixtures under `jobs/fixtures/crawler/`; no live network in tests.

## Done criteria

- [ ] Tests pass; `ruff` clean
- [ ] One real venue crawled to `complete` with the page cap; counts logged in `jobs/README.md`
- [ ] `grep -rn "input(\|argv" jobs/artlog_jobs/crawler/` shows no way to pass an arbitrary URL except `--venue <museum key>` (URLs come only from `museums` rows)
- [ ] TDMRep/robots gate has tests for every verdict
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

- The first venue's terms of use forbid crawling on re-read — mark `no_index` and pick another; report.
- A site blocks the identified UA outright — do **not** spoof a browser UA without identification; record `no_index` and report.
- Plan 04.05's Convex functions are missing — do 04.05 first.

## Maintenance notes

- Adding a venue = adding a profile row (config), not code, unless it is a new platform.
- The page cap and per-host rate are safety limits; raise them only with the venue's blessing.
- Opt-outs are applied retroactively by `applyOptOut` (plan 04.08); the crawler only prevents new fetches.

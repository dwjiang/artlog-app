# Plan 04.05: Visits, POI venue confirmation, the crawl queue and its scheduler

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 86571a3..HEAD -- convex/visits.ts convex/museums.ts convex/crawl.ts convex/crons.ts convex/schema.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (the only path that can start work on third-party sites)
- **Depends on**: 04.04 (device identity, rate limits), 01.03. The launcher itself (plan 02.10, which waits on spike 00.08) is **not** a dependency: this plan ships with `CRAWL_LAUNCH_MODE=off`, and the crawler worker (02.06) is started by hand until 02.10 lands.
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.3: `startVisit(venueId)` records the visit and, for an un-indexed or stale venue off cooldown, moves it up the crawl queue (capped per device per day); a confirmed POI is inserted with `seedSource: poi` after the server probes its site for a collection section. §4.2 *Priority*: the queue is ordered by expected visits; being somewhere changes a queue position, never starts a fetch loop; a scan that misses while the venue is being crawled waits and re-runs on completion. §8: the crawler only ever fetches sites of seeded rows or confirmed POIs; queue bumps are attested and rate-limited.

## Current state

- Schema (01.03/02.01): `museums { key, name, lat, lng, website?, collectionSiteUrl?, platform?, accessionUrlPattern?, seedSource, region, optOut, crawlPolicy?, useTavilyCrawl, queuePriority, indexStatus { status, pagesMapped, worksIndexed, updatedAt }, lastCrawledAt?, changeDetection? }` with `by_key`, `by_queuePriority`, `by_indexStatus`; `crawlRuns`; `visits { deviceId, venueId, startedAt, endedAt?, lastConfidentGallery?, lastConfidentAt? }` with `by_device_started`.
- Auth/limits (04.04): `requireDevice`, `requireAttestedWrite`, `limitDevice(ctx, 'queueBump' | 'venueConfirm', …)`.
- Identify (04.03): `internal.identify.rerunWaiting({ venueId })`.
- Launch mechanism: decided by spike 00.08 and built by plan 02.10 — either (a) GitHub `workflow_dispatch` — `POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/nebius-job.yml/dispatches` with `Authorization: Bearer <fine-grained PAT>` (env `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`), body `{ ref: 'main', inputs: { job: 'artlog_jobs.crawler.worker', args: '--max-venues 5' } }`; or (b) Nebius REST. Here `launchWorker()` is one function keyed by `CRAWL_LAUNCH_MODE` (`off` | `github` | `nebius`); this plan implements only `off`, and 02.10 fills in the mode the record chose.
- Convex crons: `cronJobs()`, `crons.interval(name, { minutes }, internal.fn)`, `crons.daily(name, { hourUTC }, internal.fn)`; at most one run of each cron at a time.

## Scope

**In scope**: `convex/visits.ts`, `convex/museums.ts`, `convex/crawl.ts`, `convex/crons.ts` (create), `convex/schema.ts` (`museums.failureCount: number`, `museums.lastBumpedAt?: number`, `crawlRuns.claimedBy?: string`, `crawlRuns.updatedAt: number`, `visitStarts { deviceId, localVisitId, visitId }` and its lookup index, `crawlPages` as defined in Step 4), `convex/lib/validators.ts` (add crawl-run outcome `no_index`), `convex/lib/collectionSiteProbe.ts` (+ test), tests for each module, `.env.example` (name: `CRAWL_LAUNCH_MODE`, documented as `off`; plan 02.10 adds the launcher's variables).

**Out of scope**: the Python worker (02.06), placement logic (04.10), the app (03.05 calls these).

## Steps

### Step 1: Visits

`visits.ts`: `startVisit` (public mutation) args `{ venueId, localVisitId }` → `{ visitId, indexStatus }`: `requireDevice`; the device's most recent visit (`by_device_started`, `.order('desc').take(1)`) at the same venue with `startedAt` within 4 h and no `endedAt` is resumed; otherwise insert and close the preceding open visit. Store every successful start in `visitStarts { deviceId, localVisitId, visitId }` with `by_device_localVisitId`, including starts that resume an existing visit. Retries return that visit ID even after it ends, expires, or another venue becomes current. Return the museum's `indexStatus`. `endVisit` (public mutation) checks device ownership and sets `endedAt` once. `current` (public query) → the open visit for the device or null.

**Verify**: `npx vitest run convex/visits` → resume within 4 h; new visit after; other venue → new visit.

### Step 2: Queue bump and status

`museums.ts`: `getStatus` (public query, `{ venueId }` → `{ name, indexStatus, region }`), `bumpVenue` (public mutation, attested via `requireAttestedWrite`, `limitDevice('queueBump')`) → if `indexStatus.status ∈ { none, queued }` or (`complete` and `lastCrawledAt` older than 30 days) and `lastBumpedAt` older than 24 h and `collectionSiteUrl` present and not `optOut` → `queuePriority += 10`, `indexStatus.status = 'queued'` (including stale `complete` venues), `lastBumpedAt = now`, then `ctx.scheduler.runAfter(0, internal.crawl.maybeLaunch)`; returns `{ bumped: boolean, indexStatus }`. Venues with `status: none` and **no** `collectionSiteUrl` get `internal.museums.probeCollectionSite` scheduled instead.

Both `bumpVenue` and `confirmPoiVenue` also take `{ nonce, assertionBase64, payloadJson }`. Sign `stableStringify({ action: "museums.bumpVenue", venueId })` or `stableStringify({ action: "museums.confirmPoiVenue", name, website?, lat, lng })`, using `shared/stable-stringify.ts`. The server verifies the signed payload matches the operation and arguments.

**Verify**: tests: bump requires attestation (simulator bypass when flag off), rate limit on the 4th per day, cooldown, opt-out never bumps.

### Step 3: POI confirmation and site probe

`confirmPoiVenue` (public mutation, attested, `limitDevice('venueConfirm')`) args `{ name, website?, lat, lng }` → inserts `museums` `{ key: 'poi:' + crypto.randomUUID(), seedSource: 'poi', region: nearest seeded venue's region within 60 km (query `by_queuePriority`? no — use a bounding box over a `by_lat` index; add `.index('by_lat', ['lat'])`) or `'country:unknown'`, indexStatus none, queuePriority 0 }`, dedupes by name + distance ≤ 100 m against existing rows (returns the existing id), schedules `probeCollectionSite`, returns `{ venueId }`. `probeCollectionSite` (internal action) args `{ venueId }`: only when `website` is set; `collectionSiteProbe.ts` fetches at most 6 URLs (root, `/collection`, `/collections`, `/art/collection`, `/objects`, `/sitemap.xml`) with a 5 s timeout and the identified UA; detects `platform` (`emuseum` when `/objects/` links or "eMuseum" markers; `iiif` when `/iiif/` manifests are linked; `collectionspace`; else `generic` when a collection page has ≥ 20 links matching `/objects?/|/artworks?/|/collection/`); writes `collectionSiteUrl`, `platform`, `indexStatus: queued`, `queuePriority: 5`, or `indexStatus: no_index`. Network errors, timeouts, HTTP 408/429 and 5xx responses return `retry` when no collection is found; leave the venue in `none` so a later cooldown-limited bump can probe again. Queue bumps, probes and result application all honor both `museums.optOut` and the `optOuts` registry. Never accepts a URL from the client except `website` (which came from MapKit); the probe only follows same-host links.

**Verify**: `collectionSiteProbe.test.ts` with stubbed `fetch` for each platform; `museums.test.ts` for dedupe and scheduling (`t.finishAllScheduledFunctions`).

### Step 4: Queue mechanics for the worker

`crawl.ts` (all internal): `claimNext({ workerId })` is an internal action returning `{ runId, venue }` or `null` only when the queue is exhausted. It calls `claimNextBatch` (internal mutation) over ≤ 200 rows at a time, continuing after fully ineligible batches. Each batch uses `by_indexStatus [indexStatus.status, queuePriority]` descending, atomically sets the highest-priority eligible venue to `building`, and inserts `crawlRuns { status: running, claimedBy }`; `progress({ runId, pagesMapped, worksIndexed })` patches both; `finish({ runId, status, error? })`: `complete` → `indexStatus.complete`, `lastCrawledAt`, `failureCount 0`, schedule `internal.identify.rerunWaiting`; `capped` → back to `queued` keeping priority; `failed` → `failureCount++`, `queued` again or `no_index` at 3; `no_index` → set both the run and museum to `no_index` without incrementing `failureCount`; `isOptedOut({ venueId })`; `setPolicy({ venueId, crawlPolicy })`; `setChangeDetection`; `staleRunsSweep` (`updatedAt` older than 6 h → `failed`; progress and committed page states refresh it). Terminal `no_index`/`opted_out` outcomes also release waiting scans.

Add `crawlPages` to `convex/schema.ts`: `{ venueId: id(museums), url: string, sitemapLastmod?: string, etag?: string, lastModified?: string, processedAt: number }`, with index `by_venueId_url ["venueId", "url"]`. One row represents the validators of a successfully processed page; it contains no page body or image and is independent of scratch storage. Keep `museums.changeDetection` as the collection-level summary. The per-URL table is owned by this plan and retained across capped, failed and completed runs, including the 30-day freshness interval.

`crawl.getPageStates({ venueId, urls })` is an internal query returning the existing rows for at most 100 distinct URLs via exact indexed lookups. `crawl.recordPageStates({ runId, pages })` is an internal mutation accepting at most 100 distinct `{ url, sitemapLastmod?, etag?, lastModified? }` entries, deriving `venueId` from a running `crawlRuns` row and upserting each `(venueId, url)` through the same index with server-set `processedAt`. Replace the optional validators so a missing validator clears its previous value. The worker calls it only after the corresponding ingest writes succeed; a crash before this call may repeat idempotent writes, but must never mark an uncommitted page as processed. Repeated calls update existing rows; finished or missing runs are rejected. Both functions require admin authentication through the existing Python client contract; no public URL-cache API is added.

**Verify**: tests for each transition and `rerunWaiting` scheduling; page-state readback in a new run, venue isolation for identical URLs, idempotent upserts, clearing obsolete validators, rejection of oversized batches and writes from finished/missing runs. Run `npx convex codegen` and commit the generated API after adding these functions and the table.

### Step 5: Scheduler and launcher

`crawl.ts`: `maybeLaunch` (internal action): if any `queued` venue exists and no `running` run with activity in the last 2 h → reserve a `crawlLaunches` row atomically, call `launchWorker()`, then record its result (schema add: `{ at, mode, ok, response }`), rate-limited to 1 per 30 min. In this plan `launchWorker()` implements only `CRAWL_LAUNCH_MODE=off` (the default and the only documented value): it returns `{ ok: true, response: 'launcher not installed; run the crawler worker by hand' }`, so the row is the operator's signal to start `artlog_jobs.crawler.worker` on the Mac. Plan 02.10 adds the `github`/`nebius` modes behind the same function. `crons.ts`: `crons.interval('crawl scheduler', { minutes: 15 }, internal.crawl.maybeLaunch)`, `crons.daily('crawl freshness', { hourUTC: 3 }, internal.crawl.enqueueStale)` (up to 20 `complete` venues with `lastCrawledAt` > 30 days → `queued` at low priority), `crons.hourly('stale runs', { minuteUTC: 7 }, internal.crawl.staleRunsSweep)`.

**Verify**: tests: one `crawlLaunches` row per 30 min while a venue is queued; none while a run is running; the dev deployment's dashboard shows the three crons after `npx convex dev --once`.

## Test plan

`convex/visits.test.ts`, `convex/museums.test.ts`, `convex/lib/collectionSiteProbe.test.ts`, `convex/crawl.test.ts` (convex-test; `rateLimiter.register(t)`; `vi.stubGlobal('fetch')`).

## Done criteria

- [x] All tests pass (≥ 20 new); tsc/lint pass; `npx convex dev --once` succeeds and crons appear
- [x] `grep -rn "url" convex/museums.ts | grep -i "args"` shows no client-supplied crawl URL other than `website` in `confirmPoiVenue`
- [x] Env var names documented; no values in files
- [x] `docs/plans/README.md` updated

## STOP conditions

- The approved reconciliation keeps `capped` on crawl runs only, makes `queued` venues eligible for bumps, requeues stale completed venues, and adds crawl-run outcome `no_index`.
- Other `museums`/`crawlRuns` fields named above differ from what 01.03/02.01 shipped — report the diff; do not rename fields here.

## Maintenance notes

- Priority arithmetic is deliberately simple (+10 per bump, +5 for a new POI); size/traffic priors (§4.2) are a later data import.
- `maybeLaunch` is the only place that starts external work; keep it rate-limited and flag-guarded.

## Completion — 2026-09-09

- Implemented the approved status reconciliation and all five steps; worker launching defaults to `off`.
- 87 new tests; all 314 backend and 52 app tests pass (the existing opt-in benchmark remains skipped). `npx tsc --noEmit`, `npm run lint`, `npx convex codegen`, and `npx convex dev --once` pass.
- Verified all three deployed cron definitions through the dashboard's query API; the scheduler's first run succeeded. Unauthenticated live requests to both page-state functions and the current-visit query are rejected.
- Reloaded the 42,452 development seed museums with required `failureCount: 0`, preserving their IDs, after taking a snapshot. No migration or compatibility code was added.
- `npm run ios` built and installed on the dedicated iPhone 17 Pro simulator; the app runs in light mode and Settings reports `Backend: connected`. Venue UI integration remains in 03.05.

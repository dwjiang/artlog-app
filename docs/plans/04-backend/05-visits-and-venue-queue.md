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
- **Depends on**: 04.04 (device identity, rate limits), 01.03; `docs/decisions/008-jobs-and-release-logistics.md` (launch mechanism)
- **Category**: feature
- **Planned at**: commit `86571a3`, 2026-09-08

## Why this matters

Design §5.3: `startVisit(venueId)` records the visit and, for an un-indexed or stale venue off cooldown, moves it up the crawl queue (capped per device per day); a confirmed POI is inserted with `seedSource: poi` after the server probes its site for a collection section. §4.2 *Priority*: the queue is ordered by expected visits; being somewhere changes a queue position, never starts a fetch loop; a scan that misses while the venue is being crawled waits and re-runs on completion. §8: the crawler only ever fetches sites of seeded rows or confirmed POIs; queue bumps are attested and rate-limited.

## Current state

- Schema (01.03/02.01): `museums { key, name, lat, lng, website?, collectionSiteUrl?, platform?, accessionUrlPattern?, seedSource, region, optOut, crawlPolicy?, useTavilyCrawl, queuePriority, indexStatus { status, pagesMapped, worksIndexed, updatedAt }, lastCrawledAt?, changeDetection? }` with `by_key`, `by_queuePriority`, `by_indexStatus`; `crawlRuns`; `visits { deviceId, venueId, startedAt, endedAt?, lastConfidentGallery?, lastConfidentAt? }` with `by_device_started`.
- Auth/limits (04.04): `requireDevice`, `requireAttestedWrite`, `limitDevice(ctx, 'queueBump' | 'venueConfirm', …)`.
- Identify (04.03): `internal.identify.rerunWaiting({ venueId })`.
- Launch mechanism (spike 00.08): either (a) GitHub `workflow_dispatch` — `POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/nebius-job.yml/dispatches` with `Authorization: Bearer <fine-grained PAT>` (env `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`), body `{ ref: 'main', inputs: { job: 'artlog_jobs.crawler.worker', args: '--max-venues 5' } }`; or (b) Nebius REST. Implement whichever the record chose behind one function.
- Convex crons: `cronJobs()`, `crons.interval(name, { minutes }, internal.fn)`, `crons.daily(name, { hourUTC }, internal.fn)`; at most one run of each cron at a time.

## Scope

**In scope**: `convex/visits.ts`, `convex/museums.ts`, `convex/crawl.ts`, `convex/crons.ts` (create), `convex/schema.ts` (`museums.failureCount: number`, `museums.lastBumpedAt?: number`, `crawlRuns.claimedBy?: string`), `convex/lib/collectionSiteProbe.ts` (+ test), tests for each module, `.env.example` (names: `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `CRAWL_LAUNCH_MODE`).

**Out of scope**: the Python worker (02.06), placement logic (04.10), the app (03.05 calls these).

## Steps

### Step 1: Visits

`visits.ts`: `startVisit` (public mutation) args `{ venueId, localVisitId }` → `{ visitId, indexStatus }`: `requireDevice`; the device's most recent visit (`by_device_started`, `.order('desc').take(1)`) at the same venue with `startedAt` within 4 h and no `endedAt` is resumed; otherwise insert. Return the museum's `indexStatus`. `endVisit` (public mutation) sets `endedAt`. `current` (public query) → the open visit for the device or null.

**Verify**: `npx vitest run convex/visits` → resume within 4 h; new visit after; other venue → new visit.

### Step 2: Queue bump and status

`museums.ts`: `getStatus` (public query, `{ venueId }` → `{ name, indexStatus, region }`), `bumpVenue` (public mutation, attested via `requireAttestedWrite`, `limitDevice('queueBump')`) → if `indexStatus.status ∈ { none, capped }` or (`complete` and `lastCrawledAt` older than 30 days) and `lastBumpedAt` older than 24 h and `collectionSiteUrl` present and not `optOut` → `queuePriority += 10`, `indexStatus.status = 'queued'` (if `none`/`capped`), `lastBumpedAt = now`, then `ctx.scheduler.runAfter(0, internal.crawl.maybeLaunch)`; returns `{ bumped: boolean, indexStatus }`. Venues with `status: none` and **no** `collectionSiteUrl` get `internal.museums.probeCollectionSite` scheduled instead.

**Verify**: tests: bump requires attestation (simulator bypass when flag off), rate limit on the 4th per day, cooldown, opt-out never bumps.

### Step 3: POI confirmation and site probe

`confirmPoiVenue` (public mutation, attested, `limitDevice('venueConfirm')`) args `{ name, website?, lat, lng }` → inserts `museums` `{ key: 'poi:' + crypto.randomUUID(), seedSource: 'poi', region: nearest seeded venue's region within 60 km (query `by_queuePriority`? no — use a bounding box over a `by_lat` index; add `.index('by_lat', ['lat'])`) or `'country:unknown'`, indexStatus none, queuePriority 0 }`, dedupes by name + distance ≤ 100 m against existing rows (returns the existing id), schedules `probeCollectionSite`, returns `{ venueId }`. `probeCollectionSite` (internal action) args `{ venueId }`: only when `website` is set; `collectionSiteProbe.ts` fetches at most 6 URLs (root, `/collection`, `/collections`, `/art/collection`, `/objects`, `/sitemap.xml`) with a 5 s timeout and the identified UA; detects `platform` (`emuseum` when `/objects/` links or "eMuseum" markers; `iiif` when `/iiif/` manifests are linked; `collectionspace`; else `generic` when a collection page has ≥ 20 links matching `/objects?/|/artworks?/|/collection/`); writes `collectionSiteUrl`, `platform`, `indexStatus: queued`, `queuePriority: 5`, or `indexStatus: no_index`. Never accepts a URL from the client except `website` (which came from MapKit); the probe only follows same-host links.

**Verify**: `collectionSiteProbe.test.ts` with stubbed `fetch` for each platform; `museums.test.ts` for dedupe and scheduling (`t.finishAllScheduledFunctions`).

### Step 4: Queue mechanics for the worker

`crawl.ts` (all internal): `claimNext({ workerId })` → highest `queuePriority` among `queued` (index `by_indexStatus` then sort in memory over ≤ 200 rows), sets `building`, inserts `crawlRuns { status: running, claimedBy }`, returns the venue profile; `progress({ runId, pagesMapped, worksIndexed })` patches both; `finish({ runId, status, error? })`: `complete` → `indexStatus.complete`, `lastCrawledAt`, `failureCount 0`, schedule `internal.identify.rerunWaiting`; `capped` → back to `queued` keeping priority; `failed` → `failureCount++`, `queued` again or `no_index` at 3; `no_index` → set; `isOptedOut({ venueId })`; `setPolicy({ venueId, crawlPolicy })`; `setChangeDetection`; `staleRunsSweep` (runs older than 6 h with no progress → `failed`).

**Verify**: tests for each transition and `rerunWaiting` scheduling.

### Step 5: Scheduler and launcher

`crawl.ts`: `maybeLaunch` (internal action): if any `queued` venue exists and no `running` run younger than 2 h and `CRAWL_LAUNCH_MODE !== 'off'` → call `launchWorker()` (GitHub dispatch or Nebius REST per the record; both via `fetch` with env secrets), recording `crawlLaunches` (schema add: `{ at, mode, ok, response }`) and rate-limiting launches to 1 per 30 min. `crons.ts`: `crons.interval('crawl scheduler', { minutes: 15 }, internal.crawl.maybeLaunch)`, `crons.daily('crawl freshness', { hourUTC: 3 }, internal.crawl.enqueueStale)` (up to 20 `complete` venues with `lastCrawledAt` > 30 days → `queued` at low priority), `crons.hourly('stale runs', { minuteUTC: 7 }, internal.crawl.staleRunsSweep)`.

**Verify**: tests with stubbed `fetch`: launch happens once per 30 min while a run is queued; nothing launches when a run is running; the dev deployment's dashboard shows the three crons after `npx convex dev --once`.

## Test plan

`convex/visits.test.ts`, `convex/museums.test.ts`, `convex/lib/collectionSiteProbe.test.ts`, `convex/crawl.test.ts` (convex-test; `rateLimiter.register(t)`; `vi.stubGlobal('fetch')`).

## Done criteria

- [ ] All tests pass (≥ 20 new); tsc/lint pass; `npx convex dev --once` succeeds and crons appear
- [ ] `grep -rn "url" convex/museums.ts | grep -i "args"` shows no client-supplied crawl URL other than `website` in `confirmPoiVenue`
- [ ] Env var names documented; no values in files
- [ ] `docs/plans/README.md` updated

## STOP conditions

- The launch mechanism record is missing — implement `launchWorker` as a no-op that logs, mark `CRAWL_LAUNCH_MODE=off`, and report.
- A GitHub fine-grained PAT cannot be scoped to `actions:write` on the repo — report.

## Maintenance notes

- Priority arithmetic is deliberately simple (+10 per bump, +5 for a new POI); size/traffic priors (§4.2) are a later data import.
- `maybeLaunch` is the only place that starts external work; keep it rate-limited and flag-guarded.

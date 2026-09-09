import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { seedDevice, seedMuseum, testVector } from './lib/testFactories';
import { harness } from './test.helpers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('CRAWL_LAUNCH_MODE', 'off'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture(overrides: Partial<Doc<'museums'>> = {}) {
  const t = harness();
  const venueId = await t.run((ctx) => seedMuseum(ctx, {
    queuePriority: 10, collectionSiteUrl: 'https://museum.example/collection',
    indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() }, ...overrides,
  }));
  const claim = () => t.action(internal.crawl.claimNext, { workerId: 'worker-1' });
  return { t, venueId, claim };
}

it('claims the highest priority venue and returns its profile with a running run id', async () => {
  const { t, venueId, claim } = await fixture();
  await t.run((ctx) => seedMuseum(ctx, { queuePriority: 1, collectionSiteUrl: 'https://other.example',
    indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } }));
  const result = await claim();
  expect(result).toMatchObject({ venue: { _id: venueId, indexStatus: { status: 'building' } } });
  expect(await t.run((ctx) => ctx.db.get(result!.runId))).toMatchObject({ venueId, status: 'running', claimedBy: 'worker-1' });
});

it('finds a high priority venue even when more than 200 venues preceded it', async () => {
  const { t, claim } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 210; i++) await seedMuseum(ctx, { queuePriority: 1, collectionSiteUrl: 'https://other.example',
      indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } });
  });
  const best = await t.run((ctx) => seedMuseum(ctx, { queuePriority: 100, collectionSiteUrl: 'https://best.example',
    indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } }));
  expect((await claim())?.venue._id).toBe(best);
});

it('does not allow two workers to claim the same venue', async () => {
  const { t, claim } = await fixture();
  const results = await Promise.all([claim(), t.action(internal.crawl.claimNext, { workerId: 'worker-2' })]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

it('skips opted-out venues and venues without collection sites', async () => {
  const { t, venueId, claim } = await fixture({ optOut: true });
  expect(await claim()).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus.status).toBe('opted_out');
  await t.run((ctx) => seedMuseum(ctx, { indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } }));
  expect(await claim()).toBeNull();
});

it('finds eligible work beyond multiple batches of ineligible queued venues', async () => {
  const { t, venueId, claim } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 450; i++) await seedMuseum(ctx, {
      queuePriority: 20, optOut: i % 2 === 0,
      indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() },
    });
  });
  expect((await claim())?.venue._id).toBe(venueId);
  expect(await claim()).toBeNull();
});

it('only reports an empty queue after clearing every ineligible batch', async () => {
  const { t, claim } = await fixture({ collectionSiteUrl: undefined });
  await t.run(async (ctx) => {
    for (let i = 0; i < 400; i++) await seedMuseum(ctx, {
      indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() },
    });
  });
  expect(await claim()).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('museums')
    .withIndex('by_indexStatus', (q) => q.eq('indexStatus.status', 'queued')).first())).toBeNull();
});

it('writes progress and heartbeat to the run and museum, rejecting invalid or decreasing counts', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  vi.setSystemTime(Date.now() + HOUR);
  await t.mutation(internal.crawl.progress, { runId, pagesMapped: 20, worksIndexed: 10 });
  expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ pagesMapped: 20, worksIndexed: 10, updatedAt: Date.now() });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus).toMatchObject({ pagesMapped: 20, worksIndexed: 10, updatedAt: Date.now() });
  for (const count of [-1, 0.5, Infinity, 5]) {
    await expect(t.mutation(internal.crawl.progress, { runId, pagesMapped: count, worksIndexed: 10 })).rejects.toThrow();
  }
});

it('completes a run, clears failures, and reruns waiting scans', async () => {
  const { t, venueId, claim } = await fixture({ failureCount: 2 });
  const { runId } = (await claim())!;
  const user = await seedDevice(t);
  const { scan } = await t.mutation(internal.scans.create, { deviceId: user.deviceId, localId: 'waiting', venueId,
    capturedAt: Date.now(), vector: testVector(), modelVersion: model.modelVersion });
  await t.mutation(internal.scans.setResult, { scanId: scan._id, generation: 0, status: 'waiting', calibratorVersion: 'lr-v1',
    keepFeatures: { descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), keypointCount: 0 } });
  await t.mutation(internal.crawl.finish, { runId, status: 'complete' });
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ failureCount: 0, lastCrawledAt: Date.now(), indexStatus: { status: 'complete' } });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await t.run((ctx) => ctx.db.get(scan._id)))?.status).toBe('identified');
});

it('requeues capped runs with their priority and failure count intact', async () => {
  const { t, venueId, claim } = await fixture({ failureCount: 1 });
  const { runId } = (await claim())!;
  await t.mutation(internal.crawl.finish, { runId, status: 'capped' });
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ failureCount: 1, queuePriority: 10, indexStatus: { status: 'queued' } });
  expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: 'capped', finishedAt: Date.now() });
  expect((await claim())?.runId).not.toBe(runId);
});

it('retries failures twice, then stops retrying on the third failure', async () => {
  const { t, venueId, claim } = await fixture();
  for (let count = 1; count <= 3; count++) {
    const { runId } = (await claim())!;
    await t.mutation(internal.crawl.finish, { runId, status: 'failed', error: 'network failure' });
    expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ failureCount: count,
      indexStatus: { status: count === 3 ? 'no_index' : 'queued' } });
  }
  expect(await claim()).toBeNull();
});

it('records no_index as a terminal outcome without increasing failures', async () => {
  const { t, venueId, claim } = await fixture({ failureCount: 1 });
  const { runId } = (await claim())!;
  await t.mutation(internal.crawl.finish, { runId, status: 'no_index' });
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ failureCount: 1, indexStatus: { status: 'no_index' } });
  expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe('no_index');
  expect(await claim()).toBeNull();
});

it('repeating finish is idempotent and late progress is refused', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  await t.mutation(internal.crawl.finish, { runId, status: 'failed' });
  await t.mutation(internal.crawl.finish, { runId, status: 'failed' });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.failureCount).toBe(1);
  await expect(t.mutation(internal.crawl.progress, { runId, pagesMapped: 1, worksIndexed: 1 })).rejects.toThrow();
});

it('does not resurrect a venue opted out during a run', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  await t.run((ctx) => ctx.db.patch(venueId, { optOut: true }));
  expect(await t.query(internal.crawl.isOptedOut, { venueId })).toBe(true);
  await expect(t.mutation(internal.crawl.progress, { runId, pagesMapped: 1, worksIndexed: 1 })).rejects.toThrow();
  await t.mutation(internal.crawl.finish, { runId, status: 'complete' });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus.status).toBe('opted_out');
});

it('sweeps runs with six hours without progress while keeping an old active run', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  vi.setSystemTime(Date.now() + 7 * HOUR);
  await t.mutation(internal.crawl.progress, { runId, pagesMapped: 1, worksIndexed: 1 });
  await t.mutation(internal.crawl.staleRunsSweep, {});
  expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe('running');
  vi.setSystemTime(Date.now() + 6 * HOUR + 1);
  await t.mutation(internal.crawl.staleRunsSweep, {});
  expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe('failed');
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ failureCount: 1, indexStatus: { status: 'queued' } });
});

it('stores crawl policy and replaces collection-level validators', async () => {
  const { t, venueId } = await fixture();
  const crawlPolicy = { robotsAllowed: true, termsChecked: true, checkedAt: Date.now(), crawlDelaySeconds: 30 };
  await t.mutation(internal.crawl.setPolicy, { venueId, crawlPolicy });
  await t.mutation(internal.crawl.setChangeDetection, { venueId, changeDetection: { etag: 'v1', lastModified: 'yesterday' } });
  await t.mutation(internal.crawl.setChangeDetection, { venueId, changeDetection: { etag: 'v2' } });
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ crawlPolicy, changeDetection: { etag: 'v2' } });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.changeDetection?.lastModified).toBeUndefined();
});

it('page states survive a capped run and upsert with obsolete validators cleared', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  const url = 'https://museum.example/objects/1';
  await t.mutation(internal.crawl.recordPageStates, { runId, pages: [{ url, etag: 'v1', lastModified: 'old', sitemapLastmod: 'old' }] });
  await t.mutation(internal.crawl.finish, { runId, status: 'capped' });
  const second = (await claim())!;
  const [first] = await t.query(internal.crawl.getPageStates, { venueId, urls: [url] });
  expect(first).toMatchObject({ url, etag: 'v1' });
  vi.setSystemTime(Date.now() + 1);
  await t.mutation(internal.crawl.recordPageStates, { runId: second.runId, pages: [{ url, etag: 'v2' }] });
  const rows = await t.query(internal.crawl.getPageStates, { venueId, urls: [url, 'missing'] });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ _id: first._id, etag: 'v2', processedAt: Date.now() });
  expect(rows[0]).not.toHaveProperty('lastModified');
  expect(rows[0]).not.toHaveProperty('sitemapLastmod');
  await t.mutation(internal.crawl.finish, { runId: second.runId, status: 'complete' });
  vi.setSystemTime(Date.now() + 31 * DAY);
  expect(await t.query(internal.crawl.getPageStates, { venueId, urls: [url] })).toEqual(rows);
});

it('isolates identical page URLs by venue', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  const other = await t.run((ctx) => seedMuseum(ctx));
  const url = 'https://museum.example/objects/1';
  await t.mutation(internal.crawl.recordPageStates, { runId, pages: [{ url }] });
  expect(await t.query(internal.crawl.getPageStates, { venueId: other, urls: [url] })).toEqual([]);
  expect(await t.query(internal.crawl.getPageStates, { venueId, urls: [url] })).toHaveLength(1);
});

it('refuses page writes from finished or missing runs and rejects oversized or duplicate batches', async () => {
  const { t, venueId, claim } = await fixture();
  const { runId } = (await claim())!;
  const urls = Array.from({ length: 101 }, (_, i) => `https://museum.example/objects/${i}`);
  for (const invalid of [urls, [urls[0], urls[0]]]) {
    await expect(t.query(internal.crawl.getPageStates, { venueId, urls: invalid })).rejects.toThrow();
    await expect(t.mutation(internal.crawl.recordPageStates, { runId, pages: invalid.map((url) => ({ url })) })).rejects.toThrow();
  }
  const pages = [{ url: urls[0] }];
  await t.mutation(internal.crawl.finish, { runId, status: 'failed' });
  await expect(t.mutation(internal.crawl.recordPageStates, { runId, pages })).rejects.toThrow();
  await t.run((ctx) => ctx.db.delete(runId));
  await expect(t.mutation(internal.crawl.recordPageStates, { runId, pages })).rejects.toThrow();
});

it('records only one launch per thirty minutes even with concurrent triggers', async () => {
  const { t } = await fixture();
  await Promise.all(Array.from({ length: 4 }, () => t.action(internal.crawl.maybeLaunch, {})));
  let rows = await t.run((ctx) => ctx.db.query('crawlLaunches').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ mode: 'off', ok: true, response: 'launcher not installed; run the crawler worker by hand' });
  vi.setSystemTime(Date.now() + 30 * 60 * 1000 - 1);
  await t.action(internal.crawl.maybeLaunch, {});
  expect(await t.run((ctx) => ctx.db.query('crawlLaunches').collect())).toHaveLength(1);
  vi.setSystemTime(Date.now() + 1);
  await t.action(internal.crawl.maybeLaunch, {});
  rows = await t.run((ctx) => ctx.db.query('crawlLaunches').collect());
  expect(rows).toHaveLength(2);
});

it('does not launch without queued work or while a worker is active', async () => {
  const { t, claim } = await fixture();
  await claim();
  await t.action(internal.crawl.maybeLaunch, {});
  expect(await t.run((ctx) => ctx.db.query('crawlLaunches').collect())).toHaveLength(0);
  await t.run((ctx) => seedMuseum(ctx, { indexStatus: { status: 'queued', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } }));
  await t.action(internal.crawl.maybeLaunch, {});
  expect(await t.run((ctx) => ctx.db.query('crawlLaunches').collect())).toHaveLength(0);
});

it('reports unsupported launch modes without external requests', async () => {
  const { t } = await fixture();
  vi.stubEnv('CRAWL_LAUNCH_MODE', 'github');
  await t.action(internal.crawl.maybeLaunch, {});
  expect(await t.run((ctx) => ctx.db.query('crawlLaunches').collect())).toEqual([
    expect.objectContaining({ mode: 'github', ok: false }),
  ]);
});

it('enqueues at most twenty stale completed venues at low priority', async () => {
  const { t, venueId } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 23; i++) await seedMuseum(ctx, { lastCrawledAt: Date.now() - 31 * DAY,
      collectionSiteUrl: 'https://museum.example/collection', queuePriority: 100 });
    await seedMuseum(ctx, { lastCrawledAt: Date.now(), collectionSiteUrl: 'https://museum.example/collection' });
    await seedMuseum(ctx, { lastCrawledAt: Date.now() - 32 * DAY, optOut: true, collectionSiteUrl: 'https://museum.example/collection' });
  });
  await t.mutation(internal.crawl.enqueueStale, {});
  const queued = await t.run((ctx) => ctx.db.query('museums').withIndex('by_indexStatus', (q) => q.eq('indexStatus.status', 'queued')).collect());
  expect(queued).toHaveLength(21);
  expect(queued.filter((venue) => venue._id !== venueId).every((venue) => venue.queuePriority === 1)).toBe(true);
});

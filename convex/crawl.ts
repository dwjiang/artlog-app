import { ConvexError, type Infer, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { isVenueOptedOut } from './lib/venueOptOut';
import schema from './schema';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const finishStatus = v.union(v.literal('complete'), v.literal('capped'), v.literal('failed'), v.literal('no_index'));
const pageState = schema.tables.crawlPages.validator.omit('venueId', 'processedAt');
const claimResult = v.union(v.object({ runId: v.id('crawlRuns'), venue: schema.doc('museums') }), v.null());
const claimBatchResult = v.union(claimResult, v.literal('continue'));

async function running(ctx: QueryCtx, runId: Id<'crawlRuns'>) {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== 'running') throw new ConvexError({ code: 'crawl_not_running' });
  const venue = await ctx.db.get(run.venueId);
  if (!venue) throw new ConvexError({ code: 'invalid_venue' });
  if (await isVenueOptedOut(ctx, venue)) throw new ConvexError({ code: 'venue_opted_out' });
  if (venue.indexStatus.status !== 'building') throw new ConvexError({ code: 'crawl_not_running' });
  return { run, venue };
}

export const claimNext = internalAction({
  args: { workerId: v.string() },
  returns: claimResult,
  handler: async (ctx, args): Promise<Infer<typeof claimResult>> => {
    while (true) {
      const result: Infer<typeof claimBatchResult> = await ctx.runMutation(internal.crawl.claimNextBatch, args);
      if (result !== 'continue') return result;
    }
  },
});

export const claimNextBatch = internalMutation({
  args: { workerId: v.string() },
  returns: claimBatchResult,
  handler: async (ctx, { workerId }) => {
    if (!workerId.trim() || workerId.length > 200) throw new ConvexError({ code: 'invalid_worker' });
    const venues = await ctx.db.query('museums').withIndex('by_indexStatus', (q) => q.eq('indexStatus.status', 'queued'))
      .order('desc').take(200);
    for (const venue of venues) {
      const now = Date.now();
      const excluded = await isVenueOptedOut(ctx, venue);
      if (excluded || !venue.collectionSiteUrl) {
        await ctx.db.patch(venue._id, { indexStatus: { ...venue.indexStatus, status: excluded ? 'opted_out' : 'no_index', updatedAt: now } });
        await ctx.scheduler.runAfter(0, internal.identify.rerunWaiting, { venueId: venue._id });
        continue;
      }
      const indexStatus = { status: 'building' as const, pagesMapped: 0, worksIndexed: 0, updatedAt: now };
      await ctx.db.patch(venue._id, { indexStatus });
      const runId = await ctx.db.insert('crawlRuns', {
        venueId: venue._id, claimedBy: workerId, startedAt: now, updatedAt: now,
        status: 'running', pagesMapped: 0, worksIndexed: 0,
      });
      return { runId, venue: { ...venue, indexStatus } };
    }
    return venues.length === 200 ? 'continue' as const : null;
  },
});

export const progress = internalMutation({
  args: { runId: v.id('crawlRuns'), pagesMapped: v.number(), worksIndexed: v.number() },
  returns: v.null(),
  handler: async (ctx, { runId, pagesMapped, worksIndexed }) => {
    const { run, venue } = await running(ctx, runId);
    if (!Number.isSafeInteger(pagesMapped) || !Number.isSafeInteger(worksIndexed) ||
      pagesMapped < run.pagesMapped || worksIndexed < run.worksIndexed) throw new ConvexError({ code: 'invalid_progress' });
    const fields = { pagesMapped, worksIndexed, updatedAt: Date.now() };
    await ctx.db.patch(runId, fields);
    await ctx.db.patch(venue._id, { indexStatus: { ...venue.indexStatus, ...fields } });
    return null;
  },
});

async function finishRun(ctx: MutationCtx, run: Doc<'crawlRuns'>, status: Infer<typeof finishStatus>, error?: string) {
  if (run.status !== 'running') return;
  const venue = await ctx.db.get(run.venueId);
  if (!venue) throw new ConvexError({ code: 'invalid_venue' });
  const now = Date.now();
  const excluded = await isVenueOptedOut(ctx, venue);
  const failureCount = excluded ? venue.failureCount : status === 'complete' ? 0 : venue.failureCount + (status === 'failed' ? 1 : 0);
  const nextStatus = excluded ? 'opted_out' : status === 'complete' ? 'complete' :
    status === 'no_index' || (status === 'failed' && failureCount >= 3) ? 'no_index' : 'queued';
  await ctx.db.patch(run._id, { status: excluded ? 'no_index' : status, error, finishedAt: now, updatedAt: now });
  await ctx.db.patch(venue._id, {
    failureCount, lastCrawledAt: !excluded && status === 'complete' ? now : venue.lastCrawledAt,
    indexStatus: { ...venue.indexStatus, status: nextStatus, updatedAt: now },
  });
  if (nextStatus !== 'queued') {
    // Terminal outcomes release scans waiting for an index that will no longer be built.
    await ctx.scheduler.runAfter(0, internal.identify.rerunWaiting, { venueId: venue._id });
  }
}

export const finish = internalMutation({
  args: { runId: v.id('crawlRuns'), status: finishStatus, error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { runId, status, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new ConvexError({ code: 'crawl_not_found' });
    await finishRun(ctx, run, status, error);
    return null;
  },
});

export const isOptedOut = internalQuery({
  args: { venueId: v.id('museums') },
  returns: v.boolean(),
  handler: async (ctx, { venueId }) => {
    const venue = await ctx.db.get(venueId);
    return venue ? isVenueOptedOut(ctx, venue) : true;
  },
});

export const setPolicy = internalMutation({
  args: { venueId: v.id('museums'), crawlPolicy: schema.tables.museums.validator.fields.crawlPolicy },
  returns: v.null(),
  handler: async (ctx, { venueId, crawlPolicy }) => {
    if (!await ctx.db.get(venueId)) throw new ConvexError({ code: 'invalid_venue' });
    await ctx.db.patch(venueId, { crawlPolicy });
    return null;
  },
});

export const setChangeDetection = internalMutation({
  args: { venueId: v.id('museums'), changeDetection: schema.tables.museums.validator.fields.changeDetection },
  returns: v.null(),
  handler: async (ctx, { venueId, changeDetection }) => {
    if (!await ctx.db.get(venueId)) throw new ConvexError({ code: 'invalid_venue' });
    await ctx.db.patch(venueId, { changeDetection });
    return null;
  },
});

export const staleRunsSweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const runs = await ctx.db.query('crawlRuns').withIndex('by_status_updatedAt', (q) =>
      q.eq('status', 'running').lt('updatedAt', Date.now() - 6 * HOUR)).take(100);
    for (const run of runs) await finishRun(ctx, run, 'failed', 'No progress for six hours');
    if (runs.length === 100) await ctx.scheduler.runAfter(0, internal.crawl.staleRunsSweep, {});
    return null;
  },
});

function checkUrls(urls: string[]) {
  if (urls.length > 100) throw new ConvexError({ code: 'batch_too_large', max: 100 });
  if (new Set(urls).size !== urls.length || urls.some((url) => !url.trim() || url.length > 2048)) {
    throw new ConvexError({ code: 'invalid_page_urls' });
  }
}

export const getPageStates = internalQuery({
  args: { venueId: v.id('museums'), urls: v.array(v.string()) },
  returns: v.array(schema.doc('crawlPages')),
  handler: async (ctx, { venueId, urls }) => {
    checkUrls(urls);
    const rows = await Promise.all(urls.map((url) => ctx.db.query('crawlPages')
      .withIndex('by_venueId_url', (q) => q.eq('venueId', venueId).eq('url', url)).unique()));
    return rows.filter((row) => row !== null);
  },
});

export const recordPageStates = internalMutation({
  args: { runId: v.id('crawlRuns'), pages: v.array(pageState) },
  returns: v.null(),
  handler: async (ctx, { runId, pages }) => {
    checkUrls(pages.map((page) => page.url));
    const { run } = await running(ctx, runId);
    const now = Date.now();
    for (const page of pages) {
      const existing = await ctx.db.query('crawlPages').withIndex('by_venueId_url', (q) =>
        q.eq('venueId', run.venueId).eq('url', page.url)).unique();
      const fields = { venueId: run.venueId, url: page.url, sitemapLastmod: page.sitemapLastmod,
        etag: page.etag, lastModified: page.lastModified, processedAt: now };
      if (existing) await ctx.db.replace(existing._id, fields);
      else await ctx.db.insert('crawlPages', fields);
    }
    if (pages.length) await ctx.db.patch(runId, { updatedAt: now });
    return null;
  },
});

export const reserveLaunch = internalMutation({
  args: { mode: v.string() },
  returns: v.union(v.id('crawlLaunches'), v.null()),
  handler: async (ctx, { mode }) => {
    const now = Date.now();
    const queued = await ctx.db.query('museums').withIndex('by_indexStatus', (q) => q.eq('indexStatus.status', 'queued')).first();
    if (!queued) return null;
    const active = await ctx.db.query('crawlRuns').withIndex('by_status_updatedAt', (q) =>
      q.eq('status', 'running').gt('updatedAt', now - 2 * HOUR)).first();
    if (active) return null;
    const latest = await ctx.db.query('crawlLaunches').withIndex('by_at').order('desc').first();
    if (latest && now - latest.at < 30 * 60 * 1000) return null;
    // Reserve before external I/O: scheduler and user-triggered actions can overlap.
    return ctx.db.insert('crawlLaunches', { at: now, mode, ok: false, response: 'launch reserved' });
  },
});

export const recordLaunch = internalMutation({
  args: { launchId: v.id('crawlLaunches'), ok: v.boolean(), response: v.string() },
  returns: v.null(),
  handler: async (ctx, { launchId, ok, response }) => {
    await ctx.db.patch(launchId, { ok, response });
    return null;
  },
});

async function launchWorker(mode: string) {
  if (mode !== 'off') return { ok: false, response: 'unsupported launch mode; launcher not installed' };
  return { ok: true, response: 'launcher not installed; run the crawler worker by hand' };
}

export const maybeLaunch = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const mode = process.env.CRAWL_LAUNCH_MODE ?? 'off';
    const launchId: Id<'crawlLaunches'> | null = await ctx.runMutation(internal.crawl.reserveLaunch, { mode });
    if (!launchId) return null;
    const result = await launchWorker(mode);
    await ctx.runMutation(internal.crawl.recordLaunch, { launchId, ...result });
    return null;
  },
});

export const enqueueStale = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const venues = await ctx.db.query('museums').withIndex('by_status_lastCrawledAt', (q) =>
      q.eq('indexStatus.status', 'complete').gt('lastCrawledAt', 0).lt('lastCrawledAt', now - 30 * DAY)).take(200);
    let queued = 0;
    for (const venue of venues) {
      const excluded = await isVenueOptedOut(ctx, venue);
      const status = excluded ? 'opted_out' : venue.collectionSiteUrl ? 'queued' : 'no_index';
      await ctx.db.patch(venue._id, { queuePriority: status === 'queued' ? 1 : venue.queuePriority,
        indexStatus: { ...venue.indexStatus, status, updatedAt: now } });
      if (status === 'queued' && ++queued === 20) break;
    }
    return null;
  },
});

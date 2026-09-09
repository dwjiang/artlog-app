import { ConvexError, v } from 'convex/values';

import { stableStringify } from '../shared/stable-stringify';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from './_generated/server';
import { requireAttestedWrite } from './devices';
import { bumpCounter } from './ingest';
import { probeCollectionSite as probe, websiteUrl } from './lib/collectionSiteProbe';
import { limitDevice } from './lib/rateLimits';
import { isVenueOptedOut } from './lib/venueOptOut';
import schema from './schema';

const DAY = 24 * 60 * 60 * 1000;
const signedPayload = { nonce: v.string(), assertionBase64: v.string(), payloadJson: v.string() };
const collectionSite = v.object({
  collectionSiteUrl: v.string(),
  platform: v.union(v.literal('emuseum'), v.literal('iiif'), v.literal('collectionspace'), v.literal('generic')),
});

function checkPayload(payloadJson: string, expected: object) {
  if (payloadJson !== stableStringify(expected)) throw new ConvexError({ code: 'invalid_payload' });
}

export const getStatus = query({
  args: { venueId: v.id('museums') },
  returns: v.object({ name: v.string(), indexStatus: schema.tables.museums.validator.fields.indexStatus, region: v.string() }),
  handler: async (ctx, { venueId }) => {
    const venue = await ctx.db.get(venueId);
    if (!venue) throw new ConvexError({ code: 'invalid_venue' });
    return { name: venue.name, indexStatus: venue.indexStatus, region: venue.region };
  },
});

export const bumpVenue = mutation({
  args: { venueId: v.id('museums'), ...signedPayload },
  returns: v.object({ bumped: v.boolean(), indexStatus: schema.tables.museums.validator.fields.indexStatus }),
  handler: async (ctx, args) => {
    checkPayload(args.payloadJson, { action: 'museums.bumpVenue', venueId: args.venueId });
    const device = await requireAttestedWrite(ctx, { ...args, payload: args.payloadJson });
    await limitDevice(ctx, 'queueBump', device._id);
    const venue = await ctx.db.get(args.venueId);
    if (!venue) throw new ConvexError({ code: 'invalid_venue' });
    const now = Date.now();
    const { status } = venue.indexStatus;
    const eligible = status === 'none' || status === 'queued' ||
      (status === 'complete' && venue.lastCrawledAt !== undefined && venue.lastCrawledAt < now - 30 * DAY);
    if (!eligible || await isVenueOptedOut(ctx, venue) || (venue.lastBumpedAt !== undefined && venue.lastBumpedAt >= now - DAY)) {
      return { bumped: false, indexStatus: venue.indexStatus };
    }
    if (!venue.collectionSiteUrl) {
      if (status === 'none' && venue.website) {
        await ctx.db.patch(venue._id, { lastBumpedAt: now });
        await ctx.scheduler.runAfter(0, internal.museums.probeCollectionSite, { venueId: venue._id });
      }
      return { bumped: false, indexStatus: venue.indexStatus };
    }
    const indexStatus = { ...venue.indexStatus, status: 'queued' as const, updatedAt: now };
    await ctx.db.patch(venue._id, { queuePriority: venue.queuePriority + 10, indexStatus, lastBumpedAt: now });
    await ctx.scheduler.runAfter(0, internal.crawl.maybeLaunch, {});
    return { bumped: true, indexStatus };
  },
});

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

async function nearby(ctx: QueryCtx, lat: number, lng: number, radius: number) {
  const delta = radius / 6371000 * 180 / Math.PI;
  const rows = await ctx.db.query('museums').withIndex('by_lat', (q) =>
    q.gte('lat', Math.max(-90, lat - delta)).lte('lat', Math.min(90, lat + delta))).take(10000);
  if (rows.length === 10000) throw new ConvexError({ code: 'venue_search_too_large' });
  return rows.map((venue) => ({ venue, distance: distanceMeters({ lat, lng }, venue) }))
    .filter(({ distance }) => distance <= radius).sort((a, b) => a.distance - b.distance);
}

function normalizeName(name: string) { return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }

export const confirmPoiVenue = mutation({
  args: { name: v.string(), website: v.optional(v.string()), lat: v.number(), lng: v.number(), ...signedPayload },
  returns: v.object({ venueId: v.id('museums') }),
  handler: async (ctx, args) => {
    const fields = { name: args.name, website: args.website, lat: args.lat, lng: args.lng };
    checkPayload(args.payloadJson, { action: 'museums.confirmPoiVenue', ...fields });
    const device = await requireAttestedWrite(ctx, { ...args, payload: args.payloadJson });
    await limitDevice(ctx, 'venueConfirm', device._id);
    if (!Number.isFinite(args.lat) || Math.abs(args.lat) > 90 || !Number.isFinite(args.lng) || Math.abs(args.lng) > 180 ||
      !normalizeName(args.name) || args.name.length > 300 || (args.website !== undefined && !websiteUrl(args.website))) {
      throw new ConvexError({ code: 'invalid_venue' });
    }
    const duplicate = (await nearby(ctx, args.lat, args.lng, 100))
      .find(({ venue }) => normalizeName(venue.name) === normalizeName(args.name));
    if (duplicate) return { venueId: duplicate.venue._id };
    const seeded = (await nearby(ctx, args.lat, args.lng, 60000)).find(({ venue }) => venue.seedSource !== 'poi');
    const venueId = await ctx.db.insert('museums', {
      ...fields, name: args.name.trim().replace(/\s+/g, ' '), key: `poi:${crypto.randomUUID()}`,
      seedSource: 'poi', region: seeded?.venue.region ?? 'country:unknown', optOut: false,
      useTavilyCrawl: false, queuePriority: 0, failureCount: 0,
      indexStatus: { status: 'none', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() },
    });
    await bumpCounter(ctx, 'museums', 1);
    await ctx.scheduler.runAfter(0, internal.museums.probeCollectionSite, { venueId });
    return { venueId };
  },
});

export const getForProbe = internalQuery({
  args: { venueId: v.id('museums') },
  returns: v.union(schema.doc('museums'), v.null()),
  handler: async (ctx, { venueId }) => {
    const venue = await ctx.db.get(venueId);
    return venue && !await isVenueOptedOut(ctx, venue) ? venue : null;
  },
});

export const probeCollectionSite = internalAction({
  args: { venueId: v.id('museums') },
  returns: v.null(),
  handler: async (ctx, { venueId }) => {
    const venue: Doc<'museums'> | null = await ctx.runQuery(internal.museums.getForProbe, { venueId });
    if (!venue?.website || venue.indexStatus.status !== 'none' || venue.collectionSiteUrl) return null;
    const result = await probe(venue.website);
    await ctx.runMutation(internal.museums.applyProbe, { venueId, website: venue.website, result });
    return null;
  },
});

export const applyProbe = internalMutation({
  args: { venueId: v.id('museums'), website: v.string(), result: v.union(collectionSite, v.null(), v.literal('retry')) },
  returns: v.null(),
  handler: async (ctx, { venueId, website, result }) => {
    const venue = await ctx.db.get(venueId);
    if (!venue || await isVenueOptedOut(ctx, venue) || venue.indexStatus.status !== 'none' ||
      venue.collectionSiteUrl || venue.website !== website || result === 'retry') return null;
    await ctx.db.patch(venueId, {
      collectionSiteUrl: result?.collectionSiteUrl, platform: result?.platform,
      queuePriority: result ? Math.max(venue.queuePriority, 5) : venue.queuePriority,
      indexStatus: { ...venue.indexStatus, status: result ? 'queued' : 'no_index', updatedAt: Date.now() },
    });
    if (result) await ctx.scheduler.runAfter(0, internal.crawl.maybeLaunch, {});
    return null;
  },
});

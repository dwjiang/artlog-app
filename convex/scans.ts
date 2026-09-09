import { paginationResultValidator } from 'convex/server';
import { ConvexError, type Infer, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery, query, type QueryCtx } from './_generated/server';
import { requireDevice } from './lib/auth';
import { isSupported } from './lib/modelVersion';
import { rightsStatus, snapshotFields } from './lib/validators';
import schema from './schema';

const scanFields = schema.tables.scans.validator.fields;
const displayCandidate = snapshotFields.extend({
  objectId: v.id('objects'), artworkId: v.id('artworks'), probability: v.number(),
  rightsStatus, thumbnailUrl: v.optional(v.string()),
  gallery: v.optional(v.string()), corners: v.optional(v.array(v.array(v.number()))),
});

export const scanDisplay = v.object({
  scanId: v.id('scans'), localId: v.string(), venueId: scanFields.venueId,
  visitId: scanFields.visitId, capturedAt: v.number(), status: scanFields.status,
  outcome: scanFields.outcome, calibratorVersion: scanFields.calibratorVersion,
  best: v.optional(displayCandidate), runnerUps: v.optional(v.array(displayCandidate)),
  docent: scanFields.docent, rightNow: scanFields.rightNow, error: scanFields.error,
  indexStatus: v.optional(schema.tables.museums.validator.fields.indexStatus),
});
export type ScanDisplay = Infer<typeof scanDisplay>;

export const create = internalMutation({
  args: {
    deviceId: v.id('devices'), localId: v.string(), venueId: scanFields.venueId,
    visitId: scanFields.visitId, gallery: scanFields.gallery, modelVersion: v.string(),
    vector: scanFields.vector, capturedAt: v.number(),
  },
  returns: v.object({ scan: schema.doc('scans'), existing: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('scans')
      .withIndex('by_device_localId', (q) => q.eq('deviceId', args.deviceId).eq('localId', args.localId))
      .unique();
    const restart = existing && existing.status !== 'identified' && isSupported(args.modelVersion) &&
      (existing.status === 'unsupported_version' || existing.status === 'failed' || existing.modelVersion !== args.modelVersion);
    if (existing && !restart) return { scan: existing, existing: true };
    if (args.visitId) {
      const visit = await ctx.db.get(args.visitId);
      if (!visit || visit.deviceId !== args.deviceId || visit.venueId !== args.venueId) {
        throw new ConvexError({ code: 'invalid_visit' });
      }
    }
    if (args.venueId && !await ctx.db.get(args.venueId)) {
      throw new ConvexError({ code: 'invalid_venue' });
    }
    const now = Date.now();
    const fields = {
      ...args, generation: existing ? existing.generation + 1 : 0, status: 'pending' as const,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const scanId = existing?._id ?? await ctx.db.insert('scans', fields);
    if (existing) await ctx.db.replace(scanId, fields);
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    return { scan, existing: false };
  },
});

export const setResult = internalMutation({
  args: {
    scanId: v.id('scans'), generation: v.number(), status: scanFields.status, outcome: scanFields.outcome,
    best: scanFields.best, runnerUps: scanFields.runnerUps, calibratorVersion: v.string(),
    error: v.optional(v.string()),
    keepFeatures: v.optional(v.object({ descriptors: v.bytes(), keypoints: v.bytes(), keypointCount: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    if (scan.generation !== args.generation || (scan.status !== 'pending' && scan.status !== 'waiting')) return null;
    if (args.status === 'waiting' && !args.keepFeatures) {
      throw new ConvexError({ code: 'bad_features' });
    }
    const features = args.status === 'waiting' ? args.keepFeatures : undefined;
    await ctx.db.patch(scan._id, {
      status: args.status, outcome: args.outcome, best: args.best, runnerUps: args.runnerUps,
      calibratorVersion: args.calibratorVersion, error: args.error, updatedAt: Date.now(),
      descriptors: features?.descriptors, keypoints: features?.keypoints, keypointCount: features?.keypointCount,
    });
    if (args.status === 'waiting' && scan.venueId) {
      const venue = await ctx.db.get(scan.venueId);
      if (venue?.indexStatus.status !== 'queued' && venue?.indexStatus.status !== 'building') {
        // Index completion may have drained the waiting queue before this write committed.
        await ctx.scheduler.runAfter(0, internal.identify.rerunScan, { scanId: scan._id, generation: scan.generation });
      }
    }
    if (args.outcome === 'confident' && scan.visitId && args.best?.gallery !== undefined) {
      const visit = await ctx.db.get(scan.visitId);
      if (visit?.deviceId === scan.deviceId && visit.venueId === scan.venueId &&
        (visit.lastConfidentAt === undefined || scan.capturedAt >= visit.lastConfidentAt)) {
        await ctx.db.patch(visit._id, { lastConfidentGallery: args.best.gallery, lastConfidentAt: scan.capturedAt });
      }
    }
    return null;
  },
});

async function joinCandidate(
  ctx: QueryCtx,
  match: NonNullable<Doc<'scans'>['best']>,
): Promise<Infer<typeof displayCandidate> | null> {
  const [object, artwork] = await Promise.all([ctx.db.get(match.objectId), ctx.db.get(match.artworkId)]);
  if (!object || !artwork) return null;
  const owner = object.ownerId ? await ctx.db.get(object.ownerId) : null;
  return {
    ...match, title: artwork.title, artist: artwork.artist, date: artwork.date, medium: object.medium,
    institution: owner?.name, rightsStatus: artwork.rightsStatus,
    ...(artwork.rightsStatus === 'public_domain' && object.thumbnailUrl
      ? { thumbnailUrl: object.thumbnailUrl } : {}),
  };
}

async function displayScan(ctx: QueryCtx, scan: Doc<'scans'>): Promise<ScanDisplay> {
  const [best, runnerUps, venue] = await Promise.all([
    scan.best ? joinCandidate(ctx, scan.best) : null,
    Promise.all((scan.runnerUps ?? []).map((match) => joinCandidate(ctx, match))),
    scan.venueId ? ctx.db.get(scan.venueId) : null,
  ]);
  return {
    scanId: scan._id, localId: scan.localId, venueId: scan.venueId, visitId: scan.visitId,
    capturedAt: scan.capturedAt, status: scan.status, outcome: scan.outcome,
    calibratorVersion: scan.calibratorVersion, best: best ?? undefined,
    runnerUps: runnerUps.flatMap((candidate) => candidate ? [candidate] : []),
    docent: scan.docent, rightNow: scan.rightNow, error: scan.error,
    indexStatus: scan.status === 'waiting' ? venue?.indexStatus : undefined,
  };
}

export const get = query({
  args: { scanId: v.id('scans') },
  returns: v.union(scanDisplay, v.null()),
  handler: async (ctx, { scanId }) => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get(scanId);
    return scan?.deviceId === device._id ? displayScan(ctx, scan) : null;
  },
});

export const getStored = internalQuery({
  args: { scanId: v.id('scans') },
  returns: v.union(schema.doc('scans'), v.null()),
  handler: (ctx, { scanId }) => ctx.db.get(scanId),
});

export const getDisplay = internalQuery({
  args: { scanId: v.id('scans'), deviceId: v.id('devices') },
  returns: scanDisplay,
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== deviceId) throw new ConvexError({ code: 'scan_not_found' });
    return displayScan(ctx, scan);
  },
});

export const listWaiting = internalQuery({
  args: { venueId: v.id('museums'), cursor: v.optional(v.string()) },
  returns: paginationResultValidator(schema.doc('scans')),
  handler: (ctx, { venueId, cursor }) => ctx.db.query('scans')
    .withIndex('by_venue_status', (q) => q.eq('venueId', venueId).eq('status', 'waiting'))
    .paginate({ numItems: 25, cursor: cursor ?? null }),
});

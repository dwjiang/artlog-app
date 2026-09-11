import { ConvexError, type Infer, v } from 'convex/values';

import type { Doc } from './_generated/dataModel';
import { internalMutation, internalQuery, query, type QueryCtx } from './_generated/server';
import { requireDevice } from './lib/auth';
import { isSupported } from './lib/modelVersion';
import { displayLabelFlow } from './lib/labelVerify';
import { docentSentence, factChip, labelFlowDisplay, rightsStatus, snapshotFields } from './lib/validators';
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
  // Docent prose and its source chips come from the artwork (design §4.8); only a confident card shows them.
  docent: v.optional(v.array(docentSentence)), factSheet: v.optional(v.array(factChip)),
  rightNow: scanFields.rightNow,
  // The label flow and museum-site search are the owner's own state (design §4.4); the raw OCR reading stays server-side.
  labelFlow: v.optional(labelFlowDisplay), museumSearch: scanFields.museumSearch,
  error: scanFields.error,
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
    best: scanFields.best, runnerUps: scanFields.runnerUps, candidateSignals: scanFields.candidateSignals,
    calibratorVersion: v.string(), error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    if (scan.generation !== args.generation || scan.status !== 'pending') return null;
    await ctx.db.patch(scan._id, {
      status: args.status, outcome: args.outcome, best: args.best, runnerUps: args.runnerUps,
      candidateSignals: args.candidateSignals, calibratorVersion: args.calibratorVersion, error: args.error,
      updatedAt: Date.now(),
    });
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
): Promise<{ candidate: Infer<typeof displayCandidate>; artwork: Doc<'artworks'> } | null> {
  const [object, artwork] = await Promise.all([ctx.db.get(match.objectId), ctx.db.get(match.artworkId)]);
  if (!object || object.reverted || !artwork) return null;
  const owner = object.ownerId ? await ctx.db.get(object.ownerId) : null;
  // Design §5.5: a hotlinked source image only for public-domain works; a contributor's consented crop always.
  const thumbnailUrl = object.thumbnailStorageId
    ? await ctx.storage.getUrl(object.thumbnailStorageId)
    : artwork.rightsStatus === 'public_domain' ? object.thumbnailUrl : undefined;
  return {
    artwork,
    candidate: {
      ...match, title: artwork.title, artist: artwork.artist, date: artwork.date, medium: object.medium,
      institution: owner?.name, rightsStatus: artwork.rightsStatus, ...(thumbnailUrl ? { thumbnailUrl } : {}),
    },
  };
}

async function displayScan(ctx: QueryCtx, scan: Doc<'scans'>): Promise<ScanDisplay> {
  const [best, runnerUps] = await Promise.all([
    scan.best ? joinCandidate(ctx, scan.best) : null,
    Promise.all((scan.runnerUps ?? []).map((match) => joinCandidate(ctx, match))),
  ]);
  const prose = scan.outcome === 'confident' ? best?.artwork : undefined;
  return {
    scanId: scan._id, localId: scan.localId, venueId: scan.venueId, visitId: scan.visitId,
    capturedAt: scan.capturedAt, status: scan.status, outcome: scan.outcome,
    calibratorVersion: scan.calibratorVersion, best: best?.candidate,
    runnerUps: runnerUps.flatMap((joined) => joined ? [joined.candidate] : []),
    docent: prose?.docent?.en,
    factSheet: prose?.factSheet?.map(({ id, sourceUrl, sourceLabel }) => ({ id, sourceUrl, sourceLabel })),
    rightNow: scan.rightNow,
    labelFlow: scan.labelFlow && displayLabelFlow(scan.labelFlow), museumSearch: scan.museumSearch,
    error: scan.error,
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

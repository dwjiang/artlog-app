import { ConvexError, type Infer, v } from 'convex/values';

import model from '../shared/model-version.json';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from './_generated/server';
import { requireDeviceFromAction } from './lib/auth';
import { DEFAULT_CALIBRATOR } from './lib/calibrator';
import { runPipeline } from './lib/identifyPipeline';
import { isSupported, validateVector } from './lib/modelVersion';
import { decodeOrbFeatures, OrbFormatError, type OrbFeatures } from './lib/orb';
import { currentPlacement } from './lib/placements';
import { limitDevice } from './lib/rateLimits';
import { multiplicity } from './lib/validators';
import { scanDisplay, type ScanDisplay } from './scans';
import schema from './schema';

const loadedCandidate = v.object({
  object: schema.doc('objects'), artwork: schema.doc('artworks'),
  similarity: v.number(), runnerUpSimilarity: v.number(),
  placement: v.union(schema.doc('placements'), v.null()), institution: v.optional(v.string()),
  descriptors: v.optional(v.bytes()), keypoints: v.optional(v.bytes()),
  keypointCount: v.number(), inputSize: v.optional(v.number()),
});
export type LoadedCandidate = Infer<typeof loadedCandidate>;

export const loadCandidates = internalQuery({
  args: { vectorIds: v.array(v.id('vectors')), scores: v.array(v.number()), venueId: v.optional(v.id('museums')), now: v.number() },
  returns: v.array(loadedCandidate),
  handler: async (ctx, { vectorIds, scores, now }): Promise<LoadedCandidate[]> => {
    if (vectorIds.length !== scores.length || vectorIds.length > 32) {
      throw new ConvexError({ code: 'bad_candidates' });
    }
    const byObject = new Map<Id<'objects'>, { object: Doc<'objects'>; similarity: number }>();
    for (let i = 0; i < vectorIds.length; i++) {
      const vector = await ctx.db.get(vectorIds[i]);
      if (!vector) continue;
      let object = await ctx.db.get(vector.objectId);
      if (!object || object.reverted) continue;
      if (object.mergedInto) object = await ctx.db.get(object.mergedInto);
      if (!object || object.reverted || object.mergedInto) continue;
      const previous = byObject.get(object._id);
      if (!previous || scores[i] > previous.similarity) byObject.set(object._id, { object, similarity: scores[i] });
    }
    const ranked = [...byObject.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 20);
    const candidates: LoadedCandidate[] = [];
    for (const { object, similarity } of ranked) {
      const [artwork, descriptors, owner] = await Promise.all([
        ctx.db.get(object.artworkId),
        ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', object._id)).unique(),
        object.ownerId ? ctx.db.get(object.ownerId) : null,
      ]);
      if (!artwork) continue;
      let placement: Doc<'placements'> | null = null;
      for await (const row of ctx.db.query('placements').withIndex('by_objectId', (q) => q.eq('objectId', object._id))) {
        placement = currentPlacement(placement ? [placement, row] : [row], now);
      }
      candidates.push({
        object, artwork, similarity, runnerUpSimilarity: 0, placement, institution: owner?.name,
        descriptors: descriptors?.descriptors, keypoints: descriptors?.keypoints,
        keypointCount: descriptors?.keypointCount ?? 0, inputSize: descriptors?.inputSize,
      });
    }
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].runnerUpSimilarity = candidates[i === 0 ? 1 : 0]?.similarity ?? 0;
    }
    return candidates;
  },
});

export const loadContext = internalQuery({
  args: { scanId: v.id('scans') },
  returns: v.object({ visit: v.union(schema.doc('visits'), v.null()), venue: v.union(schema.doc('museums'), v.null()) }),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    const [visit, venue, device] = await Promise.all([
      scan.visitId ? ctx.db.get(scan.visitId) : null,
      scan.venueId ? ctx.db.get(scan.venueId) : null,
      ctx.db.get(scan.deviceId),
    ]);
    if (!device || device.banned) throw new ConvexError({ code: 'device_banned' });
    if (scan.visitId && (!visit || visit.deviceId !== scan.deviceId || visit.venueId !== scan.venueId)) {
      throw new ConvexError({ code: 'invalid_visit' });
    }
    return { visit, venue };
  },
});

export const proposeFromScan = internalMutation({
  args: {
    objectId: v.id('objects'), proposedVenueId: v.id('museums'), scanId: v.id('scans'),
    deviceId: v.id('devices'), multiplicity,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.banned || scan?.deviceId !== args.deviceId || scan.venueId !== args.proposedVenueId ||
      scan.outcome !== 'confident' || scan.best?.objectId !== args.objectId) {
      throw new ConvexError({ code: 'invalid_scan' });
    }
    const existing = await ctx.db.query('placementProposals')
      .withIndex('by_object_venue', (q) => q.eq('objectId', args.objectId).eq('proposedVenueId', args.proposedVenueId))
      .unique();
    if (existing?.scanIds.includes(args.scanId)) return null;
    const deviceIds = [...new Set([...(existing?.deviceIds ?? []), args.deviceId])];
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        scanIds: [...existing.scanIds, args.scanId], deviceIds,
        lastSeenAt: now, readyForReview: deviceIds.length >= 2,
      });
    } else {
      await ctx.db.insert('placementProposals', {
        objectId: args.objectId, proposedVenueId: args.proposedVenueId,
        kind: args.multiplicity === 'unique' ? 'move' : 'new_object',
        scanIds: [args.scanId], deviceIds, firstSeenAt: now, lastSeenAt: now,
        status: 'pending', readyForReview: false,
      });
    }
    return null;
  },
});

export const getProposalContext = internalQuery({
  args: { scanId: v.id('scans') },
  returns: v.union(v.object({ objectId: v.id('objects'), multiplicity }), v.null()),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan?.best || scan.outcome !== 'confident' || !scan.venueId) return null;
    const artwork = await ctx.db.get(scan.best.artworkId);
    if (!artwork) return null;
    let placement: Doc<'placements'> | null = null;
    for await (const row of ctx.db.query('placements').withIndex('by_objectId', (q) => q.eq('objectId', scan.best!.objectId))) {
      placement = currentPlacement(placement ? [placement, row] : [row], Date.now());
    }
    return placement?.venueId === scan.venueId ? null : { objectId: scan.best.objectId, multiplicity: artwork.multiplicity };
  },
});

async function proposeForScan(ctx: ActionCtx, scan: Doc<'scans'>): Promise<void> {
  if (!scan.venueId || scan.outcome !== 'confident') return;
  const proposal = await ctx.runQuery(internal.identify.getProposalContext, { scanId: scan._id });
  if (proposal) await ctx.runMutation(internal.identify.proposeFromScan, {
    ...proposal, proposedVenueId: scan.venueId, scanId: scan._id, deviceId: scan.deviceId,
  });
}

async function runScan(
  ctx: ActionCtx, scan: Doc<'scans'>, query: OrbFeatures,
  features: { descriptors: ArrayBuffer; keypoints: ArrayBuffer }, force: boolean,
): Promise<ScanDisplay> {
  const matches = await ctx.vectorSearch('vectors', 'by_vector', {
    vector: scan.vector, limit: 32, filter: (q) => q.eq('modelVersion', scan.modelVersion),
  });
  const now = Date.now();
  const [candidates, context] = await Promise.all([
    ctx.runQuery(internal.identify.loadCandidates, {
      vectorIds: matches.map((match) => match._id), scores: matches.map((match) => match._score),
      venueId: scan.venueId, now,
    }),
    ctx.runQuery(internal.identify.loadContext, { scanId: scan._id }),
  ]);
  const { decision, verifications } = runPipeline({
    query, candidates, venueId: scan.venueId, visit: context.visit ?? undefined, now, inputSize: model.inputSize,
  });
  const top = decision.best;
  const verification = top ? verifications.get(top.candidate.object._id) : undefined;
  const best = top ? {
    objectId: top.candidate.object._id, artworkId: top.candidate.artwork._id,
    probability: top.probability,
    gallery: top.candidate.placement?.venueId === scan.venueId ? top.candidate.placement?.gallery : undefined,
    corners: verification?.verified ? verification.corners ?? undefined : undefined,
  } : undefined;
  const waiting = !force && decision.outcome !== 'confident' &&
    (context.venue?.indexStatus.status === 'queued' || context.venue?.indexStatus.status === 'building');
  await ctx.runMutation(internal.scans.setResult, {
    scanId: scan._id, status: waiting ? 'waiting' : 'identified', outcome: decision.outcome,
    best, runnerUps: decision.runnerUps.map(({ candidate, probability }) => ({
      objectId: candidate.object._id, artworkId: candidate.artwork._id, probability,
    })),
    calibratorVersion: decision.calibratorVersion,
    keepFeatures: waiting ? {
      descriptors: features.descriptors, keypoints: features.keypoints, keypointCount: query.count,
    } : undefined,
  });
  await proposeForScan(ctx, { ...scan, outcome: decision.outcome, best });
  return ctx.runQuery(internal.scans.getDisplay, { scanId: scan._id, deviceId: scan.deviceId });
}

function decodeQuery(descriptors: ArrayBuffer, keypoints: ArrayBuffer): OrbFeatures {
  try {
    return decodeOrbFeatures(descriptors, keypoints);
  } catch (error) {
    if (error instanceof OrbFormatError) throw new ConvexError({ code: 'bad_features' });
    throw error;
  }
}

export const identify = action({
  args: {
    localId: v.string(), vector: v.array(v.number()), descriptors: v.bytes(), keypoints: v.bytes(),
    modelVersion: v.string(), venueId: v.optional(v.id('museums')), visitId: v.optional(v.id('visits')),
    capturedAt: v.number(),
  },
  returns: scanDisplay,
  handler: async (ctx, args): Promise<ScanDisplay> => {
    const device = await requireDeviceFromAction(ctx);
    await limitDevice(ctx, 'identify', device._id);
    const supported = isSupported(args.modelVersion);
    let query: OrbFeatures | undefined;
    if (supported) {
      validateVector(args.vector);
      query = decodeQuery(args.descriptors, args.keypoints);
    }
    const { scanId, existing } = await ctx.runMutation(internal.scans.create, {
      deviceId: device._id, localId: args.localId, venueId: args.venueId, visitId: args.visitId,
      modelVersion: args.modelVersion, vector: args.vector, capturedAt: args.capturedAt,
    });
    const scan = await ctx.runQuery(internal.scans.getStored, { scanId });
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    if (existing && (scan.status === 'identified' || scan.status === 'unsupported_version')) {
      await proposeForScan(ctx, scan);
      return ctx.runQuery(internal.scans.getDisplay, { scanId, deviceId: device._id });
    }
    if (!supported) {
      await ctx.runMutation(internal.scans.setResult, {
        scanId, status: 'unsupported_version', calibratorVersion: DEFAULT_CALIBRATOR.version,
        error: 'Update the app to identify.',
      });
      return ctx.runQuery(internal.scans.getDisplay, { scanId, deviceId: device._id });
    }
    return runScan(ctx, scan, query!, args, false);
  },
});

export const rerunWaiting = internalAction({
  args: { venueId: v.id('museums'), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(internal.scans.listWaiting, args);
    for (const scan of page.page) {
      if (!isSupported(scan.modelVersion)) {
        await ctx.runMutation(internal.scans.setResult, {
          scanId: scan._id, status: 'unsupported_version', calibratorVersion: DEFAULT_CALIBRATOR.version,
          error: 'Update the app to identify.',
        });
        continue;
      }
      if (!scan.descriptors || !scan.keypoints) continue;
      validateVector(scan.vector);
      await runScan(ctx, scan, decodeQuery(scan.descriptors, scan.keypoints), {
        descriptors: scan.descriptors, keypoints: scan.keypoints,
      }, true);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.identify.rerunWaiting, {
      venueId: args.venueId, cursor: page.continueCursor,
    });
    return null;
  },
});

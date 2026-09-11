import { ConvexError, type Infer, v } from 'convex/values';

import model from '../shared/model-version.json';
import { placementProposalPayload } from '../shared/attested-payloads';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalQuery, mutation, type ActionCtx, type MutationCtx } from './_generated/server';
import { requireAttestedWrite } from './devices';
import { requireDeviceFromAction } from './lib/auth';
import { DEFAULT_CALIBRATOR, featureIndex, type ScoredCandidate } from './lib/calibrator';
import { runPipeline } from './lib/identifyPipeline';
import { isSupported, validateVector } from './lib/modelVersion';
import { decodeOrbFeatures, OrbFormatError, type OrbFeatures, type VerifyResult } from './lib/orb';
import { loadCurrentPlacement } from './lib/placements';
import { limitDevice } from './lib/rateLimits';
import { scanDisplay, type ScanDisplay } from './scans';
import schema from './schema';

const loadedCandidate = v.object({
  object: schema.doc('objects'), artwork: schema.doc('artworks'),
  similarity: v.number(), runnerUpSimilarity: v.number(),
  placement: v.union(schema.doc('placements'), v.null()), institution: v.optional(v.string()),
  descriptors: v.optional(v.bytes()), keypoints: v.optional(v.bytes()),
  keypointCount: v.union(v.number(), v.null()), inputSize: v.optional(v.number()),
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
      const placement = await loadCurrentPlacement(ctx, object._id, now);
      candidates.push({
        object, artwork, similarity, runnerUpSimilarity: 0, placement, institution: owner?.name,
        descriptors: descriptors?.descriptors, keypoints: descriptors?.keypoints,
        keypointCount: descriptors?.keypointCount ?? null, inputSize: descriptors?.inputSize,
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
  returns: v.object({ visit: v.union(schema.doc('visits'), v.null()) }),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new ConvexError({ code: 'scan_not_found' });
    const [visit, device] = await Promise.all([
      scan.visitId ? ctx.db.get(scan.visitId) : null,
      ctx.db.get(scan.deviceId),
    ]);
    if (!device || device.banned) throw new ConvexError({ code: 'device_banned' });
    if (scan.visitId && (!visit || visit.deviceId !== scan.deviceId || visit.venueId !== scan.venueId)) {
      throw new ConvexError({ code: 'invalid_visit' });
    }
    return { visit };
  },
});

// Design §4.6: scan evidence never writes `placements`; it accrues on a proposal that a human reviews.
export async function proposePlacementFromScan(ctx: MutationCtx, input: {
  scan: Doc<'scans'>; objectId: Id<'objects'>; proposedVenueId: Id<'museums'>; deviceId: Id<'devices'>;
  beforeWrite?: () => Promise<void>;
}): Promise<null> {
  const { scan, objectId, proposedVenueId, deviceId } = input;
  const object = await ctx.db.get(objectId);
  if (!object || object.reverted || object.mergedInto) throw new ConvexError({ code: 'invalid_scan' });
  const artwork = await ctx.db.get(object.artworkId);
  if (!artwork) throw new ConvexError({ code: 'invalid_scan' });
  const now = Date.now();
  const placement = await loadCurrentPlacement(ctx, objectId, now);
  if (placement?.venueId === proposedVenueId) return null;
  const existing = await ctx.db.query('placementProposals')
    .withIndex('by_object_venue', (q) => q.eq('objectId', objectId).eq('proposedVenueId', proposedVenueId))
    .unique();
  if (existing?.scanIds.includes(scan._id)) return null;
  await input.beforeWrite?.();
  const deviceIds = [...new Set([...(existing?.deviceIds ?? []), deviceId])];
  if (existing) {
    await ctx.db.patch(existing._id, {
      scanIds: [...existing.scanIds, scan._id], deviceIds,
      lastSeenAt: now, readyForReview: deviceIds.length >= 2,
    });
  } else {
    await ctx.db.insert('placementProposals', {
      objectId, proposedVenueId,
      kind: artwork.multiplicity === 'unique' ? 'move' : 'new_object',
      scanIds: [scan._id], deviceIds, firstSeenAt: now, lastSeenAt: now,
      status: 'pending', readyForReview: false,
    });
  }
  return null;
}

export const proposeFromScan = mutation({
  args: {
    scanId: v.id('scans'), nonce: v.string(), assertionBase64: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await requireAttestedWrite(ctx, { ...args, payload: placementProposalPayload(args.scanId) });
    const scan = await ctx.db.get(args.scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId || scan.status !== 'identified' ||
      scan.outcome !== 'confident' || !scan.best) {
      throw new ConvexError({ code: 'invalid_scan' });
    }
    return proposePlacementFromScan(ctx, {
      scan, objectId: scan.best.objectId, proposedVenueId: scan.venueId, deviceId: device._id,
      beforeWrite: () => limitDevice(ctx, 'placementProposal', device._id),
    });
  },
});

function candidateSignals(
  scored: ScoredCandidate<LoadedCandidate>[], verifications: Map<Id<'objects'>, VerifyResult>,
) {
  return scored.map(({ candidate, probability, features }) => {
    const verification = verifications.get(candidate.object._id);
    return {
      objectId: candidate.object._id, similarity: candidate.similarity, margin: features[featureIndex('margin')],
      orbInliers: verification?.inlierCount ?? 0, probability, homographyValid: verification?.verified ?? false,
    };
  });
}

async function runScan(ctx: ActionCtx, scan: Doc<'scans'>, query: OrbFeatures): Promise<ScanDisplay> {
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
  await ctx.runMutation(internal.scans.setResult, {
    scanId: scan._id, generation: scan.generation, status: 'identified', outcome: decision.outcome,
    best, runnerUps: decision.runnerUps.map(({ candidate, probability }) => ({
      objectId: candidate.object._id, artworkId: candidate.artwork._id, probability,
    })),
    candidateSignals: candidateSignals([...(top ? [top] : []), ...decision.runnerUps], verifications),
    calibratorVersion: decision.calibratorVersion,
  });
  return ctx.runQuery(internal.scans.getDisplay, { scanId: scan._id, deviceId: scan.deviceId });
}

export function decodeQuery(descriptors: ArrayBuffer, keypoints: ArrayBuffer): OrbFeatures {
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
    const { scan, existing } = await ctx.runMutation(internal.scans.create, {
      deviceId: device._id, localId: args.localId, venueId: args.venueId, visitId: args.visitId,
      modelVersion: args.modelVersion, vector: args.vector, capturedAt: args.capturedAt,
    });
    const scanId = scan._id;
    if (existing && (scan.modelVersion !== args.modelVersion ||
      scan.status === 'identified' || scan.status === 'unsupported_version')) {
      return ctx.runQuery(internal.scans.getDisplay, { scanId, deviceId: device._id });
    }
    if (!supported) {
      await ctx.runMutation(internal.scans.setResult, {
        scanId, generation: scan.generation, status: 'unsupported_version', calibratorVersion: DEFAULT_CALIBRATOR.version,
        error: 'Update the app to identify.',
      });
      return ctx.runQuery(internal.scans.getDisplay, { scanId, deviceId: device._id });
    }
    return runScan(ctx, scan, query!);
  },
});

import { ConvexError, type Infer, v } from "convex/values";

import { placementProposalPayload } from "../shared/attestation/attested-payloads";
import { MAX_CROP_CANDIDATES } from "../shared/capture/crop-limits";
import { sameOwner } from "../shared/journal/contracts";
import model from "../shared/model/model-version.json";
import { decodeOrbFeatures, OrbFormatError, type OrbFeatures } from "../shared/orb/features";
import type { VerifyResult } from "../shared/orb/verify";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { requireAttestedWrite } from "./devices";
import { mutation } from "./functions";
import { requireDeviceFromAction } from "./lib/auth";
import type { ScoredCandidate } from "./lib/calibrator/calibrate";
import { featureIndex } from "./lib/calibrator/features";
import { DEFAULT_CALIBRATOR } from "./lib/calibrator/weights";
import { bestCropIndex, isNormalizedQuad } from "./lib/cropChoice";
import { MAX_CANDIDATES, MAX_ORB_VERIFICATIONS, runPipeline } from "./lib/identifyPipeline";
import { scheduleMatchFollowUps } from "./lib/matchFollowUps";
import { isSupported, validateVector } from "./lib/modelVersion";
import { readObjectOrb } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { loadOrb } from "./lib/orbStorage";
import { ownerForDevice } from "./lib/ownership";
import type { SearchMatch } from "./lib/pinecone";
import { loadCurrentPlacement } from "./lib/placements";
import { limitDevice } from "./lib/rateLimits";
import { eligibleObject, eligibleVector, recognitionPartition } from "./lib/recognitionEligibility";
import { embeddingArchive } from "./lib/validators";
import { searchVectorIndex } from "./lib/vectorSearch";
import { readVector } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { proposePlacementFromScan } from "./placements";
import { getEmbedding } from "./scanEmbeddings";
import { scanDisplay, type ScanDisplay } from "./scans";
import schema from "./schema";

const loadedCandidate = v.object({
  object: schema.doc("objects"),
  artwork: schema.doc("artworks"),
  similarity: v.number(),
  runnerUpSimilarity: v.number(),
  placement: v.union(schema.doc("placements"), v.null()),
  institution: v.optional(v.string()),
  orbStorageId: v.optional(v.id("files")),
  keypointCount: v.union(v.number(), v.null()),
  inputSize: v.optional(v.number()),
});
export type LoadedCandidate = Infer<typeof loadedCandidate> & {
  descriptors?: ArrayBuffer;
  keypoints?: ArrayBuffer;
};

export const loadCandidates = internalQuery({
  args: {
    recordIds: v.array(v.string()),
    scores: v.array(v.number()),
    venueId: v.optional(v.id("museums")),
    now: v.number(),
  },
  returns: v.array(loadedCandidate),
  handler: async (ctx, { recordIds, scores, now, venueId }): Promise<LoadedCandidate[]> => {
    if (recordIds.length !== scores.length || recordIds.length > 32) {
      throw new ConvexError({ code: "bad_candidates" });
    }
    const byObject = new Map<Id<"objects">, { object: Doc<"objects">; similarity: number }>();
    for (let i = 0; i < recordIds.length; i++) {
      const vectorId = ctx.db.normalizeId("vectors", recordIds[i].split(":", 1)[0]);
      if (!vectorId || !Number.isFinite(scores[i])) continue;
      const vector = await ctx.db.get("vectors", vectorId);
      if (!vector || searchRecordId(vector) !== recordIds[i] || !(await eligibleVector(ctx, vector))) continue;
      let object = await ctx.db.get("objects", vector.objectId);
      if (!object || object.reverted) continue;
      if (object.mergedInto) object = await ctx.db.get("objects", object.mergedInto);
      if (!object || !(await eligibleObject(ctx, object, venueId))) continue;
      const previous = byObject.get(object._id);
      if (!previous || scores[i] > previous.similarity) {
        byObject.set(object._id, { object, similarity: scores[i] });
      }
    }
    const ranked = [...byObject.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 20);
    const candidates: LoadedCandidate[] = [];
    for (const { object, similarity } of ranked) {
      const [artwork, descriptors, owner] = await Promise.all([
        ctx.db.get("artworks", object.artworkId),
        readObjectOrb(ctx, object),
        object.ownerId ? ctx.db.get("museums", object.ownerId) : null,
      ]);
      if (!artwork) continue;
      const placement = await loadCurrentPlacement(ctx, object._id, now);
      candidates.push({
        object,
        artwork,
        similarity,
        runnerUpSimilarity: 0,
        placement,
        institution: owner?.name,
        orbStorageId: descriptors?.storageId,
        keypointCount: descriptors?.keypointCount ?? null,
        inputSize: descriptors?.inputSize,
      });
    }
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].runnerUpSimilarity = candidates[i === 0 ? 1 : 0]?.similarity ?? 0;
    }
    return candidates;
  },
});

export const loadContext = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.object({ visit: v.union(schema.doc("visits"), v.null()), archive: embeddingArchive }),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get("scans", scanId);
    if (!scan) throw new ConvexError({ code: "scan_not_found" });
    const [visit, device, archive] = await Promise.all([
      scan.visitId ? ctx.db.get("visits", scan.visitId) : null,
      ctx.db.get("devices", scan.deviceId),
      getEmbedding(ctx, scan.embeddingId),
    ]);
    if (!device || device.banned) {
      throw new ConvexError({ code: "device_banned" });
    }
    if (scan.visitId && (!visit || !sameOwner(visit.owner, await ownerForDevice(ctx, device)))) {
      throw new ConvexError({ code: "not_found" });
    }
    if (!archive) throw new ConvexError({ code: "scan_not_found" });
    return {
      visit: visit?.venueId === scan.venueId ? visit : null,
      archive: { archiveId: archive.archiveId, contentHash: archive.contentHash },
    };
  },
});

export const proposeFromScan = mutation({
  args: {
    scanId: v.id("scans"),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await requireAttestedWrite(ctx, {
      ...args,
      payload: placementProposalPayload(args.scanId),
    });
    const scan = await ctx.db.get("scans", args.scanId);
    if (
      !scan
      || scan.deviceId !== device._id
      || !scan.venueId
      || scan.status !== "identified"
      || scan.outcome !== "confident"
      || !scan.best
    ) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    return proposePlacementFromScan(ctx, {
      scan,
      objectId: scan.best.objectId,
      proposedVenueId: scan.venueId,
      deviceId: device._id,
      beforeWrite: () => limitDevice(ctx, "placementProposal", device._id),
    });
  },
});

function candidateSignals(scored: ScoredCandidate<LoadedCandidate>[], verifications: Map<Id<"objects">, VerifyResult>) {
  return scored.map(({ candidate, probability, features }) => {
    const verification = verifications.get(candidate.object._id);
    return {
      identityStatus: candidate.object.identityStatus,
      objectId: candidate.object._id,
      similarity: candidate.similarity,
      margin: features[featureIndex("margin")],
      orbInliers: verification?.inlierCount ?? 0,
      probability,
      homographyValid: verification?.verified ?? false,
    };
  });
}

type MatchInput = {
  vector: number[];
  modelVersion: string;
  venueId?: Id<"museums">;
  query: OrbFeatures;
  visit?: Pick<Doc<"visits">, "lastConfidentGallery" | "lastConfidentAt">;
};

export async function matchArtwork(ctx: ActionCtx, input: MatchInput) {
  const search = (venueId?: Id<"museums">) =>
    searchVectorIndex(ctx, input.vector, recognitionPartition(input.modelVersion, venueId), MAX_CANDIDATES);
  const [established, tentative] = await Promise.all([search(), input.venueId ? search(input.venueId) : []]);
  return matchArtworkFromSearch(ctx, input, established, tentative);
}

export async function matchArtworkFromSearch(
  ctx: ActionCtx,
  input: MatchInput,
  established: SearchMatch[],
  tentative: SearchMatch[],
) {
  const now = Date.now();
  const load = (matches: typeof established) =>
    ctx.runQuery(internal.identify.loadCandidates, {
      recordIds: matches.map((match) => match.id),
      scores: matches.map((match) => match.score),
      venueId: input.venueId,
      now,
    });
  const [establishedCandidates, tentativeCandidates] = await Promise.all([load(established), load(tentative)]);
  const candidates = [...establishedCandidates, ...tentativeCandidates];
  const references = [establishedCandidates, tentativeCandidates].flatMap((group) =>
    group.filter((candidate) => candidate.orbStorageId !== undefined).slice(0, MAX_ORB_VERIFICATIONS),
  );
  await Promise.all(
    references.map(async (candidate) => {
      Object.assign(candidate, await loadOrb(ctx, candidate.orbStorageId!, candidate.keypointCount!));
    }),
  );
  const { decision, verifications } = runPipeline({
    query: input.query,
    candidates,
    venueId: input.venueId,
    visit: input.visit,
    now,
    inputSize: model.inputSize,
  });
  const top = decision.best;
  const verification = top ? verifications.get(top.candidate.object._id) : undefined;
  const best = top
    ? {
        identityStatus: top.candidate.object.identityStatus,
        objectId: top.candidate.object._id,
        artworkId: top.candidate.artwork._id,
        probability: top.probability,
        gallery: top.candidate.placement?.venueId === input.venueId ? top.candidate.placement?.gallery : undefined,
        corners: verification?.verified ? (verification.corners ?? undefined) : undefined,
      }
    : undefined;
  return { decision, verifications, best };
}

async function runScan(ctx: ActionCtx, scan: Doc<"scans">, query: OrbFeatures): Promise<ScanDisplay> {
  const { visit, archive } = await ctx.runQuery(internal.identify.loadContext, { scanId: scan._id });
  const { decision, verifications, best } = await matchArtwork(ctx, {
    vector: await readVector(ctx, archive),
    modelVersion: scan.modelVersion,
    venueId: scan.venueId,
    query,
    visit: visit ?? undefined,
  });
  const top = decision.best;
  await ctx.runMutation(internal.scans.setResult, {
    scanId: scan._id,
    generation: scan.generation,
    status: "identified",
    outcome: decision.outcome,
    best,
    runnerUps: decision.runnerUps.map(({ candidate, probability }) => ({
      identityStatus: candidate.object.identityStatus,
      objectId: candidate.object._id,
      artworkId: candidate.artwork._id,
      probability,
    })),
    candidateSignals: candidateSignals([...(top ? [top] : []), ...decision.runnerUps], verifications),
    calibratorVersion: decision.calibratorVersion,
  });
  if (decision.outcome === "confident" && top && best) {
    await scheduleMatchFollowUps(ctx, scan, top.candidate.artwork);
  }
  return ctx.runQuery(internal.scans.getDisplay, {
    scanId: scan._id,
    deviceId: scan.deviceId,
  });
}

export function decodeQuery(descriptors: ArrayBuffer, keypoints: ArrayBuffer): OrbFeatures {
  try {
    return decodeOrbFeatures(descriptors, keypoints);
  } catch (error) {
    if (error instanceof OrbFormatError) {
      throw new ConvexError({ code: "bad_features" });
    }
    throw error;
  }
}

export const rankCrops = action({
  args: {
    vectors: v.array(v.array(v.number())),
    modelVersion: v.string(),
    venueId: v.optional(v.id("museums")),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> =>
    withErrorReporting("identify.rankCrops", async () => {
      const device = await requireDeviceFromAction(ctx);
      await limitDevice(ctx, "rankCrops", device._id);
      if (args.vectors.length < 2 || args.vectors.length > MAX_CROP_CANDIDATES) {
        throw new ConvexError({ code: "bad_candidates" });
      }
      if (!isSupported(args.modelVersion)) return 0;
      for (const vector of args.vectors) validateVector(vector);
      const partitions = [undefined, ...(args.venueId ? [args.venueId] : [])].map((venueId) =>
        recognitionPartition(args.modelVersion, venueId),
      );
      const similarities = await Promise.all(
        args.vectors.map(async (vector) => {
          const candidates = await Promise.all(
            partitions.map(async (partition) => {
              const matches = await searchVectorIndex(ctx, vector, partition, MAX_CANDIDATES);
              return ctx.runQuery(internal.identify.loadCandidates, {
                recordIds: matches.map((match) => match.id),
                scores: matches.map((match) => match.score),
                venueId: args.venueId,
                now: Date.now(),
              });
            }),
          );
          return Math.max(0, ...candidates.flat().map((candidate) => candidate.similarity));
        }),
      );
      return bestCropIndex(similarities);
    }),
});

export const identify = action({
  args: {
    scope: v.string(),
    localId: v.string(),
    vector: v.array(v.number()),
    descriptors: v.bytes(),
    keypoints: v.bytes(),
    modelVersion: v.string(),
    venueId: v.optional(v.id("museums")),
    visitId: v.optional(v.id("visits")),
    capturedAt: v.number(),
    // Optional crop geometry locates the identified region in the source photo.
    cropCorners: v.optional(v.array(v.array(v.number()))),
  },
  returns: scanDisplay,
  handler: async (ctx, args): Promise<ScanDisplay> =>
    withErrorReporting("identify.identify", async () => {
      const device = await requireDeviceFromAction(ctx);
      await limitDevice(ctx, "identify", device._id);
      if (args.cropCorners && !isNormalizedQuad(args.cropCorners)) throw new ConvexError({ code: "bad_crop" });
      const supported = isSupported(args.modelVersion);
      let query: OrbFeatures | undefined;
      if (supported) {
        validateVector(args.vector);
        query = decodeQuery(args.descriptors, args.keypoints);
      }
      const { scan, existing } = await ctx.runAction(internal.scans.create, {
        scope: args.scope,
        deviceId: device._id,
        localId: args.localId,
        venueId: args.venueId,
        visitId: args.visitId,
        modelVersion: args.modelVersion,
        vector: args.vector,
        capturedAt: args.capturedAt,
        cropCorners: args.cropCorners,
      });
      const scanId = scan._id;
      if (
        existing
        && (scan.modelVersion !== args.modelVersion
          || scan.status === "identified"
          || scan.status === "unsupported_version")
      ) {
        return ctx.runQuery(internal.scans.getDisplay, {
          scanId,
          deviceId: device._id,
        });
      }
      if (!supported) {
        await ctx.runMutation(internal.scans.setResult, {
          scanId,
          generation: scan.generation,
          status: "unsupported_version",
          calibratorVersion: DEFAULT_CALIBRATOR.version,
          error: "Update the app to identify.",
        });
        return ctx.runQuery(internal.scans.getDisplay, {
          scanId,
          deviceId: device._id,
        });
      }
      return runScan(ctx, scan, query!);
    }),
});

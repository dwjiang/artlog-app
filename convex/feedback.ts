import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { rejectionPayload } from "../shared/attestation/attested-payloads";
import { normalizeText } from "../shared/catalog/text";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx } from "./_generated/server";
import { requireAttestedWrite } from "./devices";
import { feedbackChanged } from "./feedbackReplay";
import { mutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { patchContributionState } from "./lib/objectContributionState";
import { loadCurrentPlacement } from "./lib/placements";
import { limitDevice } from "./lib/rateLimits";
import { eligibleObject } from "./lib/recognitionEligibility";
import { FLAG_MIN_REJECTIONS, FLAG_REJECT_RATIO, PENALTY_STEP } from "./lib/rejectionPenalty";
import { personMatches } from "./lib/textMatch";
import type { LabelFlow } from "./lib/validators";
import { proposePlacementFromScan } from "./placements";
import { queueMultiView } from "./promotion";
import { insertExpiringEmbedding, requireEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const resolution = v.union(
  v.object({ kind: v.literal("runner_up"), objectId: v.id("objects") }),
  v.object({ kind: v.literal("label"), contributionId: v.id("contributions") }),
);

function candidateIds(scan: Doc<"scans">): Id<"objects">[] {
  return [...(scan.best ? [scan.best.objectId] : []), ...(scan.runnerUps ?? []).map((match) => match.objectId)];
}

export const rejectMatch = mutation({
  args: {
    scanId: v.id("scans"),
    objectId: v.id("objects"),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: v.object({ feedbackId: v.id("feedback"), canResolve: v.boolean() }),
  handler: async (ctx, args) => {
    const { scanId, objectId } = args;
    const device = await requireAttestedWrite(ctx, {
      ...args,
      payload: rejectionPayload(scanId, objectId),
    });
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || scan.status !== "identified" || scan.calibratorVersion === undefined) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const signals = scan.candidateSignals?.find((candidate) => candidate.objectId === objectId);
    const object = await ctx.db.get("objects", objectId);
    if (
      !candidateIds(scan).includes(objectId)
      || !signals
      || !object
      || !(await eligibleObject(ctx, object, scan.venueId))
    ) {
      throw new ConvexError({ code: "invalid_object" });
    }
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_scan_object", (q) => q.eq("scanId", scanId).eq("rejectedObjectId", objectId))
      .unique();
    if (existing) {
      return { feedbackId: existing._id, canResolve: existing.resolution.kind === "unresolved" };
    }
    await limitDevice(ctx, "rejectPerWork", device._id, objectId);
    const now = Date.now();
    const placement = await loadCurrentPlacement(ctx, objectId, now);
    const rejectCount = object.rejectCount + 1;
    const flagged =
      rejectCount >= FLAG_MIN_REJECTIONS && rejectCount / (object.confirmCount + rejectCount) >= FLAG_REJECT_RATIO;
    const penaltyAdded = flagged ? PENALTY_STEP : 0;
    const embeddingId = await insertExpiringEmbedding(ctx, await requireEmbedding(ctx, scan.embeddingId));
    const feedbackId = await ctx.db.insert("feedback", {
      scanId,
      deviceId: device._id,
      embeddingId,
      modelVersion: scan.modelVersion,
      venueId: scan.venueId,
      rejectedObjectId: objectId,
      score: signals.similarity,
      margin: signals.margin,
      orbInliers: signals.orbInliers,
      probability: signals.probability,
      calibratorVersion: scan.calibratorVersion,
      venueMismatch: scan.venueId !== undefined && placement !== null && placement.venueId !== scan.venueId,
      penaltyAdded,
      resolution: { kind: "unresolved" },
    });
    await ctx.db.insert("feedbackEvents", {
      kind: "rejection",
      deviceId: device._id,
      scanId,
      objectId,
      feedbackId,
    });
    await feedbackChanged(ctx, objectId, false);
    await ctx.db.patch("objects", objectId, {
      rejectCount,
      ...(flagged
        ? {
            // Keep uncapped contributions so undoing one rejection preserves the others, even at the cap.
            rejectionPenalty: object.rejectionPenalty + penaltyAdded,
          }
        : {}),
    });
    if (flagged) await patchContributionState(ctx, objectId, { flaggedForReview: true });
    return { feedbackId, canResolve: true };
  },
});

export const resolveRejection = mutation({
  args: { feedbackId: v.id("feedback"), resolution },
  returns: v.null(),
  handler: async (ctx, { feedbackId, resolution }) => {
    const device = await requireDevice(ctx);
    const feedback = await ctx.db.get("feedback", feedbackId);
    if (!feedback || feedback.deviceId !== device._id) {
      throw new ConvexError({ code: "feedback_not_found" });
    }
    if (feedback.resolution.kind !== "unresolved") {
      const same =
        feedback.resolution.kind === resolution.kind
        && (resolution.kind === "runner_up"
          ? feedback.resolution.objectId === resolution.objectId
          : feedback.resolution.contributionId === resolution.contributionId);
      if (!same) throw new ConvexError({ code: "invalid_resolution" });
      return null;
    }
    const scan = await ctx.db.get("scans", feedback.scanId);
    if (!scan) throw new ConvexError({ code: "invalid_scan" });
    if (resolution.kind === "runner_up") {
      const object = await ctx.db.get("objects", resolution.objectId);
      if (
        resolution.objectId === feedback.rejectedObjectId
        || !candidateIds(scan).includes(resolution.objectId)
        || !object
        || object.reverted
        || object.mergedInto
      ) {
        throw new ConvexError({ code: "invalid_resolution" });
      }
      await ctx.db.patch("feedback", feedbackId, { resolution });
      await queueMultiView(ctx, [{ resolution, venueId: feedback.venueId }]);
      if (scan.venueId) {
        await proposePlacementFromScan(ctx, {
          scan,
          objectId: resolution.objectId,
          proposedVenueId: scan.venueId,
          deviceId: device._id,
        });
      }
    } else {
      const contribution = await ctx.db.get("contributions", resolution.contributionId);
      if (!contribution || contribution.deviceId !== device._id || contribution.scanId !== scan._id) {
        throw new ConvexError({ code: "invalid_resolution" });
      }
      await ctx.db.patch("feedback", feedbackId, { resolution });
    }
    return null;
  },
});

// A label naming the rejected work means the user misread; the rejection stops counting.
export async function resolveFalseRejections(ctx: MutationCtx, scan: Doc<"scans">, flow: LabelFlow): Promise<void> {
  const title = flow.fields.title?.value;
  const artist = flow.fields.artist?.value;
  if (flow.stage !== "verified" || !title || !artist) return;
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return;
  for await (const row of ctx.db.query("feedback").withIndex("by_scan_object", (q) => q.eq("scanId", scan._id))) {
    if (row.resolution.kind !== "unresolved") continue;
    const object = await ctx.db.get("objects", row.rejectedObjectId);
    const artwork = object ? await ctx.db.get("artworks", object.artworkId) : null;
    if (
      !object
      || !artwork
      || normalizedTitle !== normalizeText(artwork.title)
      || !personMatches(artist, artwork.artist)
    ) {
      continue;
    }
    await ctx.db.patch("feedback", row._id, { resolution: { kind: "false_rejection" } });
    await feedbackChanged(ctx, object._id);
    await ctx.db.patch("objects", object._id, {
      rejectCount: Math.max(0, object.rejectCount - 1),
      rejectionPenalty: Math.max(0, object.rejectionPenalty - row.penaltyAdded),
    });
  }
}

export const exportForTraining = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(schema.doc("feedback")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("feedback").withIndex("by_rejectedObjectId").paginate(paginationOpts);
    const page = [];
    for (const row of result.page) {
      const device = await ctx.db.get("devices", row.deviceId);
      const object = await ctx.db.get("objects", row.rejectedObjectId);
      if (
        !device
        || device.banned
        || !object
        || object.identityStatus !== "established"
        || !(await eligibleObject(ctx, object))
      ) {
        continue;
      }
      if (row.resolution.kind === "label") continue;
      if (row.resolution.kind === "runner_up") {
        const resolved = row.resolution.objectId ? await ctx.db.get("objects", row.resolution.objectId) : null;
        if (!resolved || resolved.identityStatus !== "established" || !(await eligibleObject(ctx, resolved))) {
          continue;
        }
      }
      page.push(row);
    }
    return {
      page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

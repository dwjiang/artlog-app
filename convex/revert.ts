import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "./_generated/server";
import { removeContribution } from "./contributionRemoval";
import { clearDocent } from "./docent";
import { feedbackChanged } from "./feedbackReplay";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { patchArtworkContent } from "./lib/artworkContent";
import { revokeContributionMedia } from "./lib/displayMedia";
import { fileStorage } from "./lib/fileStorage";
import { patchObjectDetails, readObjectDetails, readObjectOrb } from "./lib/objectDetails";
import { deleteOrbIfUnreferenced } from "./lib/orbStorage";
import { deleteVector } from "./lib/vectorStore";
import { readyForReview, reassessProposal } from "./placements";
import { queueMultiView } from "./promotion";
import { deleteEmbedding } from "./scanEmbeddings";
import schema from "./schema";

// Outer cascades select small pages; each object's child tables are cleaned in separate transactions.
const CHUNK = 25;
const CHUNK_BYTES = 2 * 1024 * 1024;
const cursorArg = v.union(v.string(), v.null());
const cleanupPhase = v.union(
  v.literal("vectors"),
  v.literal("descriptors"),
  v.literal("placements"),
  v.literal("contributions"),
);

export async function beginRevert(ctx: MutationCtx, object: Doc<"objects">, reason: string): Promise<void> {
  if (object.reverted) return;
  await ctx.db.patch("objects", object._id, {
    reverted: true,
    revertedReason: reason,
  });
  const details = await readObjectDetails(ctx, object);
  await patchObjectDetails(ctx, object, {
    thumbnailStorageId: undefined,
    ...(details?.thumbnailStorageId ? { imageRef: undefined } : {}),
  });
  if (details?.thumbnailStorageId && (await fileStorage.getMetadata(ctx, details.thumbnailStorageId))) {
    await fileStorage.delete(ctx, details.thumbnailStorageId);
  }
}

export const beginObjectRevert = internalMutation({
  args: { objectId: v.id("objects"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { objectId, reason }) => {
    const object = await ctx.db.get("objects", objectId);
    if (!object) throw new ConvexError({ code: "object_not_found" });
    await beginRevert(ctx, object, reason);
    return null;
  },
});

export const cleanupObjectPage = internalMutation({
  args: { objectId: v.id("objects"), phase: cleanupPhase, cursor: cursorArg },
  returns: cursorArg,
  handler: async (ctx, { objectId, phase, cursor }) => {
    const object = await ctx.db.get("objects", objectId);
    if (!object?.reverted) {
      throw new ConvexError({ code: "object_not_reverted" });
    }
    const options = { cursor, numItems: 64, maximumBytesRead: 1024 * 1024 };
    switch (phase) {
      case "vectors": {
        const page = await ctx.db
          .query("vectors")
          .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
          .paginate(options);
        for (const row of page.page) await deleteVector(ctx, row);
        await bumpCounter(ctx, "vectors", -page.page.length);
        return page.isDone ? null : page.continueCursor;
      }
      case "descriptors": {
        const reference = await readObjectOrb(ctx, object);
        if (reference) {
          await patchObjectDetails(ctx, object, { orb: undefined });
          await deleteOrbIfUnreferenced(ctx, reference.storageId);
          await bumpCounter(ctx, "descriptors", -1);
        }
        return null;
      }
      case "placements": {
        const page = await ctx.db
          .query("placements")
          .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
          .paginate(options);
        for (const row of page.page) {
          if (row.closedAt === undefined) {
            await ctx.db.patch("placements", row._id, { closedAt: Date.now() });
          }
        }
        return page.isDone ? null : page.continueCursor;
      }
      case "contributions": {
        const page = await ctx.db
          .query("contributions")
          .withIndex("by_object_device", (q) => q.eq("indexedObjectId", objectId))
          .paginate(options);
        for (const row of page.page) {
          await removeContribution(ctx, row, "object_reverted");
        }
        return page.isDone ? null : page.continueCursor;
      }
    }
  },
});

export const revertObjectById = internalAction({
  args: { objectId: v.id("objects"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { objectId, reason }) => {
    await ctx.runMutation(internal.revert.beginObjectRevert, {
      objectId,
      reason,
    });
    // Restarting after an interrupted action is safe: deletion, closing and rejection are idempotent.
    for (const phase of ["vectors", "descriptors", "placements", "contributions"] as const) {
      let cursor: string | null = null;
      do {
        cursor = await ctx.runMutation(internal.revert.cleanupObjectPage, {
          objectId,
          phase,
          cursor,
        });
      } while (cursor !== null);
    }
    await ctx.runMutation(internal.revert.completeObjectRevert, { objectId });
    return null;
  },
});

export const completeObjectRevert = internalMutation({
  args: { objectId: v.id("objects") },
  returns: v.null(),
  handler: async (ctx, { objectId }) => {
    await ctx.db.patch("objects", objectId, { revertCompletedAt: Date.now() });
    return null;
  },
});

function paging(cursor: string | null) {
  return { cursor, numItems: CHUNK, maximumBytesRead: CHUNK_BYTES };
}

export async function resetMultiView(ctx: MutationCtx, row: Doc<"feedback">): Promise<number> {
  const vector = row.multiViewVectorId ? await ctx.db.get("vectors", row.multiViewVectorId) : null;
  if (vector) {
    await deleteVector(ctx, vector);
    await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
      vectorId: vector._id,
      cursor: null,
    });
  }
  await ctx.db.patch("feedback", row._id, {
    multiViewAt: undefined,
    multiViewVectorId: undefined,
    multiViewDuplicateVectorId: undefined,
    multiViewAgreement: undefined,
  });
  return Number(vector !== null);
}

export const requeueDuplicateViews = internalMutation({
  args: { vectorId: v.id("vectors"), cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { vectorId, cursor }) => {
    const page = await ctx.db
      .query("feedback")
      .withIndex("by_multiViewDuplicateVectorId", (q) => q.eq("multiViewDuplicateVectorId", vectorId))
      .paginate(paging(cursor));
    for (const row of page.page) await resetMultiView(ctx, row);
    await queueMultiView(ctx, page.page);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
        vectorId,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

const NEXT_PHASE = {
  contributions: "scans",
  scans: "proposals",
  proposals: "feedback",
  feedback: "firstWitness",
  firstWitness: "secondWitness",
  secondWitness: "settling",
  settling: "complete",
  stalled: "settling",
  complete: "complete",
} as const;
// Settling waits on other jobs. Doubling the delay keeps a job that never finishes from spinning this
// one; after ~20 minutes without progress the job parks for an operator to re-run revertDevice.
const SETTLE_MAX_DELAY_MS = 60_000;
const MAX_SETTLE_ATTEMPTS = 30;

export const revertDevice = internalMutation({
  args: { deviceId: v.id("devices"), reason: v.string() },
  returns: v.id("deviceRemovals"),
  handler: async (ctx, { deviceId, reason }) => {
    const device = await ctx.db.get("devices", deviceId);
    if (!device) throw new ConvexError({ code: "device_not_found" });
    await ctx.db.patch("devices", deviceId, { banned: true, bannedReason: reason });
    const existing = await ctx.db
      .query("deviceRemovals")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (existing) {
      if (existing.phase !== "complete") {
        await ctx.db.patch("deviceRemovals", existing._id, {
          resumeRevision: existing.resumeRevision + 1,
          ...(existing.phase === "stalled" ? { phase: "settling", settleAttempts: 0 } : {}),
        });
        await ctx.scheduler.runAfter(0, internal.revert.cleanupDevicePage, {
          jobId: existing._id,
        });
      }
      return existing._id;
    }
    const jobId = await ctx.db.insert("deviceRemovals", {
      deviceId,
      reason,
      phase: "contributions",
      cursor: null,
      processed: 0,
      settled: 0,
      settleAttempts: 0,
      resumeRevision: 0,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.revert.cleanupDevicePage, {
      jobId,
    });
    return jobId;
  },
});

export const cleanupDevicePage = internalMutation({
  args: { jobId: v.id("deviceRemovals") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("deviceRemovals", jobId);
    if (!job || job.phase === "complete") return null;
    const device = await ctx.db.get("devices", job.deviceId);
    if (!device?.banned) throw new ConvexError({ code: "device_not_banned" });
    const { deviceId } = job;
    const options = paging(job.cursor);
    let nextCursor: string | null = null;
    let processed = 0;
    if (job.phase === "settling" || job.phase === "stalled") {
      const dependencies = await ctx.db
        .query("removalDependencies")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .take(CHUNK);
      let settled = 0;
      for (const dependency of dependencies) {
        // A resumed job re-schedules whatever each unsettled dependency is waiting on, since the
        // original scheduled work may have been lost.
        const retry = (dependency.resumeRevision ?? 0) < job.resumeRevision;
        if (retry) {
          await ctx.db.patch("removalDependencies", dependency._id, {
            resumeRevision: job.resumeRevision,
          });
        }
        if (dependency.objectId) {
          const entryRebuild = await ctx.db
            .query("entryRebuilds")
            .withIndex("by_object", (q) => q.eq("objectId", dependency.objectId!))
            .first();
          const feedbackRebuild = await ctx.db
            .query("feedbackRebuilds")
            .withIndex("by_object", (q) => q.eq("objectId", dependency.objectId!))
            .first();
          if (entryRebuild || feedbackRebuild) {
            if (retry && entryRebuild) {
              await ctx.scheduler.runAfter(0, internal.contributionRemoval.rebuildPage, {
                jobId: entryRebuild._id,
              });
            }
            if (retry && feedbackRebuild) {
              await ctx.scheduler.runAfter(0, internal.feedbackReplay.rebuildPage, {
                jobId: feedbackRebuild._id,
              });
            }
            continue;
          }
          const object = await ctx.db.get("objects", dependency.objectId);
          if (object?.reverted && object.revertCompletedAt === undefined) {
            if (retry) {
              await ctx.scheduler.runAfter(0, internal.revert.revertObjectById, {
                objectId: object._id,
                reason: object.revertedReason ?? job.reason,
              });
            }
            continue;
          }
        }
        if (
          dependency.contributionId
          && (await ctx.db
            .query("mediaAssets")
            .withIndex("by_contribution_revoked", (q) =>
              q.eq("provenance.contributionId", dependency.contributionId).eq("revokedAt", undefined),
            )
            .first())
        ) {
          if (retry) {
            await revokeContributionMedia(ctx, dependency.contributionId);
          }
          continue;
        }
        if (dependency.feedbackId) {
          const row = await ctx.db.get("feedback", dependency.feedbackId);
          if (
            row?.multiViewAgreement
            && [row.multiViewAgreement.firstDeviceId, row.multiViewAgreement.secondDeviceId].includes(deviceId)
          ) {
            if (retry) {
              await ctx.scheduler.runAfter(0, internal.promotion.reassessView, {
                feedbackId: row._id,
              });
            }
            continue;
          }
        }
        if (
          dependency.vectorId
          && (await ctx.db
            .query("feedback")
            .withIndex("by_multiViewDuplicateVectorId", (q) => q.eq("multiViewDuplicateVectorId", dependency.vectorId))
            .first())
        ) {
          if (retry) {
            await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
              vectorId: dependency.vectorId,
              cursor: null,
            });
          }
          continue;
        }
        if (
          dependency.scanId
          && (await ctx.db
            .query("vectors")
            .withIndex("by_scanId", (q) => q.eq("scanId", dependency.scanId))
            .first())
        ) {
          if (retry) {
            await ctx.scheduler.runAfter(0, internal.revert.cleanupScanVectors, {
              scanId: dependency.scanId,
              jobId,
              cursor: null,
            });
          }
          continue;
        }
        if (dependency.proposalId) {
          const proposal = await ctx.db.get("placementProposals", dependency.proposalId);
          if (
            proposal?.status === "promoted"
            && !readyForReview(proposal.deviceIds, proposal.firstSeenAt, proposal.lastSeenAt)
          ) {
            if (proposal.revertedAt === undefined) {
              if (retry) await reassessProposal(ctx, proposal._id);
              continue;
            }
            const placement = proposal.promotion
              ? await ctx.db.get("placements", proposal.promotion.placementId)
              : null;
            const object =
              proposal.kind === "new_object" && placement ? await ctx.db.get("objects", placement.objectId) : null;
            if (object && object.revertCompletedAt === undefined) {
              if (retry) {
                await ctx.scheduler.runAfter(0, internal.revert.revertObjectById, {
                  objectId: object._id,
                  reason: "proposal_evidence_removed",
                });
              }
              continue;
            }
          }
        }
        await ctx.db.delete("removalDependencies", dependency._id);
        settled++;
      }
      const done = dependencies.length === 0;
      const settleAttempts = settled || done ? 0 : job.settleAttempts + 1;
      const stalled = !done && settleAttempts >= MAX_SETTLE_ATTEMPTS;
      await ctx.db.patch("deviceRemovals", jobId, {
        settled: job.settled + settled,
        settleAttempts,
        phase: done ? "complete" : stalled ? "stalled" : "settling",
        completedAt: done ? Date.now() : undefined,
      });
      if (!done && !stalled) {
        await ctx.scheduler.runAfter(
          Math.min(SETTLE_MAX_DELAY_MS, 100 * 2 ** settleAttempts),
          internal.revert.cleanupDevicePage,
          { jobId },
        );
      }
      return null;
    }
    if (job.phase === "contributions") {
      const page = await ctx.db
        .query("contributions")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .paginate(options);
      for (const row of page.page) {
        await removeContribution(ctx, row, "device_reverted");
        await ctx.db.insert("removalDependencies", {
          jobId,
          contributionId: row._id,
          objectId: row.indexedObjectId,
        });
      }
      nextCursor = page.isDone ? null : page.continueCursor;
      processed = page.page.length;
    } else if (job.phase === "scans") {
      const page = await ctx.db
        .query("scans")
        .withIndex("by_device_localId", (q) => q.eq("deviceId", deviceId))
        .paginate(options);
      for (const scan of page.page) {
        await ctx.scheduler.runAfter(0, internal.revert.cleanupScanVectors, {
          scanId: scan._id,
          jobId,
          cursor: null,
        });
        await ctx.db.insert("removalDependencies", { jobId, scanId: scan._id });
      }
      nextCursor = page.isDone ? null : page.continueCursor;
      processed = page.page.length;
    } else if (job.phase === "proposals") {
      const page = await ctx.db
        .query("proposalEvidence")
        .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
        .paginate(options);
      for (const link of page.page) {
        await reassessProposal(ctx, link.proposalId);
        await ctx.db.insert("removalDependencies", {
          jobId,
          proposalId: link.proposalId,
        });
      }
      nextCursor = page.isDone ? null : page.continueCursor;
      processed = page.page.length;
    } else if (job.phase === "feedback") {
      const page = await ctx.db
        .query("feedbackEvents")
        .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
        .paginate(options);
      for (const event of page.page) {
        await feedbackChanged(ctx, event.objectId);
        await ctx.db.insert("removalDependencies", {
          jobId,
          objectId: event.objectId,
        });
      }
      nextCursor = page.isDone ? null : page.continueCursor;
      processed = page.page.length;
    } else {
      const query =
        job.phase === "firstWitness"
          ? ctx.db
              .query("feedback")
              .withIndex("by_multiViewFirstDevice", (q) => q.eq("multiViewAgreement.firstDeviceId", deviceId))
          : ctx.db
              .query("feedback")
              .withIndex("by_multiViewSecondDevice", (q) => q.eq("multiViewAgreement.secondDeviceId", deviceId));
      const page = await query.paginate(options);
      for (const row of page.page) {
        await ctx.scheduler.runAfter(0, internal.promotion.reassessView, {
          feedbackId: row._id,
        });
        await ctx.db.insert("removalDependencies", {
          jobId,
          feedbackId: row._id,
        });
      }
      nextCursor = page.isDone ? null : page.continueCursor;
      processed = page.page.length;
    }
    const phase = nextCursor === null ? NEXT_PHASE[job.phase] : job.phase;
    await ctx.db.patch("deviceRemovals", jobId, {
      phase,
      cursor: nextCursor,
      processed: job.processed + processed,
      completedAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.revert.cleanupDevicePage, {
      jobId,
    });
    return null;
  },
});

export const cleanupScanVectors = internalMutation({
  args: {
    scanId: v.id("scans"),
    jobId: v.id("deviceRemovals"),
    cursor: cursorArg,
  },
  returns: v.null(),
  handler: async (ctx, { scanId, jobId, cursor }) => {
    const scan = await ctx.db.get("scans", scanId);
    if (scan) await deleteEmbedding(ctx, scan.embeddingId);
    for (const feedback of await ctx.db
      .query("feedback")
      .withIndex("by_scan_object", (q) => q.eq("scanId", scanId))
      .take(32)) {
      await deleteEmbedding(ctx, feedback.embeddingId);
    }
    const page = await ctx.db
      .query("vectors")
      .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
      .paginate(paging(cursor));
    for (const vector of page.page) {
      await deleteVector(ctx, vector);
      await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
        vectorId: vector._id,
        cursor: null,
      });
      await ctx.db.insert("removalDependencies", {
        jobId,
        vectorId: vector._id,
      });
    }
    await bumpCounter(ctx, "vectors", -page.page.length);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.revert.cleanupScanVectors, {
        scanId,
        jobId,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

export const removalProgress = internalQuery({
  args: { deviceId: v.id("devices") },
  returns: v.union(schema.doc("deviceRemovals"), v.null()),
  handler: (ctx, { deviceId }) =>
    ctx.db
      .query("deviceRemovals")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique(),
});

const rightsTarget = v.union(
  v.object({
    kind: v.literal("venue"),
    venueId: v.id("museums"),
    optOutId: v.id("optOuts"),
  }),
  v.object({
    kind: v.literal("artwork"),
    artworkId: v.id("artworks"),
    takedownId: v.id("takedowns"),
  }),
  v.object({ kind: v.literal("object"), takedownId: v.id("takedowns") }),
);

export const completeRightsRequest = internalMutation({
  args: { target: rightsTarget },
  returns: v.null(),
  handler: async (ctx, { target }) => {
    const applied = { appliedAt: Date.now() };
    if (target.kind === "venue") await ctx.db.patch("optOuts", target.optOutId, applied);
    else await ctx.db.patch("takedowns", target.takedownId, applied);
    return null;
  },
});

export const revertRightsObjects = internalAction({
  args: {
    objectIds: v.array(v.id("objects")),
    proposalIds: v.array(v.id("placementProposals")),
    target: rightsTarget,
    cursor: cursorArg,
  },
  returns: v.null(),
  handler: async (ctx, { objectIds, proposalIds, target, cursor }) => {
    const reason = target.kind === "venue" ? `opt_out: ${target.venueId}` : `takedown: ${target.takedownId}`;
    for (const proposalId of proposalIds) {
      await ctx.runMutation(internal.placements.revertMove, { proposalId });
    }
    for (const objectId of objectIds) {
      await ctx.runAction(internal.revert.revertObjectById, {
        objectId,
        reason,
      });
    }
    if (cursor === null) {
      await ctx.runMutation(internal.revert.completeRightsRequest, { target });
    } else if (target.kind === "venue") {
      await ctx.scheduler.runAfter(0, internal.revert.revertVenueObjects, {
        venueId: target.venueId,
        optOutId: target.optOutId,
        cursor,
      });
    } else if (target.kind === "artwork") {
      await ctx.scheduler.runAfter(0, internal.revert.revertArtworkObjects, {
        artworkId: target.artworkId,
        takedownId: target.takedownId,
        cursor,
      });
    }
    return null;
  },
});

export const applyOptOut = internalMutation({
  args: { venueId: v.id("museums"), requester: v.string() },
  returns: v.id("optOuts"),
  handler: async (ctx, { venueId, requester }) => {
    const venue = await ctx.db.get("museums", venueId);
    if (!venue) throw new ConvexError({ code: "venue_not_found" });
    const optOutId = await ctx.db.insert("optOuts", {
      target: { kind: "venue", venueId },
      requester,
      receivedAt: Date.now(),
    });
    await ctx.db.patch("museums", venueId, { optOut: true });
    await ctx.scheduler.runAfter(0, internal.revert.revertVenueFeedback, {
      venueId,
      optOutId,
      cursor: null,
    });
    return optOutId;
  },
});

export const revertVenueFeedback = internalMutation({
  args: {
    venueId: v.id("museums"),
    optOutId: v.id("optOuts"),
    cursor: cursorArg,
  },
  returns: v.null(),
  handler: async (ctx, { venueId, optOutId, cursor }) => {
    const page = await ctx.db
      .query("feedback")
      .withIndex("by_venueId", (q) => q.eq("venueId", venueId))
      .paginate(paging(cursor));
    let deleted = 0;
    for (const row of page.page) {
      deleted += await resetMultiView(ctx, row);
      await ctx.db.patch("feedback", row._id, { multiViewAt: Date.now() });
    }
    await bumpCounter(ctx, "vectors", -deleted);
    if (page.isDone) {
      await ctx.scheduler.runAfter(0, internal.revert.revertVenueObjects, {
        venueId,
        optOutId,
        cursor: null,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.revert.revertVenueFeedback, {
        venueId,
        optOutId,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});

export const revertVenueObjects = internalMutation({
  args: {
    venueId: v.id("museums"),
    optOutId: v.id("optOuts"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { venueId, optOutId, cursor }) => {
    const page = await ctx.db
      .query("placements")
      .withIndex("by_venueId", (q) => q.eq("venueId", venueId))
      .paginate(paging(cursor));
    const objectIds: Id<"objects">[] = [];
    const proposalIds: Id<"placementProposals">[] = [];
    for (const placement of page.page) {
      const object = await ctx.db.get("objects", placement.objectId);
      if (object?.source === "user") objectIds.push(object._id);
      if (placement.proposalId) proposalIds.push(placement.proposalId);
    }
    await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
      objectIds: [...new Set(objectIds)],
      proposalIds: [...new Set(proposalIds)],
      target: { kind: "venue", venueId, optOutId },
      cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

export const applyTakedown = internalMutation({
  args: {
    target: v.union(
      v.object({ kind: v.literal("artwork"), artworkId: v.id("artworks") }),
      v.object({ kind: v.literal("object"), objectId: v.id("objects") }),
    ),
    requester: v.string(),
  },
  returns: v.id("takedowns"),
  handler: async (ctx, { target, requester }) => {
    const now = Date.now();
    if (target.kind === "object") {
      const { objectId } = target;
      const object = await ctx.db.get("objects", objectId);
      if (!object) throw new ConvexError({ code: "object_not_found" });
      const takedownId = await ctx.db.insert("takedowns", {
        target: { kind: "object", objectId, identityArtworkId: object.artworkId, venueId: object.ownerId },
        requester,
        receivedAt: now,
      });
      await beginRevert(ctx, object, `takedown: ${takedownId}`);
      await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
        objectIds: [object._id],
        proposalIds: [],
        target: { kind: "object", takedownId },
        cursor: null,
      });
      return takedownId;
    }
    const artwork = await ctx.db.get("artworks", target.artworkId);
    if (!artwork) throw new ConvexError({ code: "artwork_not_found" });
    const takedownId = await ctx.db.insert("takedowns", {
      target: { kind: "artwork", artworkId: artwork._id },
      requester,
      receivedAt: now,
    });
    await clearDocent(ctx, artwork);
    await patchArtworkContent(ctx, artwork, { factSheet: undefined });
    // The hold keeps enrichment from regenerating the sheet; review.replaceFactSheet lifts it deliberately.
    await ctx.db.patch("artworks", artwork._id, {
      factSheetUpdatedAt: undefined,
      factSheetNeedsReview: true,
    });
    await ctx.scheduler.runAfter(0, internal.revert.revertArtworkObjects, {
      artworkId: artwork._id,
      takedownId,
      cursor: null,
    });
    return takedownId;
  },
});

export const revertArtworkObjects = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    takedownId: v.id("takedowns"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, takedownId, cursor }) => {
    const page = await ctx.db
      .query("objects")
      .withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))
      .paginate(paging(cursor));
    await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
      objectIds: page.page.map((object) => object._id),
      proposalIds: [],
      target: { kind: "artwork", artworkId, takedownId },
      cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

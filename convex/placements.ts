import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { bumpCounter } from "./ingest";
import { validateVector } from "./lib/modelVersion";
import { currentPlacement, loadCurrentPlacement } from "./lib/placements";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { proposalStatus } from "./lib/validators";
import { insertVector } from "./lib/vectorStore";
import { isVenueOptedOut } from "./lib/venueOptOut";
import { requireEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const DAY = 86_400_000;
const MAX_EVIDENCE_SCANS = 6;
const MAX_CLOSED_PLACEMENTS = 100;

export function readyForReview(deviceIds: Id<"devices">[], firstSeenAt: number, lastSeenAt: number): boolean {
  const devices = new Set(deviceIds).size;
  return devices >= 3 || (devices >= 2 && lastSeenAt - firstSeenAt >= DAY);
}

function summarizeEvidence(scans: Doc<"scans">[]) {
  const deviceIds = [...new Set(scans.map((scan) => scan.deviceId))];
  const firstSeenAt = scans.length > 0 ? Math.min(...scans.map((scan) => scan.createdAt)) : 0;
  const lastSeenAt = scans.length > 0 ? Math.max(...scans.map((scan) => scan.createdAt)) : 0;
  return {
    deviceIds,
    firstSeenAt,
    lastSeenAt,
    readyForReview: readyForReview(deviceIds, firstSeenAt, lastSeenAt),
  };
}

function retainEvidence(scans: Doc<"scans">[]): Doc<"scans">[] {
  const byDevice = new Map<Id<"devices">, { first: Doc<"scans">; last: Doc<"scans"> }>();
  for (const scan of scans) {
    const previous = byDevice.get(scan.deviceId);
    if (!previous) {
      byDevice.set(scan.deviceId, { first: scan, last: scan });
    } else {
      if (scan.createdAt < previous.first.createdAt) previous.first = scan;
      if (scan.createdAt > previous.last.createdAt) previous.last = scan;
    }
  }
  return [...byDevice.values()].flatMap(({ first, last }) => (first._id === last._id ? [first] : [first, last]));
}

async function isValidEvidence(
  ctx: QueryCtx,
  scan: Doc<"scans">,
  objectId: Id<"objects">,
  venueId: Id<"museums">,
): Promise<boolean> {
  const object = await ctx.db.get("objects", objectId);
  if (!object || object.identityStatus !== "established") return false;
  if (scan.venueId !== venueId || scan.status !== "identified") return false;
  const device = await ctx.db.get("devices", scan.deviceId);
  if (!device || device.banned) return false;
  const feedback = await ctx.db
    .query("feedback")
    .withIndex("by_scan_object", (q) => q.eq("scanId", scan._id))
    .take(33);
  const rejected = feedback.some(
    (row) => row.rejectedObjectId === objectId && row.resolution.kind !== "false_rejection",
  );
  const resolved = feedback.some((row) => row.resolution.kind === "runner_up" && row.resolution.objectId === objectId);
  const confident = scan.outcome === "confident" && scan.best?.objectId === objectId;
  return feedback.length <= 32 && !rejected && (confident || resolved);
}

async function loadValidEvidence(
  ctx: QueryCtx,
  scanIds: Id<"scans">[],
  objectId: Id<"objects">,
  venueId: Id<"museums">,
): Promise<Doc<"scans">[]> {
  const scans: Doc<"scans">[] = [];
  for (const scanId of new Set(scanIds)) {
    const scan = await ctx.db.get("scans", scanId);
    if (scan && (await isValidEvidence(ctx, scan, objectId, venueId))) {
      scans.push(scan);
    }
  }
  return scans;
}

// Callers have verified either an attested confident scan or its owner's rejection resolution.
export async function proposePlacementFromScan(
  ctx: MutationCtx,
  input: {
    scan: Doc<"scans">;
    objectId: Id<"objects">;
    proposedVenueId: Id<"museums">;
    deviceId: Id<"devices">;
    beforeWrite?: () => Promise<void>;
  },
): Promise<null> {
  const { scan, objectId, proposedVenueId, deviceId } = input;
  const object = await ctx.db.get("objects", objectId);
  if (
    !object
    || object.reverted
    || object.mergedInto
    || scan.deviceId !== deviceId
    || scan.venueId !== proposedVenueId
  ) {
    throw new ConvexError({ code: "invalid_scan" });
  }
  if (object.identityStatus !== "established") return null;
  const artwork = await ctx.db.get("artworks", object.artworkId);
  if (!artwork) throw new ConvexError({ code: "invalid_scan" });
  const venue = await ctx.db.get("museums", proposedVenueId);
  if (!venue || (await isVenueOptedOut(ctx, venue))) {
    throw new ConvexError({ code: "invalid_venue" });
  }
  const now = Date.now();
  const placement = await loadCurrentPlacement(ctx, objectId, now);
  if (placement?.venueId === proposedVenueId) return null;
  const existing = await ctx.db
    .query("placementProposals")
    .withIndex("by_object_venue", (q) => q.eq("objectId", objectId).eq("proposedVenueId", proposedVenueId))
    .unique();
  if (existing && existing.status !== "pending") return null;
  if ((existing?.scanIds.length ?? 0) > MAX_EVIDENCE_SCANS) {
    throw new ConvexError({ code: "invalid_proposal_evidence" });
  }
  const scans = await loadValidEvidence(ctx, existing?.scanIds ?? [], objectId, proposedVenueId);
  // Freeze valid agreement, but let fresh scans replace withdrawn or missing evidence.
  if (
    !summarizeEvidence(scans).readyForReview
    && !scans.some((row) => row._id === scan._id)
    && (await isValidEvidence(ctx, scan, objectId, proposedVenueId))
  ) {
    scans.push(scan);
  }
  const retained = retainEvidence(scans);
  const scanIds = retained.map((row) => row._id);
  if (!existing && scanIds.length === 0) return null;
  if (existing && scanIds.length === existing.scanIds.length && scanIds.every((id, i) => id === existing.scanIds[i])) {
    return null;
  }
  const evidence = summarizeEvidence(retained);
  await input.beforeWrite?.();
  const kind = artwork.multiplicity === "unique" ? "move" : "new_object";
  const proposalId =
    existing?._id
    ?? (await ctx.db.insert("placementProposals", {
      objectId,
      proposedVenueId,
      kind,
      scanIds,
      ...evidence,
      status: "pending",
    }));
  if (existing) {
    await ctx.db.patch("placementProposals", existing._id, { kind, scanIds, ...evidence });
  }
  const links = await ctx.db
    .query("proposalEvidence")
    .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
    .take(MAX_EVIDENCE_SCANS);
  for (const link of links) await ctx.db.delete("proposalEvidence", link._id);
  for (const scan of retained) {
    await ctx.db.insert("proposalEvidence", {
      proposalId,
      deviceId: scan.deviceId,
      scanId: scan._id,
    });
  }
  return null;
}

export const reviewPlacement = internalMutation({
  args: {
    proposalId: v.id("placementProposals"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    reviewer: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { proposalId, decision, reviewer }) => {
    if (!reviewer.trim()) throw new ConvexError({ code: "reviewer_required" });
    const proposal = await ctx.db.get("placementProposals", proposalId);
    if (!proposal) throw new ConvexError({ code: "proposal_not_found" });
    const status = decision === "approve" ? "promoted" : "rejected";
    if (proposal.status !== "pending") {
      if (proposal.status === status) return null;
      throw new ConvexError({ code: "proposal_already_reviewed" });
    }
    const now = Date.now();
    let promotion: Doc<"placementProposals">["promotion"];
    if (decision === "approve") {
      if (proposal.scanIds.length > MAX_EVIDENCE_SCANS || proposal.deviceIds.length > 3) {
        throw new ConvexError({ code: "invalid_proposal_evidence" });
      }
      const object = await ctx.db.get("objects", proposal.objectId);
      if (!object || object.reverted || object.mergedInto) {
        throw new ConvexError({ code: "object_not_found" });
      }
      const artwork = await ctx.db.get("artworks", object.artworkId);
      if (!artwork) throw new ConvexError({ code: "artwork_not_found" });
      if (proposal.kind !== (artwork.multiplicity === "unique" ? "move" : "new_object")) {
        throw new ConvexError({ code: "proposal_kind_changed" });
      }
      const venue = await ctx.db.get("museums", proposal.proposedVenueId);
      if (!venue || (await isVenueOptedOut(ctx, venue))) {
        throw new ConvexError({ code: "invalid_venue" });
      }
      const deviceIds = [...new Set(proposal.deviceIds)];
      const scans = await loadValidEvidence(ctx, proposal.scanIds, object._id, venue._id);
      if (
        scans.length !== new Set(proposal.scanIds).size
        || scans.some((scan) => !deviceIds.includes(scan.deviceId))
        || new Set(scans.map((scan) => scan.deviceId)).size !== deviceIds.length
      ) {
        throw new ConvexError({ code: "invalid_proposal_evidence" });
      }
      if (!summarizeEvidence(scans).readyForReview) {
        throw new ConvexError({ code: "proposal_not_ready" });
      }
      let objectId = object._id;
      const closedPlacementIds: Id<"placements">[] = [];
      if (proposal.kind === "move") {
        for await (const row of ctx.db
          .query("placements")
          .withIndex("by_objectId", (q) => q.eq("objectId", objectId))) {
          if (row.venueId !== venue._id && currentPlacement([row], now)) {
            if (closedPlacementIds.length === MAX_CLOSED_PLACEMENTS) {
              throw new ConvexError({ code: "too_many_current_placements" });
            }
            await ctx.db.patch("placements", row._id, {
              closedAt: now,
              closedByProposalId: proposalId,
            });
            closedPlacementIds.push(row._id);
          }
        }
      } else {
        const reference = await ctx.db
          .query("descriptors")
          .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
          .unique();
        if (!reference || !(await ctx.db.system.get("_storage", reference.storageId))) {
          throw new ConvexError({ code: "reference_descriptors_required" });
        }
        objectId = await ctx.db.insert("objects", {
          key: `user:proposal:${proposalId}`,
          artworkId: object.artworkId,
          ownerId: venue._id,
          identityStatus: object.identityStatus,
          sourceProposalId: proposalId,
          source: "user",
          sourceId: proposalId,
          provenance: { contributionIds: [], deviceIds },
          confirmCount: 0,
          rejectCount: 0,
          calibratorPenalty: 0,
          reverted: false,
        });
        for (const scan of scans) {
          const vector = await requireEmbedding(ctx, scan.embeddingId);
          validateVector(vector);
          await insertVector(ctx, {
            objectId,
            modelVersion: scan.modelVersion,
            source: "user_scan",
            vector,
            partition: recognitionPartition(scan.modelVersion),
            scanId: scan._id,
            proposalId,
          });
        }
        await ctx.db.insert("descriptors", {
          objectId,
          storageId: reference.storageId,
          sha256: reference.sha256,
          keypointCount: reference.keypointCount,
          inputSize: reference.inputSize,
          extractedFrom: reference.extractedFrom,
          proposalId,
        });
        await bumpCounter(ctx, "objects", 1);
        await bumpCounter(ctx, "vectors", scans.length);
        await bumpCounter(ctx, "descriptors", 1);
      }
      const placementId = await ctx.db.insert("placements", {
        identityStatus: object.identityStatus,
        objectId,
        venueId: venue._id,
        onView: true,
        from: now,
        source: "proposal",
        confidence: 0.7,
        proposalId,
      });
      promotion = { placementId, closedPlacementIds };
      await bumpCounter(ctx, "placements", 1);
    }
    await ctx.db.patch("placementProposals", proposalId, {
      status,
      reviewer: reviewer.trim(),
      reviewedAt: now,
      readyForReview: false,
      promotion,
    });
    return null;
  },
});

export const revertMove = internalMutation({
  args: { proposalId: v.id("placementProposals") },
  returns: v.null(),
  handler: async (ctx, { proposalId }) => {
    const proposal = await ctx.db.get("placementProposals", proposalId);
    if (!proposal || proposal.status !== "promoted" || proposal.kind !== "move" || proposal.revertedAt !== undefined) {
      return null;
    }
    if (!proposal.promotion) {
      throw new ConvexError({ code: "missing_placement_promotion" });
    }
    await ctx.db.patch("placementProposals", proposalId, { revertedAt: Date.now() });
    const placement = await ctx.db.get("placements", proposal.promotion.placementId);
    // A later move owns the current location. Its rollback will skip this revoked predecessor.
    if (!placement || placement.closedAt !== undefined) return null;
    const current = await loadCurrentPlacement(ctx, proposal.objectId, Date.now());
    await ctx.db.patch("placements", placement._id, { closedAt: Date.now() });
    // Restored evidence must wait out a newer structured placement, including its final millisecond.
    const superseded = current && current._id !== placement._id;
    if (superseded && current.to === undefined) return null;
    const resumeAt = superseded ? current.to! + 1 : undefined;
    const object = await ctx.db.get("objects", proposal.objectId);
    if (!object || object.reverted || object.mergedInto) return null;
    const pending = [{ proposalId, placementIds: proposal.promotion.closedPlacementIds }];
    const visited = new Set<Id<"placementProposals">>();
    while (pending.length > 0) {
      const previous = pending.pop()!;
      if (visited.has(previous.proposalId)) continue;
      visited.add(previous.proposalId);
      for (const placementId of previous.placementIds) {
        const row = await ctx.db.get("placements", placementId);
        if (!row || row.closedByProposalId !== previous.proposalId) continue;
        const origin = row.proposalId ? await ctx.db.get("placementProposals", row.proposalId) : null;
        if (origin?.revertedAt !== undefined) {
          if (origin.promotion) {
            pending.push({
              proposalId: origin._id,
              placementIds: origin.promotion.closedPlacementIds,
            });
          }
          continue;
        }
        const from = resumeAt === undefined ? row.from : Math.max(row.from ?? -Infinity, resumeAt);
        if (from !== undefined && row.to !== undefined && from > row.to) {
          continue;
        }
        await ctx.db.patch("placements", row._id, {
          closedAt: undefined,
          closedByProposalId: undefined,
          from,
        });
      }
    }
    return null;
  },
});

const cursorArg = v.union(v.string(), v.null());

export const listProposals = internalQuery({
  args: { status: proposalStatus, cursor: v.optional(cursorArg) },
  returns: v.object({
    rows: v.array(schema.doc("placementProposals")),
    cursor: cursorArg,
  }),
  handler: async (ctx, { status, cursor }) => {
    const page = await ctx.db
      .query("placementProposals")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .paginate({
        cursor: cursor ?? null,
        numItems: 100,
        maximumBytesRead: 1024 * 1024,
      });
    return {
      rows: page.page,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export async function reassessProposal(ctx: MutationCtx, proposalId: Id<"placementProposals">): Promise<void> {
  const proposal = await ctx.db.get("placementProposals", proposalId);
  if (!proposal || proposal.status === "rejected" || proposal.revertedAt !== undefined) {
    return;
  }
  const scans = await loadValidEvidence(ctx, proposal.scanIds, proposal.objectId, proposal.proposedVenueId);
  const summary = summarizeEvidence(scans);
  await ctx.db.patch("placementProposals", proposalId, {
    scanIds: scans.map((scan) => scan._id),
    ...summary,
    readyForReview: proposal.status === "pending" && summary.readyForReview,
  });
  if (proposal.status !== "promoted" || summary.readyForReview) return;
  if (proposal.kind === "move") {
    await ctx.scheduler.runAfter(0, internal.placements.revertMove, {
      proposalId,
    });
  } else {
    await ctx.db.patch("placementProposals", proposalId, { revertedAt: Date.now() });
    const placement = proposal.promotion ? await ctx.db.get("placements", proposal.promotion.placementId) : null;
    if (placement) {
      await ctx.scheduler.runAfter(0, internal.revert.revertObjectById, {
        objectId: placement.objectId,
        reason: "proposal_evidence_removed",
      });
    }
  }
}

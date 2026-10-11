import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { fileStorage } from "./lib/fileStorage";
import { patchContributionState } from "./lib/objectContributionState";
import { newObjectCounters } from "./lib/objectCounters";
import { readObjectOrb, patchObjectDetails } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { currentPlacement, loadCurrentPlacement } from "./lib/placements";
import { loadProposalEvidence, MAX_EVIDENCE_SCANS, replaceProposalEvidence } from "./lib/proposalEvidence";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { proposalStatus } from "./lib/validators";
import { insertArchivedVector } from "./lib/vectorStore";
import { isVenueOptedOut } from "./lib/venueOptOut";
import { getEmbedding, requireEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const DAY = 86_400_000;
const MAX_CLOSED_PLACEMENTS = 100;

export function readyForReview(deviceIds: Id<"devices">[], firstSeenAt: number, lastSeenAt: number): boolean {
  const devices = new Set(deviceIds).size;
  return devices >= 3 || (devices >= 2 && lastSeenAt - firstSeenAt >= DAY);
}

function scanDeviceIds(scans: Doc<"scans">[]): Id<"devices">[] {
  return [...new Set(scans.map((scan) => scan.deviceId))];
}

// Agreement windows count whole milliseconds of server receipt time.
function seenAt(scan: Doc<"scans">): number {
  return Math.floor(scan._creationTime);
}

function summarizeEvidence(scans: Doc<"scans">[]) {
  const firstSeenAt = scans.length > 0 ? Math.min(...scans.map(seenAt)) : 0;
  const lastSeenAt = scans.length > 0 ? Math.max(...scans.map(seenAt)) : 0;
  return {
    firstSeenAt,
    lastSeenAt,
    readyForReview: readyForReview(scanDeviceIds(scans), firstSeenAt, lastSeenAt),
  };
}

function retainEvidence(scans: Doc<"scans">[]): Doc<"scans">[] {
  const byDevice = new Map<Id<"devices">, { first: Doc<"scans">; last: Doc<"scans"> }>();
  for (const scan of scans) {
    const previous = byDevice.get(scan.deviceId);
    if (!previous) {
      byDevice.set(scan.deviceId, { first: scan, last: scan });
    } else {
      if (scan._creationTime < previous.first._creationTime) previous.first = scan;
      if (scan._creationTime > previous.last._creationTime) previous.last = scan;
    }
  }
  return [...byDevice.values()].flatMap(({ first, last }) => (first._id === last._id ? [first] : [first, last]));
}

// A pending copy proposal indexes its evidence scans' stored vectors, which expire.
async function isValidEvidence(
  ctx: QueryCtx,
  scan: Doc<"scans">,
  objectId: Id<"objects">,
  venueId: Id<"museums">,
  needsVector: boolean,
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
  if (feedback.length > 32 || rejected || !(confident || resolved)) return false;
  return !needsVector || (await getEmbedding(ctx, scan.embeddingId)) !== null;
}

async function loadValidEvidence(
  ctx: QueryCtx,
  scanIds: Id<"scans">[],
  objectId: Id<"objects">,
  venueId: Id<"museums">,
  needsVector: boolean,
): Promise<Doc<"scans">[]> {
  const scans: Doc<"scans">[] = [];
  for (const scanId of new Set(scanIds)) {
    const scan = await ctx.db.get("scans", scanId);
    if (scan && (await isValidEvidence(ctx, scan, objectId, venueId, needsVector))) {
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
  const kind = artwork.multiplicity === "unique" ? "move" : "new_object";
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
  const links = existing ? await loadProposalEvidence(ctx, existing._id) : [];
  if (links.length > MAX_EVIDENCE_SCANS) {
    throw new ConvexError({ code: "invalid_proposal_evidence" });
  }
  const needsVector = kind === "new_object";
  const linkedScanIds = links.map((link) => link.scanId);
  const scans = await loadValidEvidence(ctx, linkedScanIds, objectId, proposedVenueId, needsVector);
  // Freeze valid agreement, but let fresh scans replace withdrawn or missing evidence.
  if (
    !summarizeEvidence(scans).readyForReview
    && !scans.some((row) => row._id === scan._id)
    && (await isValidEvidence(ctx, scan, objectId, proposedVenueId, needsVector))
  ) {
    scans.push(scan);
  }
  const retained = retainEvidence(scans);
  const scanIds = retained.map((row) => row._id);
  if (!existing && scanIds.length === 0) return null;
  if (existing && scanIds.length === linkedScanIds.length && scanIds.every((id, i) => id === linkedScanIds[i])) {
    return null;
  }
  const evidence = summarizeEvidence(retained);
  await input.beforeWrite?.();
  const proposalId =
    existing?._id
    ?? (await ctx.db.insert("placementProposals", {
      objectId,
      proposedVenueId,
      kind,
      ...evidence,
      status: "pending",
    }));
  if (existing) {
    await ctx.db.patch("placementProposals", existing._id, { kind, ...evidence });
  }
  await replaceProposalEvidence(ctx, proposalId, links, retained);
  return null;
}

const reviewArgs = {
  proposalId: v.id("placementProposals"),
  decision: v.union(v.literal("approve"), v.literal("reject")),
  reviewer: v.string(),
};
export const reviewPlacement = internalAction({
  args: reviewArgs,
  returns: v.null(),
  handler: (ctx, args): Promise<null> =>
    withErrorReporting("placements.reviewPlacement", () => ctx.runMutation(internal.placements.commitReview, args)),
});

export const commitReview = internalMutation({
  args: reviewArgs,
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
      const links = await loadProposalEvidence(ctx, proposalId);
      if (links.length > MAX_EVIDENCE_SCANS) {
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
      const scans = await loadValidEvidence(
        ctx,
        links.map((link) => link.scanId),
        object._id,
        venue._id,
        proposal.kind === "new_object",
      );
      if (scans.length !== links.length || scans.some((scan, i) => scan.deviceId !== links[i].deviceId)) {
        throw new ConvexError({ code: "invalid_proposal_evidence" });
      }
      const deviceIds = scanDeviceIds(scans);
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
        const reference = await readObjectOrb(ctx, object);
        if (!reference || !(await fileStorage.getMetadata(ctx, reference.storageId))) {
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
          ...newObjectCounters,
          reverted: false,
        });
        for (const scan of scans) {
          const archive = await requireEmbedding(ctx, scan.embeddingId);
          await insertArchivedVector(ctx, {
            objectId,
            modelVersion: scan.modelVersion,
            source: "user_scan",
            ...archive,
            partition: recognitionPartition(scan.modelVersion),
            scanId: scan._id,
            proposalId,
          });
        }
        await patchObjectDetails(
          ctx,
          { _id: objectId },
          {
            orb: {
              storageId: reference.storageId,
              sha256: reference.sha256,
              keypointCount: reference.keypointCount,
              inputSize: reference.inputSize,
              extractedFrom: reference.extractedFrom,
              proposalId,
            },
          },
        );
        await patchContributionState(ctx, objectId, {});
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
  // A promoted copy already indexed its own vectors, so expiry cannot withdraw its evidence.
  const links = await loadProposalEvidence(ctx, proposalId);
  const scans = await loadValidEvidence(
    ctx,
    links.map((link) => link.scanId),
    proposal.objectId,
    proposal.proposedVenueId,
    proposal.status === "pending" && proposal.kind === "new_object",
  );
  const summary = summarizeEvidence(scans);
  await ctx.db.patch("placementProposals", proposalId, {
    ...summary,
    readyForReview: proposal.status === "pending" && summary.readyForReview,
  });
  const surviving = new Set(scans.map((scan) => scan._id));
  for (const link of links) {
    if (!surviving.has(link.scanId)) await ctx.db.delete("proposalEvidence", link._id);
  }
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

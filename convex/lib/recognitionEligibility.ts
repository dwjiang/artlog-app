import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { contributionGroup, verifiedAccession, workKey } from "./agreement";
import { museumIdentityKeys } from "./museumWorkIdentity";
import { evidenceDeviceIds, loadProposalEvidence } from "./proposalEvidence";
import { isVenueOptedOut } from "./venueOptOut";

export function recognitionPartition(modelVersion: string, venueId?: Id<"museums">): string {
  return JSON.stringify([modelVersion, venueId ?? "established"]);
}

type RightsRow = Pick<Doc<"contributions">, "venueId" | "fields" | "sourceUrl" | "wikidataId">;

// The same rights predicate gates a contribution when it is shared and whenever it is read afterwards,
// so a later opt-out or takedown hides every entry the label would have been refused for.
export async function contributionRightsIssue(
  ctx: QueryCtx,
  row: RightsRow,
): Promise<"invalid_venue" | "artwork_taken_down" | null> {
  const venue = await ctx.db.get("museums", row.venueId);
  if (!venue || (await isVenueOptedOut(ctx, venue))) return "invalid_venue";
  const keys = await museumIdentityKeys({
    accession: verifiedAccession(row),
    pageUrl: row.sourceUrl,
    names: workKey(row.fields),
  });
  const artworkIds = new Set<Id<"artworks">>();
  for (const { key } of keys) {
    const identity = await ctx.db
      .query("museumWorkIdentities")
      .withIndex("by_venue_identity", (q) => q.eq("venueId", row.venueId).eq("identity", key))
      .unique();
    if (identity) artworkIds.add(identity.artworkId);
  }
  if (row.wikidataId) {
    const artwork = await ctx.db
      .query("artworks")
      .withIndex("by_wikidataId", (q) => q.eq("wikidataId", row.wikidataId))
      .first();
    if (artwork) artworkIds.add(artwork._id);
  }
  // A visitor entry has no museum identity; a takedown of one binds its label at the venue through its artwork.
  for await (const state of ctx.db
    .query("objectContributionState")
    .withIndex("by_groupKey", (q) => q.eq("groupKey", contributionGroup(row)))) {
    const object = await ctx.db.get("objects", state.objectId);
    if (object) artworkIds.add(object.artworkId);
  }
  for (const artworkId of artworkIds) {
    if (
      await ctx.db
        .query("takedowns")
        .withIndex("by_artworkId", (q) => q.eq("target.artworkId", artworkId))
        .first()
    ) {
      return "artwork_taken_down";
    }
    if (
      await ctx.db
        .query("takedowns")
        .withIndex("by_identity_artwork_venue", (q) =>
          q.eq("target.identityArtworkId", artworkId).eq("target.venueId", row.venueId),
        )
        .first()
    ) {
      return "artwork_taken_down";
    }
  }
  return null;
}

export async function eligibleContribution(ctx: QueryCtx, row: Doc<"contributions"> | null): Promise<boolean> {
  if (!row || row.status !== "tentative" || !row.cropStorageId || !row.orbStorageId) {
    return false;
  }
  const device = await ctx.db.get("devices", row.deviceId);
  return (
    !!device && !device.banned && device.retiredAt === undefined && (await contributionRightsIssue(ctx, row)) === null
  );
}

// The object row on its own: reverts, merges, takedowns, and reviewed proposal provenance.
export async function eligibleObjectRecord(ctx: QueryCtx, object: Doc<"objects">): Promise<boolean> {
  if (object.reverted || object.mergedInto) return false;
  if (
    (await ctx.db
      .query("takedowns")
      .withIndex("by_artworkId", (q) => q.eq("target.artworkId", object.artworkId))
      .first())
    || (await ctx.db
      .query("takedowns")
      .withIndex("by_objectId", (q) => q.eq("target.objectId", object._id))
      .first())
  ) {
    return false;
  }
  if (object.sourceProposalId) {
    const proposal = await ctx.db.get("placementProposals", object.sourceProposalId);
    if (!proposal || proposal.revertedAt !== undefined) return false;
    for (const deviceId of evidenceDeviceIds(await loadProposalEvidence(ctx, proposal._id))) {
      const device = await ctx.db.get("devices", deviceId);
      if (!device || device.banned) return false;
    }
  }
  return true;
}

export async function eligibleObject(ctx: QueryCtx, object: Doc<"objects">, venueId?: Id<"museums">): Promise<boolean> {
  if (!(await eligibleObjectRecord(ctx, object))) return false;
  if (object.identityStatus === "established") return true;
  if (!venueId || object.ownerId !== venueId || !object.sourceContributionId) {
    return false;
  }
  return eligibleContribution(ctx, await ctx.db.get("contributions", object.sourceContributionId));
}

/** A scan's photo lent to the catalogue work its verified label linked, rather than one agreed by visitors. */
export function isLinkedView(vector: Doc<"vectors">): boolean {
  return vector.source === "user_scan" && !!vector.scanId && !vector.feedbackId && !vector.proposalId;
}

export async function eligibleLinkedScan(ctx: QueryCtx, scan: Doc<"scans">): Promise<boolean> {
  if (scan.linked?.source !== "label") return false;
  if (!scan.venueId) return true;
  const venue = await ctx.db.get("museums", scan.venueId);
  return !!venue && !(await isVenueOptedOut(ctx, venue));
}

export async function eligibleVector(ctx: QueryCtx, vector: Doc<"vectors">): Promise<boolean> {
  if (vector.source === "user" && !vector.contributionId) return false;
  if (vector.source === "user_scan" && !vector.scanId) return false;
  if (
    vector.contributionId
    && !(await eligibleContribution(ctx, await ctx.db.get("contributions", vector.contributionId)))
  ) {
    return false;
  }
  if (vector.scanId) {
    const scan = await ctx.db.get("scans", vector.scanId);
    const device = scan ? await ctx.db.get("devices", scan.deviceId) : null;
    if (!device || device.banned) return false;
    if (
      isLinkedView(vector)
      && (!scan || scan.linked?.objectId !== vector.objectId || !(await eligibleLinkedScan(ctx, scan)))
    ) {
      return false;
    }
  }
  if (vector.feedbackId) {
    const feedback = await ctx.db.get("feedback", vector.feedbackId);
    if (!feedback?.multiViewAgreement || feedback.resolution.kind !== "runner_up") {
      return false;
    }
    for (const id of [feedback.multiViewAgreement.firstDeviceId, feedback.multiViewAgreement.secondDeviceId]) {
      const device = await ctx.db.get("devices", id);
      if (!device || device.banned) return false;
    }
  }
  return true;
}

import { ConvexError, type Infer, v } from "convex/values";

import { ownerKey } from "../shared/journal/contracts";
import { type reportEvidence, reportInput, validateReport } from "../shared/social/contracts";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { narrationCurrent, narrationEntry, scriptCurrent } from "./lib/narrationCache";
import { audioEvidenceOf } from "./lib/narrationEvidence";
import { activeProfile, optionalProfile, resolveOwner } from "./lib/ownership";
import { matchesRecord, projectWallArtwork } from "./lib/projections";
import { requirePublicWallItem, requireSharedVisit } from "./lib/publicationAccess";
import { limitKey } from "./lib/rateLimits";
import { findOpenReport, profileEvidence } from "./lib/reports";
import { visibleParticipant } from "./lib/visitReactions";

type ReportTarget = Infer<typeof reportInput>["target"];
type ContentTarget = Extract<ReportTarget, { artworkId: Id<"artworks"> }>;
type SocialTarget = Exclude<ReportTarget, ContentTarget | { kind: "scanDocent" }>;
type Evidence = Infer<typeof reportEvidence>;

export const submit = mutation({
  args: reportInput.fields,
  returns: v.object({ reportId: v.id("reports") }),
  handler: async (ctx, input) => {
    validateReport(input);
    const { owner } = await resolveOwner(ctx);
    const { target } = input;
    let evidence: Evidence;
    if (target.kind === "scanDocent") {
      const device = await requireDevice(ctx);
      const scan = await ctx.db.get("scans", target.scanId);
      const docent = scan?.deviceId === device._id ? scan.confirmed?.docent : undefined;
      if (!docent?.length) throw new ConvexError({ code: "not_found" });
      evidence = { kind: "scanDocent", scanId: target.scanId, sentences: docent.map(({ sentence }) => sentence) };
    } else if (target.kind === "docent" || target.kind === "transcript" || target.kind === "audio") {
      const artwork = await ctx.db.get("artworks", target.artworkId);
      if (!artwork) throw new ConvexError({ code: "not_found" });
      evidence = await contentEvidence(ctx, artwork, target);
    } else {
      const viewer = await optionalProfile(ctx);
      evidence = await socialEvidence(ctx, target, viewer?._id);
      if (evidence.profileId === viewer?._id) throw new ConvexError({ code: "invalid_report" });
    }
    const existing = await findOpenReport(ctx, owner, target);
    if (existing && existing.reason !== "blocked") return { reportId: existing._id };
    await limitKey(ctx, "report", ownerKey(owner));
    const fields = {
      ...input,
      details: input.details?.trim() || undefined,
      evidence,
    };
    if (existing) {
      await ctx.db.patch("reports", existing._id, fields);
      return { reportId: existing._id };
    }
    const reportId = await ctx.db.insert("reports", {
      reporter: owner,
      ...fields,
      status: "open",
    });
    return { reportId };
  },
});

async function contentEvidence(ctx: MutationCtx, artwork: Doc<"artworks">, target: ContentTarget): Promise<Evidence> {
  const { artworkId } = target;
  if (target.kind === "docent") {
    const docent = (await readArtworkContent(ctx, artwork))?.docent?.en;
    if (!docent?.length || artwork.factSheetNeedsReview) throw new ConvexError({ code: "not_found" });
    return { kind: "docent", artworkId, sentences: docent.map(({ sentence }) => sentence) };
  }
  const entry = await narrationEntry(ctx, artworkId);
  if (target.kind === "transcript") {
    if (!entry?.sentences || !scriptCurrent(entry, artwork)) throw new ConvexError({ code: "not_found" });
    return { kind: "transcript", artworkId, sentences: entry.sentences.map(({ sentence }) => sentence) };
  }
  if (entry?.claim === target.renderId && narrationCurrent(entry, artwork)) {
    const evidence = audioEvidenceOf(entry);
    if (evidence) return evidence;
  }
  const failed = await ctx.db
    .query("narrationFailures")
    .withIndex("by_artwork_render", (q) => q.eq("artworkId", artworkId).eq("renderId", target.renderId))
    .unique();
  if (!failed || failed.expiresAt <= Date.now()) throw new ConvexError({ code: "not_found" });
  return {
    kind: "audio",
    artworkId,
    renderId: failed.renderId,
    speechModel: failed.speechModel,
    voice: failed.voice,
    sentences: failed.sentences,
    fileIds: failed.fileIds,
  };
}

async function socialEvidence(
  ctx: MutationCtx,
  target: SocialTarget,
  viewerId: Id<"profiles"> | undefined,
): Promise<Extract<Evidence, { profileId: unknown }>> {
  if (target.kind === "profile") {
    const profile = await activeProfile(ctx, target.profileId);
    if (!profile) throw new ConvexError({ code: "not_found" });
    return profileEvidence(profile);
  }
  if (target.kind === "wallItem") {
    const { item, profile, save } = await requirePublicWallItem(ctx, target.itemId);
    const { artwork, note } = projectWallArtwork(item, save, undefined, await matchesRecord(ctx, save));
    return {
      kind: "wallItem",
      profileId: profile._id,
      itemId: item._id,
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      medium: artwork.medium,
      note,
    };
  }
  if (target.kind === "sharedVisit") {
    const { publication } = await requireSharedVisit(ctx, target.postId, viewerId);
    return {
      kind: "sharedVisit",
      profileId: publication.profileId,
      postId: publication.postId,
      reflection: publication.reflection,
    };
  }
  const comment = await ctx.db.get("visitComments", target.commentId);
  const post = comment && (await ctx.db.get("sharedVisits", comment.publicationId));
  if (!comment || !post) throw new ConvexError({ code: "not_found" });
  const { publication } = await requireSharedVisit(ctx, post.postId, viewerId);
  if (!(await visibleParticipant(ctx, comment.profileId, [viewerId, publication.profileId]))) {
    throw new ConvexError({ code: "not_found" });
  }
  return {
    kind: "comment",
    profileId: comment.profileId,
    postId: publication.postId,
    commentId: comment._id,
    body: comment.body,
  };
}

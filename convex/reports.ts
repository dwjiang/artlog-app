import { ConvexError, type Infer, v } from "convex/values";

import { ownerKey } from "../shared/journal/contracts";
import { type reportEvidence, reportInput, validateReport } from "../shared/social/contracts";
import { mutation } from "./functions";
import { activeProfile, optionalProfile, resolveOwner } from "./lib/ownership";
import { projectWallArtwork } from "./lib/projections";
import { requirePublicWallItem, requireSharedVisit } from "./lib/publicationAccess";
import { limitKey } from "./lib/rateLimits";
import { visibleParticipant } from "./lib/visitReactions";

export const submit = mutation({
  args: reportInput.fields,
  returns: v.id("reports"),
  handler: async (ctx, input) => {
    validateReport(input);
    const { owner } = await resolveOwner(ctx);
    const viewer = await optionalProfile(ctx);
    let evidence: Infer<typeof reportEvidence>;
    const { target } = input;
    if (target.kind === "profile") {
      const profile = await activeProfile(ctx, target.profileId);
      if (!profile) throw new ConvexError({ code: "not_found" });
      evidence = {
        kind: "profile",
        profileId: profile._id,
        username: profile.username,
        name: profile.name,
        bio: profile.bio,
      };
    } else if (target.kind === "wallItem") {
      const { item, profile, save } = await requirePublicWallItem(ctx, target.itemId);
      const { artwork, note } = projectWallArtwork(item, save);
      evidence = {
        kind: "wallItem",
        profileId: profile._id,
        itemId: item._id,
        title: artwork.title,
        artist: artwork.artist,
        date: artwork.date,
        medium: artwork.medium,
        note,
      };
    } else if (target.kind === "sharedVisit") {
      const { publication } = await requireSharedVisit(ctx, target.postId, viewer?._id);
      evidence = {
        kind: "sharedVisit",
        profileId: publication.profileId,
        postId: publication.postId,
        reflection: publication.reflection,
      };
    } else {
      const comment = await ctx.db.get("visitComments", target.commentId);
      const post = comment && (await ctx.db.get("sharedVisits", comment.publicationId));
      if (!comment || !post) throw new ConvexError({ code: "not_found" });
      const { publication } = await requireSharedVisit(ctx, post.postId, viewer?._id);
      if (!(await visibleParticipant(ctx, comment.profileId, [viewer?._id, publication.profileId]))) {
        throw new ConvexError({ code: "not_found" });
      }
      evidence = {
        kind: "comment",
        profileId: comment.profileId,
        postId: publication.postId,
        commentId: comment._id,
        body: comment.body,
      };
    }
    if (evidence.profileId === viewer?._id) throw new ConvexError({ code: "invalid_report" });
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_reporter_target_status", (q) => q.eq("reporter", owner).eq("target", target).eq("status", "open"))
      .unique();
    if (existing) return existing._id;
    await limitKey(ctx, "report", ownerKey(owner));
    return ctx.db.insert("reports", {
      reporter: owner,
      ...input,
      details: input.details?.trim() || undefined,
      evidence,
      status: "open",
    });
  },
});

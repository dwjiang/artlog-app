import { v } from "convex/values";

import { isUuid } from "../shared/journal/limits";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { withErrorReporting } from "./lib/observability";
import { requireProfile } from "./lib/ownership";
import { removeCompanionBatch } from "./lib/visitCompanions";

const revocationArgs = { authorId: v.id("profiles"), profileId: v.id("profiles"), throughRevision: v.number() };
export const revoke = internalAction({
  args: revocationArgs,
  returns: v.null(),
  handler: (ctx, args): Promise<null> =>
    withErrorReporting("visitCompanions.revoke", () => ctx.runMutation(internal.visitCompanions.revokeBatch, args)),
});
export const revokeBatch = internalMutation({
  args: revocationArgs,
  returns: v.null(),
  handler: removeCompanionBatch,
});

/** A companion takes themselves off a post; the author can add them again. */
export const leave = mutation({
  args: { postId: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    const { profile } = await requireProfile(ctx);
    if (!isUuid(postId)) return null;
    const publication = await ctx.db
      .query("sharedVisits")
      .withIndex("by_postId", (q) => q.eq("postId", postId))
      .unique();
    if (!publication?.companionSelections?.some((person) => person.profileId === profile._id)) return null;
    await ctx.db.patch("sharedVisits", publication._id, {
      companionSelections: publication.companionSelections.filter((person) => person.profileId !== profile._id),
      publicationRevision: publication.publicationRevision + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});

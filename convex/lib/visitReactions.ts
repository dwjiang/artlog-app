import type { Triggers } from "convex-helpers/server/triggers";

import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { blockedEitherWay } from "./friendships";
import { activeProfile } from "./ownership";

export function engagement(ctx: QueryCtx, publicationId: Id<"sharedVisits">) {
  return ctx.db
    .query("visitEngagement")
    .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
    .unique();
}

export async function changeEngagement(
  ctx: MutationCtx,
  publicationId: Id<"sharedVisits">,
  field: "likeCount" | "commentCount",
  delta: number,
) {
  const current = await engagement(ctx, publicationId);
  if (current) {
    await ctx.db.patch("visitEngagement", current._id, {
      [field]: Math.max(0, current[field] + delta),
    });
  } else if (delta > 0) {
    await ctx.db.insert("visitEngagement", {
      publicationId,
      likeCount: 0,
      commentCount: 0,
      [field]: delta,
    });
  }
}

export function commentLikeCount(ctx: QueryCtx, commentId: Id<"visitComments">) {
  return ctx.db
    .query("commentLikeCounts")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .unique();
}

export async function changeCommentLikes(ctx: MutationCtx, commentId: Id<"visitComments">, delta: number) {
  const current = await commentLikeCount(ctx, commentId);
  if (current) {
    await ctx.db.patch("commentLikeCounts", current._id, { likeCount: Math.max(0, current.likeCount + delta) });
  } else if (delta > 0) {
    await ctx.db.insert("commentLikeCounts", { commentId, likeCount: delta });
  }
}

// Keep comment deletion bounded even when an account purge deletes many heavily liked comments.
export function registerCommentLikeCleanup(triggers: Triggers<DataModel>) {
  triggers.register("visitComments", async (ctx, { id, operation }) => {
    if (operation !== "delete") return;
    const like = await ctx.db
      .query("commentLikes")
      .withIndex("by_comment_profile", (q) => q.eq("commentId", id))
      .first();
    if (like) await ctx.scheduler.runAfter(0, internal.visitReactions.purgeCommentLikes, { commentId: id });
    const count = await commentLikeCount(ctx, id);
    if (count) await ctx.db.delete("commentLikeCounts", count._id);
  });
}

// The visit's author is checked alongside the viewer so a block also hides the participant from everyone else reading that visit.
export async function visibleParticipant(
  ctx: QueryCtx,
  profileId: Id<"profiles">,
  others: (Id<"profiles"> | undefined)[],
) {
  const profile = await activeProfile(ctx, profileId);
  if (!profile) return null;
  for (const other of new Set(others)) {
    if (!other || other === profileId) continue;
    if (await blockedEitherWay(ctx, profileId, other)) return null;
  }
  return profile;
}

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { activeProfile } from "./ownership";
import { removeVisitCompanion } from "./visitCompanions";

const WITHDRAW_BATCH = 10;

export async function withdrawProfilePosts(ctx: MutationCtx, profileId: Id<"profiles">): Promise<null> {
  if (await activeProfile(ctx, profileId)) return null;
  const posts = await ctx.db
    .query("sharedVisits")
    .withIndex("by_profile_status_history", (q) => q.eq("profileId", profileId).eq("status", "active"))
    .take(WITHDRAW_BATCH);
  for (const post of posts) {
    await ctx.db.patch("sharedVisits", post._id, {
      status: "private",
      publicationRevision: post.publicationRevision + 1,
      updatedAt: Date.now(),
    });
  }
  // Its companion rows go now, with their credit; posts that name it stop showing it because it no longer qualifies.
  const named = await ctx.db
    .query("visitCompanions")
    .withIndex("by_profile_history", (q) => q.eq("profileId", profileId))
    .take(WITHDRAW_BATCH);
  for (const row of named) await removeVisitCompanion(ctx, row);
  // Withdrawing a post also removes up to 30 tag rows and updates their counts.
  if (posts.length === WITHDRAW_BATCH || named.length === WITHDRAW_BATCH) {
    await ctx.scheduler.runAfter(0, internal.sharedVisits.withdrawProfile, { profileId });
  }
  return null;
}

export async function advancePublicationRevision(ctx: MutationCtx, publication: Doc<"sharedVisits">): Promise<void> {
  await ctx.db.patch("sharedVisits", publication._id, {
    publicationRevision: publication.publicationRevision + 1,
    updatedAt: Date.now(),
  });
}

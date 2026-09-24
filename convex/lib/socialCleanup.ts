import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteUnreferencedPhoto } from "./collectionPhotos";
import { changeEngagement, engagement } from "./visitReactions";

const BATCH = 50;
export async function purgeSocialBatch(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<boolean> {
  const scores = await ctx.db
    .query("leaderboardScores")
    .withIndex("by_account_metric_period", (q) => q.eq("accountId", accountId))
    .take(BATCH);
  if (scores.length) {
    for (const row of scores) await ctx.db.delete(row._id);
    return true;
  }
  const reporter = { kind: "account" as const, accountId };
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_reporter_createdAt", (q) => q.eq("reporter", reporter))
    .take(BATCH);
  if (reports.length) {
    for (const report of reports) {
      await ctx.db.patch(report._id, { reporter: undefined });
    }
    return true;
  }
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .unique();
  if (!profile) return false;
  const likes = await ctx.db
    .query("visitLikes")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(BATCH);
  if (likes.length) {
    for (const like of likes) {
      await ctx.db.delete(like._id);
      await changeEngagement(ctx, like.publicationId, "likeCount", -1);
    }
    return true;
  }
  const comments = await ctx.db
    .query("visitComments")
    .withIndex("by_profile_request", (q) => q.eq("profileId", profile._id))
    .take(BATCH);
  if (comments.length) {
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
      await changeEngagement(ctx, comment.publicationId, "commentCount", -1);
    }
    return true;
  }
  const publication = await ctx.db
    .query("sharedVisits")
    .withIndex("by_profile_visit", (q) => q.eq("profileId", profile._id))
    .first();
  if (publication) {
    const reactions = await ctx.db
      .query("visitLikes")
      .withIndex("by_publication", (q) =>
        q.eq("publicationId", publication._id),
      )
      .take(BATCH);
    const discussion = await ctx.db
      .query("visitComments")
      .withIndex("by_publication", (q) =>
        q.eq("publicationId", publication._id),
      )
      .take(BATCH);
    for (const row of [...reactions, ...discussion]) {
      await ctx.db.delete(row._id);
    }
    if (reactions.length === BATCH || discussion.length === BATCH) return true;
    const items = await ctx.db
      .query("sharedVisitItems")
      .withIndex("by_publication_position", (q) =>
        q.eq("publicationId", publication._id),
      )
      .take(BATCH);
    for (const item of items) await ctx.db.delete(item._id);
    if (items.length < BATCH) {
      const counts = await engagement(ctx, publication._id);
      if (counts) await ctx.db.delete(counts._id);
      await ctx.db.delete(publication._id);
    }
    return true;
  }
  const wall = await ctx.db
    .query("walls")
    .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
    .first();
  if (wall) {
    const items = await ctx.db
      .query("wallItems")
      .withIndex("by_wall_active", (q) => q.eq("wallId", wall._id))
      .take(BATCH);
    for (const item of items) await ctx.db.delete(item._id);
    if (items.length < BATCH) await ctx.db.delete(wall._id);
    return true;
  }
  const first = await ctx.db
    .query("friendships")
    .withIndex("by_first_state", (q) => q.eq("firstProfileId", profile._id))
    .take(BATCH);
  const second = first.length
    ? []
    : await ctx.db
        .query("friendships")
        .withIndex("by_second_state", (q) =>
          q.eq("secondProfileId", profile._id),
        )
        .take(BATCH);
  if (first.length || second.length) {
    for (const edge of [...first, ...second]) await ctx.db.delete(edge._id);
    return true;
  }
  const outgoing = await ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) => q.eq("blockerId", profile._id))
    .take(BATCH);
  const incoming = outgoing.length
    ? []
    : await ctx.db
        .query("blocks")
        .withIndex("by_blockedId", (q) => q.eq("blockedId", profile._id))
        .take(BATCH);
  if (outgoing.length || incoming.length) {
    for (const block of [...outgoing, ...incoming]) {
      await ctx.db.delete(block._id);
    }
    return true;
  }
  if (profile.photoStorageId) await ctx.storage.delete(profile.photoStorageId);
  await ctx.db.delete(profile._id);
  return true;
}
// True when a full batch was removed and more rows may remain.
export async function purgeSaveMediaBatch(
  ctx: MutationCtx,
  saveId: Id<"collections">,
): Promise<boolean> {
  const photos = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_saveId", (q) => q.eq("saveId", saveId))
    .take(BATCH);
  const encounters = await ctx.db
    .query("artworkEncounters")
    .withIndex("by_save_visit", (q) => q.eq("saveId", saveId))
    .take(BATCH);
  for (const child of [...photos, ...encounters]) {
    await ctx.db.delete(child._id);
  }
  for (const photo of photos) {
    if (photo.storageId) await deleteUnreferencedPhoto(ctx, photo.storageId);
  }
  if (photos.length === BATCH || encounters.length === BATCH) return true;
  const assets = await ctx.db
    .query("mediaAssets")
    .withIndex("by_saveId", (q) => q.eq("saveId", saveId))
    .take(BATCH);
  for (const asset of assets) await ctx.db.delete(asset._id);
  for (const storageId of new Set(assets.map((asset) => asset.storageId))) {
    if (storageId) await deleteUnreferencedPhoto(ctx, storageId);
  }
  return assets.length === BATCH;
}

import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The feed hangs photos 200 pt tall and at most 352 pt wide (the widest iPhone's row), drawn at 3x.
export const FEED_PHOTO_WIDTH = 1056;
export const FEED_PHOTO_HEIGHT = 600;
// Longer than an action can run, so a live worker never loses its lease to a replacement.
export const FEED_PHOTO_LEASE_MS = 31 * 60_000;

export const feedPhotoJob = v.object({ photoId: v.id("artworkPhotos"), storageId: v.id("files") });

type Photo = Doc<"artworkPhotos">;
export function needsFeedPhoto(photo: Photo): photo is Photo & { storageId: Id<"files"> } {
  // A photo already within the feed's size is served as it is.
  const fits = !!photo.width && !!photo.height && photo.width <= FEED_PHOTO_WIDTH && photo.height <= FEED_PHOTO_HEIGHT;
  return !!photo.storageId && photo.deletedAt === undefined && !photo.feedStorageId && !fits;
}

/** Queues a feed copy for an album photo whose original is stored. */
export async function queueFeedPhoto(ctx: MutationCtx, photo: Photo): Promise<void> {
  if (!needsFeedPhoto(photo)) return;
  const queued = await ctx.db
    .query("feedPhotoJobs")
    .withIndex("by_photoId", (q) => q.eq("photoId", photo._id))
    .first();
  if (!queued) await ctx.db.insert("feedPhotoJobs", { photoId: photo._id });
  await wakeFeedPhotoWorker(ctx);
}

// One worker runs at a time, so a burst of uploads never fans out into scheduled jobs.
export async function wakeFeedPhotoWorker(ctx: MutationCtx): Promise<void> {
  const worker = await ctx.db.query("feedPhotoWorker").first();
  if (worker && worker.leasedUntil > Date.now()) return;
  const fields = { lease: crypto.randomUUID(), leasedUntil: Date.now() + FEED_PHOTO_LEASE_MS };
  if (worker) await ctx.db.patch("feedPhotoWorker", worker._id, fields);
  else await ctx.db.insert("feedPhotoWorker", fields);
  await ctx.scheduler.runAfter(0, internal.feedPhotosPrepare.work, { lease: fields.lease });
}

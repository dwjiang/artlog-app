import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./functions";
import {
  FEED_PHOTO_LEASE_MS,
  feedPhotoJob,
  needsFeedPhoto,
  queueFeedPhoto,
  wakeFeedPhotoWorker,
} from "./lib/feedPhotos";
import { fileStorage, retainFile } from "./lib/fileStorage";

const BATCH_SIZE = 25;
const BACKFILL_PAGE_SIZE = 200;

/**
 * Hands the worker holding `lease` the next photos to copy, or null once the queue is empty or a newer worker took
 * over. Each photo is handed out once; a copy that fails leaves the feed showing the original.
 */
export const claim = internalMutation({
  args: { lease: v.string() },
  returns: v.union(v.null(), v.array(feedPhotoJob)),
  handler: async (ctx, { lease }) => {
    const worker = await ctx.db.query("feedPhotoWorker").first();
    if (worker?.lease !== lease) return null;
    const jobs = await ctx.db.query("feedPhotoJobs").take(BATCH_SIZE);
    if (jobs.length === 0) {
      await ctx.db.delete("feedPhotoWorker", worker._id);
      return null;
    }
    await ctx.db.patch("feedPhotoWorker", worker._id, { leasedUntil: Date.now() + FEED_PHOTO_LEASE_MS });
    const batch = [];
    for (const job of jobs) {
      await ctx.db.delete("feedPhotoJobs", job._id);
      const photo = await ctx.db.get("artworkPhotos", job.photoId);
      if (photo && needsFeedPhoto(photo)) batch.push({ photoId: photo._id, storageId: photo.storageId });
    }
    return batch;
  },
});

export const attach = internalMutation({
  args: { photoId: v.id("artworkPhotos"), storageId: v.id("files"), feedStorageId: v.id("files") },
  returns: v.boolean(),
  handler: async (ctx, { photoId, storageId, feedStorageId }) => {
    const photo = await ctx.db.get("artworkPhotos", photoId);
    // A photo deleted or given a copy meanwhile keeps what it has; the caller discards this copy.
    if (
      !photo
      || !needsFeedPhoto(photo)
      || photo.storageId !== storageId
      || !(await fileStorage.getMetadata(ctx, feedStorageId))
    ) {
      return false;
    }
    await retainFile(ctx, feedStorageId);
    await ctx.db.patch("artworkPhotos", photoId, { feedStorageId });
    return true;
  },
});

/**
 * Queues feed copies for stored album photos that lack one, a page at a time. Safe to rerun: it retries copies that
 * failed and skips photos that have one.
 */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("artworkPhotos").paginate({ cursor: cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    for (const photo of page.page) await queueFeedPhoto(ctx, photo);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.feedPhotos.backfill, { cursor: page.continueCursor });
    }
    return null;
  },
});

// Restarts the worker when its lease ran out with photos still queued.
export const wake = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (await ctx.db.query("feedPhotoJobs").first()) await wakeFeedPhotoWorker(ctx);
    return null;
  },
});

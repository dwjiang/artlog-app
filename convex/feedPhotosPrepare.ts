"use node";

import { type Infer, v } from "convex/values";
import sharp from "sharp";

import { MAX_COLLECTION_PHOTO_BYTES } from "../shared/collection/photo-limits";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { FEED_PHOTO_HEIGHT, FEED_PHOTO_WIDTH, type feedPhotoJob } from "./lib/feedPhotos";
import { fileStorage } from "./lib/fileStorage";
import { reportBackendError, withErrorReporting } from "./lib/observability";

async function makeFeedPhoto(ctx: ActionCtx, { photoId, storageId }: Infer<typeof feedPhotoJob>): Promise<void> {
  let feedStorageId: Id<"files"> | undefined;
  try {
    const original = await fileStorage.get(ctx, storageId);
    if (!original || original.size > MAX_COLLECTION_PHOTO_BYTES) return;
    const input = sharp(Buffer.from(await original.arrayBuffer()), { limitInputPixels: 40_000_000 });
    // An upload that only looked like a JPEG keeps serving as it is.
    if ((await input.metadata().catch(() => null))?.format !== "jpeg") return;
    const data = await input
      .autoOrient()
      .resize({ width: FEED_PHOTO_WIDTH, height: FEED_PHOTO_HEIGHT, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    if (data.byteLength >= original.size) return;
    feedStorageId = await fileStorage.store(ctx, new Blob([new Uint8Array(data)], { type: "image/jpeg" }));
    if (await ctx.runMutation(internal.feedPhotos.attach, { photoId, storageId, feedStorageId })) {
      feedStorageId = undefined;
    }
  } catch (error) {
    await reportBackendError(error, "feedPhotosPrepare.makeFeedPhoto");
  } finally {
    if (feedStorageId) await ctx.runMutation(internal.collectionPhotos.discard, { storageId: feedStorageId });
  }
}

/** Copies one batch of queued photos at feed size, then runs again until the queue is empty. */
export const work = internalAction({
  args: { lease: v.string() },
  returns: v.null(),
  handler: (ctx, { lease }) =>
    withErrorReporting("feedPhotosPrepare.work", async () => {
      const batch = await ctx.runMutation(internal.feedPhotos.claim, { lease });
      if (batch === null) return null;
      for (const photo of batch) await makeFeedPhoto(ctx, photo);
      await ctx.scheduler.runAfter(0, internal.feedPhotosPrepare.work, { lease });
      return null;
    }),
});

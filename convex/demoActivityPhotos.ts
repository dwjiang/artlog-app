"use node";

import { ConvexError, v } from "convex/values";
import sharp from "sharp";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireDemoBot } from "./lib/demoBot";
import { fileStorage } from "./lib/fileStorage";
import { withErrorReporting } from "./lib/observability";
import { limitKey } from "./lib/rateLimits";

// Node actions accept 5 MiB of arguments; the rest is headroom for the envelope.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 2048;

export const uploadPhoto = action({
  args: { jpeg: v.bytes() },
  returns: v.object({ photoId: v.id("files"), width: v.number(), height: v.number() }),
  handler: (ctx, { jpeg }): Promise<{ photoId: Id<"files">; width: number; height: number }> =>
    withErrorReporting("demoActivityPhotos.uploadPhoto", async () => {
      await requireDemoBot(ctx);
      await limitKey(ctx, "photoUpload", "demoBot");
      if (jpeg.byteLength > MAX_UPLOAD_BYTES) throw new ConvexError({ code: "photo_too_large" });
      const input = Buffer.from(jpeg);
      const { format, width, height } = await sharp(input)
        .metadata()
        .catch(() => ({ format: undefined, width: undefined, height: undefined }));
      if (format !== "jpeg" || !width || !height) throw new ConvexError({ code: "invalid_photo" });
      if (width * height > MAX_PIXELS) throw new ConvexError({ code: "photo_too_large" });
      // Re-encoding drops every metadata block, including EXIF location.
      const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true })
        .catch(() => {
          throw new ConvexError({ code: "invalid_photo" });
        });
      const photoId = await fileStorage.store(ctx, new Blob([new Uint8Array(data)], { type: "image/jpeg" }));
      const photo = { photoId, width: info.width, height: info.height };
      try {
        await ctx.runMutation(internal.demoActivity.registerPhoto, photo);
      } catch (error) {
        await fileStorage.delete(ctx, photoId);
        throw error;
      }
      return photo;
    }),
});

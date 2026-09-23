"use node";

import { v } from "convex/values";
import sharp from "sharp";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { reportBackendError } from "./lib/observability";

export const prepare = internalAction({
  args: { saveId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, { saveId }) => {
    let storageId: Id<"_storage"> | undefined;
    try {
      const asset = await ctx.runMutation(internal.displayMedia.beginPreparation, { saveId });
      if (!asset || asset.provenance.kind !== "contribution") return null;
      const blob = await ctx.storage.get(asset.provenance.sourceStorageId);
      if (!blob || blob.size > 5 * 1024 * 1024) return null;
      const input = sharp(Buffer.from(await blob.arrayBuffer()), { limitInputPixels: 40_000_000 });
      if ((await input.metadata()).format !== "jpeg") return null;
      const { data, info } = await input
        .autoOrient()
        .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      storageId = await ctx.storage.store(new Blob([new Uint8Array(data)], { type: "image/jpeg" }));
      if (
        await ctx.runMutation(internal.displayMedia.attach, {
          assetId: asset._id,
          storageId,
          width: info.width,
          height: info.height,
        })
      )
        storageId = undefined;
    } catch (error) {
      await reportBackendError(error, "displayMediaPrepare.prepare");
      console.warn(
        "Display media preparation failed",
        error instanceof Error ? error.name : "UnknownError",
      );
    } finally {
      if (storageId) await ctx.runMutation(internal.displayMedia.discard, { storageId });
    }
    return null;
  },
});

import type { Triggers } from "convex-helpers/server/triggers";
import { ConvexError } from "convex/values";

import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * A photo the demo bot uploaded that no record holds yet. Only these attach to a demo post, so the bot can never
 * reach another person's upload by its file ID.
 */
export async function requireDemoPhoto(ctx: QueryCtx, fileId: Id<"files">): Promise<Doc<"demoPhotos">> {
  const photo = await ctx.db
    .query("demoPhotos")
    .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
    .unique();
  const file = await ctx.db.get("files", fileId);
  if (
    !photo
    || file?.state !== "ready"
    || file.refCount > 0
    || file.contentType !== "image/jpeg"
    || (file.expiresAt ?? 0) <= Date.now()
  ) {
    throw new ConvexError({ code: "photo_unavailable" });
  }
  return photo;
}

// An upload no post claimed expires with its file lease.
export function registerDemoPhotoCleanup(triggers: Triggers<DataModel>) {
  triggers.register("files", async (ctx, { id, operation }) => {
    if (operation !== "delete") return;
    const photo = await ctx.db
      .query("demoPhotos")
      .withIndex("by_fileId", (q) => q.eq("fileId", id))
      .unique();
    if (photo) await ctx.db.delete("demoPhotos", photo._id);
  });
}

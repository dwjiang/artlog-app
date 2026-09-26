import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fileStorage } from "./fileStorage";

export async function deleteUnreferencedCollectionPhotos(
  ctx: MutationCtx,
  row: Pick<Doc<"collections">, "cropStorageId">,
): Promise<void> {
  if (row.cropStorageId) await deleteUnreferencedPhoto(ctx, row.cropStorageId);
}

export async function deleteUnreferencedPhoto(ctx: MutationCtx, storageId: string): Promise<void> {
  const crop = await ctx.db
    .query("collections")
    .withIndex("by_cropStorageId_deletedAt", (q) => q.eq("cropStorageId", storageId).eq("deletedAt", undefined))
    .first();
  const asset = await ctx.db
    .query("mediaAssets")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  const album = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  if (!crop && !asset && (!album || album.deletedAt !== undefined) && (await fileStorage.getMetadata(ctx, storageId))) {
    await fileStorage.delete(ctx, storageId);
  }
}

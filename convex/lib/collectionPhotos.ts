import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deleteUnreferencedCollectionPhotos(
  ctx: MutationCtx,
  row: Pick<Doc<"collections">, "cropStorageId">,
): Promise<void> {
  if (row.cropStorageId) await deleteUnreferencedPhoto(ctx, row.cropStorageId);
}

export async function deleteUnreferencedPhoto(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  const crop = await ctx.db
    .query("collections")
    .withIndex("by_cropStorageId_deletedAt", (q) =>
      q.eq("cropStorageId", storageId).eq("deletedAt", undefined),
    )
    .first();
  const asset = await ctx.db
    .query("mediaAssets")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  const album = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  if (
    !crop
    && !asset
    && (!album || album.deletedAt !== undefined)
    && (await ctx.db.system.get("_storage", storageId))
  ) {
    await ctx.storage.delete(storageId);
  }
}

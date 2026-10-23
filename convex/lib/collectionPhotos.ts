import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fileStorage } from "./fileStorage";

export async function deleteUnreferencedCollectionPhotos(
  ctx: MutationCtx,
  row: Pick<Doc<"collections">, "cropStorageId">,
): Promise<void> {
  if (row.cropStorageId) await deleteUnreferencedPhoto(ctx, row.cropStorageId);
}

export async function deleteUnreferencedPhoto(ctx: MutationCtx, storageId: Id<"files">): Promise<void> {
  await fileStorage.delete(ctx, storageId);
}

// The feed copy is the same photo, so it goes with the original.
export async function deleteUnreferencedAlbumPhoto(
  ctx: MutationCtx,
  photo: Pick<Doc<"artworkPhotos">, "storageId" | "feedStorageId">,
): Promise<void> {
  for (const id of [photo.storageId, photo.feedStorageId]) {
    if (id) await deleteUnreferencedPhoto(ctx, id);
  }
}

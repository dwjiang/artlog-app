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

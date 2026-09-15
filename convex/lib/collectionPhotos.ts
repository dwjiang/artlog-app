import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export async function deleteUnreferencedCollectionPhotos(
  ctx: MutationCtx, row: Pick<Doc<'collections'>, 'photoStorageId' | 'cropStorageId'>,
): Promise<void> {
  for (const storageId of new Set([row.photoStorageId, row.cropStorageId])) {
    if (!storageId) continue;
    await deleteUnreferencedPhoto(ctx, storageId);
  }
}

export async function deleteUnreferencedPhoto(ctx: MutationCtx, storageId: Id<'_storage'>): Promise<void> {
  const photo = await ctx.db.query('collections').withIndex('by_photoStorageId_deletedAt',
    (q) => q.eq('photoStorageId', storageId).eq('deletedAt', undefined)).first();
  const crop = await ctx.db.query('collections').withIndex('by_cropStorageId_deletedAt',
    (q) => q.eq('cropStorageId', storageId).eq('deletedAt', undefined)).first();
  const asset = await ctx.db.query('mediaAssets').withIndex('by_storageId', (q) => q.eq('storageId', storageId)).first();
  if (!photo && !crop && !asset && await ctx.db.system.get('_storage', storageId)) await ctx.storage.delete(storageId);
}

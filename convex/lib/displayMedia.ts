import { sameOwner } from '../../shared/journal/contracts';
import { validateMedia } from '../../shared/social/contracts';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function contributionSource(ctx: QueryCtx, save: Doc<'collections'>) {
  if (save.deletedAt !== undefined || !save.scanId || (save.owner.kind === 'account' && !await ctx.db.get(save.owner.accountId))) return null;
  const scan = await ctx.db.get(save.scanId);
  const device = scan ? await ctx.db.get(scan.deviceId) : null;
  if (!scan || !device || !sameOwner(save.owner, device.accountId
    ? { kind: 'account', accountId: device.accountId } : { kind: 'device', deviceId: device._id })) return null;
  const contribution = await ctx.db.query('contributions').withIndex('by_scanId', (q) => q.eq('scanId', scan._id)).unique();
  // The contribution submission is the consent boundary; journal/owner photos are never sources.
  if (!contribution || contribution.deviceId !== scan.deviceId || contribution.status === 'rejected' || contribution.displayMediaRevokedAt !== undefined || !contribution.cropStorageId ||
    !await ctx.db.system.get(contribution.cropStorageId)) return null;
  return { contributionId: contribution._id, sourceStorageId: contribution.cropStorageId };
}

export async function isCurrentAsset(ctx: QueryCtx, save: Doc<'collections'>, asset: Doc<'mediaAssets'>): Promise<boolean> {
  if (save.deletedAt !== undefined || asset.saveId !== save._id || asset.revokedAt !== undefined) return false;
  try { validateMedia(asset.source); } catch { return false; }
  if (asset.source.kind === 'catalog') {
    if (asset.provenance.kind !== 'catalog' || save.objectId !== asset.provenance.objectId) return false;
    const object = await ctx.db.get(asset.provenance.objectId);
    const artwork = object ? await ctx.db.get(object.artworkId) : null;
    const venue = object?.ownerId ? await ctx.db.get(object.ownerId) : null;
    return !!object && !object.reverted && !object.mergedInto && !!artwork && (!object.ownerId || (!!venue && !venue.optOut)) &&
      (!save.artworkId || save.artworkId === artwork._id);
  }
  if (asset.provenance.kind !== 'contribution' || !asset.storageId || asset.storageId === asset.provenance.sourceStorageId ||
    !await ctx.db.system.get(asset.storageId)) return false;
  const source = await contributionSource(ctx, save);
  return source?.contributionId === asset.provenance.contributionId && source?.sourceStorageId === asset.provenance.sourceStorageId;
}

export async function resolveDisplayAsset(ctx: QueryCtx, save: Doc<'collections'>) {
  for (const kind of ['catalog', 'derivative'] as const) {
    const asset = await ctx.db.query('mediaAssets').withIndex('by_save_kind', (q) => q.eq('saveId', save._id).eq('source.kind', kind)).order('desc').first();
    if (asset && await isCurrentAsset(ctx, save, asset)) return asset;
  }
  return null;
}

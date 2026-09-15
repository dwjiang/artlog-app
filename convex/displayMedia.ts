import { ConvexError, v } from 'convex/values';
import { catalogMedia, publicMediaContext, validateMedia, validateMediaContext } from '../shared/social/contracts';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery } from './_generated/server';
import { contributionSource, isCurrentAsset, resolveDisplayAsset, revokeContributionMedia, revokeSaveMedia } from './lib/displayMedia';
import { requireProfile } from './lib/ownership';
import { requirePublicWallItem, requireSharedVisitItem } from './lib/publicationAccess';
import schema from './schema';

export const registerCatalog = internalMutation({
  args: { saveId: v.id('collections'), objectId: v.id('objects'), source: catalogMedia, imageRightsEvidence: v.string() },
  returns: v.id('mediaAssets'),
  handler: async (ctx, { saveId, objectId, source, imageRightsEvidence }) => {
    validateMedia(source);
    const save = await ctx.db.get(saveId);
    const object = await ctx.db.get(objectId);
    if (!imageRightsEvidence.trim() || imageRightsEvidence.length > 4096 || !save || save.deletedAt !== undefined ||
      !object || object.reverted || save.objectId !== objectId) throw new ConvexError({ code: 'invalid_media' });
    const provenance = { kind: 'catalog' as const, objectId, imageRightsEvidence };
    const existing = await ctx.db.query('mediaAssets').withIndex('by_save_kind', (q) => q.eq('saveId', saveId).eq('source.kind', 'catalog')).unique();
    if (!existing) return ctx.db.insert('mediaAssets', { saveId, source, provenance, createdAt: Date.now() });
    // A save keeps one catalog row, so a changed source or evidence replaces it in place.
    const current = existing.source.kind === 'catalog' ? existing.source : null;
    const same = current !== null && existing.revokedAt === undefined && existing.provenance.kind === 'catalog' &&
      existing.provenance.objectId === objectId && existing.provenance.imageRightsEvidence === imageRightsEvidence &&
      (['url', 'sourceUrl', 'rights', 'credit', 'width', 'height'] as const).every((key) => current[key] === source[key]);
    if (!same) await ctx.db.patch(existing._id, { source, provenance, createdAt: Date.now(), revokedAt: undefined });
    return existing._id;
  },
});

export const beginPreparation = internalMutation({
  args: { saveId: v.id('collections') }, returns: v.union(schema.doc('mediaAssets'), v.null()),
  handler: async (ctx, { saveId }) => {
    const save = await ctx.db.get(saveId);
    if (!save || save.deletedAt !== undefined || await resolveDisplayAsset(ctx, save)) return null;
    const source = await contributionSource(ctx, save);
    if (!source) return null;
    const existing = await ctx.db.query('mediaAssets').withIndex('by_save_kind', (q) => q.eq('saveId', saveId).eq('source.kind', 'derivative')).unique();
    if (existing) return existing.revokedAt !== undefined || existing.storageId || existing.provenance.kind !== 'contribution' ||
      existing.provenance.contributionId !== source.contributionId || existing.provenance.sourceStorageId !== source.sourceStorageId ? null : existing;
    const id = await ctx.db.insert('mediaAssets', { saveId, source: { kind: 'derivative', rights: 'contributor_consent', width: 1, height: 1 },
      provenance: { kind: 'contribution', ...source }, createdAt: Date.now() });
    return ctx.db.get(id);
  },
});
export const attach = internalMutation({
  args: { assetId: v.id('mediaAssets'), storageId: v.id('_storage'), width: v.number(), height: v.number() }, returns: v.boolean(),
  handler: async (ctx, { assetId, storageId, width, height }) => {
    const asset = await ctx.db.get(assetId);
    const save = asset ? await ctx.db.get(asset.saveId) : null;
    const source = save ? await contributionSource(ctx, save) : null;
    if (!asset || asset.revokedAt !== undefined || asset.source.kind !== 'derivative' || asset.provenance.kind !== 'contribution' ||
      !source || source.contributionId !== asset.provenance.contributionId || source.sourceStorageId !== asset.provenance.sourceStorageId) return false;
    if (asset.storageId) return asset.storageId === storageId;
    if (storageId === source.sourceStorageId || !await ctx.db.system.get(storageId)) return false;
    const metadata = { ...asset.source, width, height };
    validateMedia(metadata);
    await ctx.db.patch(assetId, { source: metadata, storageId });
    return true;
  },
});
export const discard = internalMutation({
  args: { storageId: v.id('_storage') }, returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const reference = await ctx.db.query('mediaAssets').withIndex('by_storageId', (q) => q.eq('storageId', storageId)).first();
    if (!reference && await ctx.db.system.get(storageId)) await ctx.storage.delete(storageId);
    return null;
  },
});
export const revokeSave = internalMutation({
  args: { saveId: v.id('collections') }, returns: v.null(),
  handler: async (ctx, { saveId }) => { await revokeSaveMedia(ctx, saveId); return null; },
});
export const revokeContribution = internalMutation({
  args: { contributionId: v.id('contributions') }, returns: v.null(),
  handler: async (ctx, { contributionId }) => {
    await revokeContributionMedia(ctx, contributionId);
    return null;
  },
});
export const findForContext = internalQuery({
  args: { context: publicMediaContext }, returns: v.union(v.id('_storage'), v.null()),
  handler: async (ctx, { context }) => {
    validateMediaContext(context);
    const { save } = context.kind === 'wallItem' ? await requirePublicWallItem(ctx, context.itemId)
      : await requireSharedVisitItem(ctx, context.postId, context.itemId, (await requireProfile(ctx)).profile._id);
    const asset = await resolveDisplayAsset(ctx, save);
    return asset?.source.kind === 'derivative' && await isCurrentAsset(ctx, save, asset) ? asset.storageId ?? null : null;
  },
});
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export const download = httpAction(async (ctx, request) => {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind');
    if ((kind !== 'wallItem' && kind !== 'sharedVisit') || !params.get('itemId') ||
      [...params.keys()].some((key) => !['kind', 'itemId', 'postId'].includes(key)) ||
      (kind === 'wallItem' && params.has('postId'))) throw new Error('Invalid context');
    // The internal query validates table-specific IDs before any lookup.
    const context = kind === 'wallItem' ? { kind, itemId: params.get('itemId')! } : { kind, itemId: params.get('itemId')!, postId: params.get('postId') ?? '' };
    const storageId = await ctx.runQuery(internal.displayMedia.findForContext, { context: context as never });
    const blob = storageId ? await ctx.storage.get(storageId) : null;
    if (!blob || await ctx.runQuery(internal.displayMedia.findForContext, { context: context as never }) !== storageId) throw new Error('Unavailable');
    return new Response(blob, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  } catch { return new Response('Image unavailable', { status: 404, headers }); }
});

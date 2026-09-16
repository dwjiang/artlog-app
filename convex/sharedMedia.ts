import { ownedAlbumPhoto } from './lib/albumMedia';
import { ConvexError, type Infer, v } from 'convex/values';
import { previewMediaContext, sharedVisitMediaContext, validateMediaContext } from '../shared/social/contracts';
import { internal } from './_generated/api';
import { internalQuery, type ActionCtx } from './_generated/server';
import { requireMembership, requireOwnedSave, requireProfile } from './lib/ownership';
import { requireSharedVisitItem } from './lib/publicationAccess';
import { ownedVisit } from './lib/sharedPublications';
import { resolveDisplayAsset } from './lib/displayMedia';
import { projectArtwork } from './lib/projections';

export const sharedMediaContext = v.union(sharedVisitMediaContext, previewMediaContext);
export const authorize = internalQuery({
  args: { context: sharedMediaContext }, returns: v.id('_storage'),
  handler: async (ctx, { context }) => {
    validateMediaContext(context);
    const { profile, owner } = await requireProfile(ctx);
    let save;
    if (context.kind === 'sharedVisit') {
      const result = await requireSharedVisitItem(ctx, context.postId, context.itemId, profile._id);
      save = result.save;
      if (context.photoLocalId && !result.item.photoLocalIds?.includes(context.photoLocalId)) throw new ConvexError({ code: 'not_found' });
    } else {
      const visit = await ownedVisit(ctx, owner, context.visitLocalId);
      save = await requireOwnedSave(ctx, owner, context.saveLocalId);
      await requireMembership(ctx, save, visit);
    }
    if (context.photoLocalId) {
      const photo = await ownedAlbumPhoto(ctx, save, context.photoLocalId);
      if (!photo.storageId) throw new ConvexError({ code: 'not_found' });
      return photo.storageId;
    }
    const asset = await resolveDisplayAsset(ctx, save);
    if (!asset?.storageId || projectArtwork(save, asset, context).media.kind !== 'derivative') throw new ConvexError({ code: 'not_found' });
    // A media row must never turn a reusable owner photo into a social derivative.
    const crop = await ctx.db.query('collections').withIndex('by_cropStorageId_deletedAt', (q) => q.eq('cropStorageId', asset.storageId)).first();
    const album = await ctx.db.query('artworkPhotos').withIndex('by_storageId', (q) => q.eq('storageId', asset.storageId)).first();
    if (crop || album) throw new ConvexError({ code: 'not_found' });
    return asset.storageId;
  },
});

// The wall transport supplies the validated context and forwards the caller's auth.
export async function serveSharedMedia(ctx: Pick<ActionCtx, 'runQuery'> & { storage: Pick<ActionCtx['storage'], 'get'> },
  context: Infer<typeof sharedMediaContext>): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const storageId = await ctx.runQuery(internal.sharedMedia.authorize, { context });
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new ConvexError({ code: 'not_found' });
    // Recheck after fetching the bytes so a revocation during storage IO is honored.
    if (await ctx.runQuery(internal.sharedMedia.authorize, { context }) !== storageId) throw new ConvexError({ code: 'not_found' });
    return new Response(blob, { headers: { ...headers, 'Content-Type': blob.type || 'application/octet-stream' } });
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    return Response.json({ code: 'not_found' }, { status: 404, headers });
  }
}

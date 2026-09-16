import { ConvexError, v } from 'convex/values';

import { MAX_COLLECTION_PHOTO_BYTES, type CollectionPhotoKind } from '../shared/collection/photo-limits';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireDeviceFromAction } from './lib/auth';
import { ownedAlbumPhoto } from './lib/albumMedia';
import { deleteUnreferencedPhoto } from './lib/collectionPhotos';
import { nextChangeVersion, requireJournalOwner, requireOwnedSave } from './lib/ownership';
import { isUuid } from '../shared/journal/limits';
import { limitDevice } from './lib/rateLimits';

const kindValidator = v.union(v.literal('photo'), v.literal('crop'));
const args = { scope: v.string(), localId: v.string(), kind: kindValidator, photoId: v.optional(v.string()) };

async function requireCollection(ctx: QueryCtx | MutationCtx, scope: string, localId: string) {
  const { owner } = await requireJournalOwner(ctx, scope);
  return requireOwnedSave(ctx, owner, localId);
}

// A save carries only its crop; every full-frame photo is an album row addressed by photoId.
async function target(ctx: QueryCtx | MutationCtx, scope: string, localId: string, kind: CollectionPhotoKind, photoId?: string) {
  const save = await requireCollection(ctx, scope, localId);
  if (kind === 'crop') return { save, photo: undefined };
  if (!photoId) throw new ConvexError({ code: 'invalid_photo' });
  return { save, photo: await ownedAlbumPhoto(ctx, save, photoId) };
}

export const findForCaller = internalQuery({
  args, returns: v.union(v.id('_storage'), v.null()),
  handler: async (ctx, { scope, localId, kind, photoId }) => {
    const { save, photo } = await target(ctx, scope, localId, kind, photoId);
    return (photo ? photo.storageId : save.cropStorageId) ?? null;
  },
});

// Only the authenticated HTTP upload can attach a freshly stored file. Clients cannot claim storage IDs.
export const attach = internalMutation({
  args: { ...args, storageId: v.id('_storage'), width: v.optional(v.number()), height: v.optional(v.number()) }, returns: v.id('_storage'),
  handler: async (ctx, { scope, localId, kind, photoId, storageId, width, height }) => {
    const { save, photo } = await target(ctx, scope, localId, kind, photoId);
    const existing = photo ? photo.storageId : save.cropStorageId;
    if (existing) {
      if (existing !== storageId) await deleteUnreferencedPhoto(ctx, storageId);
      return existing;
    }
    const changeVersion = await nextChangeVersion(ctx, save.owner);
    if (photo) await ctx.db.patch(photo._id, { storageId, width, height, changeVersion });
    else await ctx.db.patch(save._id, { cropStorageId: storageId, photoUpdatedAt: Date.now(), changeVersion });
    return storageId;
  },
});

function parameters(request: Request): { scope: string; localId: string; kind: CollectionPhotoKind; photoId?: string } {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const localId = url.searchParams.get('localId'), kind = url.searchParams.get('kind');
  if (!scope || scope.length > 256 || !localId || !isUuid(localId) || (kind !== 'photo' && kind !== 'crop')) {
    throw new ConvexError({ code: 'invalid_photo' });
  }
  const photoId = url.searchParams.get('photoId') ?? undefined;
  if (kind === 'photo' ? !photoId || !isUuid(photoId) : photoId !== undefined) throw new ConvexError({ code: 'invalid_photo' });
  return { scope, localId, kind, photoId };
}

function failure(error: unknown): Response {
  const code = error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'code' in error.data
    ? String(error.data.code) : 'photo_failed';
  const status = code === 'unauthenticated' ? 401 : code === 'not_found' ? 404 :
    code === 'device_banned' || code === 'device_not_registered' ? 403 :
    code === 'sync_scope_changed' || code === 'claim_required' ? 409 : code === 'rate_limited' ? 429 : code === 'photo_too_large' ? 413 : code === 'invalid_photo' ? 400 : 500;
  return Response.json({ code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export const upload = httpAction(async (ctx, request) => {
  let uploaded: Id<'_storage'> | undefined;
  try {
    const device = await requireDeviceFromAction(ctx);
    const input = parameters(request);
    const existing = await ctx.runQuery(internal.collectionPhotos.findForCaller, input);
    if (existing) return Response.json({ storageId: existing });
    await limitDevice(ctx, 'photoUpload', device._id);
    if (Number(request.headers.get('Content-Length')) > MAX_COLLECTION_PHOTO_BYTES) {
      throw new ConvexError({ code: 'photo_too_large' });
    }
    if (request.headers.get('Content-Type') !== 'image/jpeg') throw new ConvexError({ code: 'invalid_photo' });
    const blob = await request.blob();
    if (blob.size > MAX_COLLECTION_PHOTO_BYTES) throw new ConvexError({ code: 'photo_too_large' });
    const header = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) throw new ConvexError({ code: 'invalid_photo' });
    uploaded = await ctx.storage.store(blob);
    const width = Number(request.headers.get('X-Photo-Width')), height = Number(request.headers.get('X-Photo-Height'));
    const dimensions = width > 0 && height > 0 && width <= 65535 && height <= 65535 ? { width, height } : {};
    const storageId = await ctx.runMutation(internal.collectionPhotos.attach, { ...input, storageId: uploaded, ...dimensions });
    return Response.json({ storageId });
  } catch (error) {
    if (uploaded) await ctx.runMutation(internal.collectionPhotos.discard, { storageId: uploaded });
    return failure(error);
  }
});

export const discard = internalMutation({
  args: { storageId: v.id('_storage') }, returns: v.null(),
  handler: async (ctx, { storageId }) => { await deleteUnreferencedPhoto(ctx, storageId); return null; },
});

export const download = httpAction(async (ctx, request) => {
  try {
    const storageId = await ctx.runQuery(internal.collectionPhotos.findForCaller, parameters(request));
    const blob = storageId ? await ctx.storage.get(storageId) : null;
    if (!blob) throw new ConvexError({ code: 'not_found' });
    return new Response(blob, { headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return failure(error); }
});

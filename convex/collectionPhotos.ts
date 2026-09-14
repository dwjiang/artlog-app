import { ConvexError, v } from 'convex/values';

import { MAX_COLLECTION_PHOTO_BYTES, type CollectionPhotoKind } from '../shared/collection/photo-limits';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireDevice, requireDeviceFromAction } from './lib/auth';
import { deleteUnreferencedPhoto } from './lib/collectionPhotos';
import { limitDevice } from './lib/rateLimits';

const kindValidator = v.union(v.literal('photo'), v.literal('crop'));
const args = { localId: v.string(), kind: kindValidator };

async function requireCollection(ctx: QueryCtx | MutationCtx, localId: string) {
  const device = await requireDevice(ctx);
  const row = await ctx.db.query('collections').withIndex('by_device_localId',
    (q) => q.eq('deviceId', device._id).eq('localId', localId)).unique();
  if (!row || row.deletedAt !== undefined) throw new ConvexError({ code: 'not_found' });
  return row;
}

export const findForCaller = internalQuery({
  args, returns: v.union(v.id('_storage'), v.null()),
  handler: async (ctx, { localId, kind }) => (await requireCollection(ctx, localId))[`${kind}StorageId`] ?? null,
});

// Only the authenticated HTTP upload can attach a freshly stored file. Clients cannot claim storage IDs.
export const attach = internalMutation({
  args: { ...args, storageId: v.id('_storage') }, returns: v.id('_storage'),
  handler: async (ctx, { localId, kind, storageId }) => {
    const row = await requireCollection(ctx, localId);
    const existing = row[`${kind}StorageId`];
    if (existing) {
      if (existing !== storageId) await deleteUnreferencedPhoto(ctx, storageId);
      return existing;
    }
    await ctx.db.patch(row._id, { [`${kind}StorageId`]: storageId, photoUpdatedAt: Date.now() });
    return storageId;
  },
});

function parameters(request: Request): { localId: string; kind: CollectionPhotoKind } {
  const url = new URL(request.url);
  const localId = url.searchParams.get('localId'), kind = url.searchParams.get('kind');
  if (!localId?.trim() || localId.length > 200 || (kind !== 'photo' && kind !== 'crop')) {
    throw new ConvexError({ code: 'invalid_photo' });
  }
  return { localId, kind };
}

function failure(error: unknown): Response {
  const code = error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'code' in error.data
    ? String(error.data.code) : 'photo_failed';
  const status = code === 'unauthenticated' ? 401 : code === 'not_found' ? 404 :
    code === 'device_banned' || code === 'device_not_registered' ? 403 :
    code === 'rate_limited' ? 429 : code === 'photo_too_large' ? 413 : code === 'invalid_photo' ? 400 : 500;
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
    const storageId = await ctx.runMutation(internal.collectionPhotos.attach, { ...input, storageId: uploaded });
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

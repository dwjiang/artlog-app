import { ConvexError, v } from 'convex/values';

import { MAX_NOTE_LENGTH } from '../shared/collection/collection-limits';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, type MutationCtx } from './_generated/server';
import { requireDevice } from './lib/auth';
import { deleteUnreferencedCollectionPhotos } from './lib/collectionPhotos';
import { limitDevice } from './lib/rateLimits';
import { snapshotFields } from './lib/validators';
import schema from './schema';

const pushedWork = v.object({
  localId: v.string(),
  snapshot: snapshotFields, venueId: v.optional(v.id('museums')), venueName: v.optional(v.string()),
  gallery: v.optional(v.string()), savedAt: v.number(),
  objectId: v.optional(v.id('objects')), artworkId: v.optional(v.id('artworks')),
  note: v.optional(v.string()), deletedAt: v.optional(v.number()),
});
const cursor = v.object({ deviceIndex: v.number(), page: v.union(v.string(), v.null()), until: v.number(), photos: v.boolean() });
const collectionDoc = v.object({ _id: v.id('collections'), _creationTime: v.number(), ...schema.tables.collections.validator.fields });

async function retainImportedWork(ctx: MutationCtx, deviceId: Id<'devices'>, row: Doc<'collections'>): Promise<void> {
  if (row.deviceId === deviceId) return;
  const existing = await ctx.db.query('collections')
    .withIndex('by_device_localId', (q) => q.eq('deviceId', deviceId).eq('localId', row.localId)).unique();
  if (!existing) {
    await ctx.db.insert('collections', {
      deviceId, localId: row.localId, snapshot: row.snapshot, savedAt: row.savedAt,
      venueId: row.venueId, venueName: row.venueName, gallery: row.gallery,
      objectId: row.objectId, artworkId: row.artworkId, note: row.note, deletedAt: row.deletedAt,
      photoStorageId: row.photoStorageId, cropStorageId: row.cropStorageId,
      updatedAt: row.updatedAt, updatedBy: row.updatedBy, photoUpdatedAt: row.photoUpdatedAt, confirmationRecorded: true,
    });
    return;
  }
  // Retention keeps the original edit version; copying a stale note must not make it win a conflict.
  const newer = row.updatedAt > existing.updatedAt ||
    (row.updatedAt === existing.updatedAt && row.updatedBy > existing.updatedBy);
  const photos = {
    photoStorageId: existing.photoStorageId ?? row.photoStorageId,
    cropStorageId: existing.cropStorageId ?? row.cropStorageId,
  };
  if (newer || (existing.deletedAt === undefined && row.deletedAt !== undefined) ||
    photos.photoStorageId !== existing.photoStorageId || photos.cropStorageId !== existing.cropStorageId) {
    await ctx.db.patch(existing._id, {
      ...photos,
      photoUpdatedAt: Math.max(existing.photoUpdatedAt ?? 0, row.photoUpdatedAt ?? 0) || undefined,
      ...(newer ? { note: row.note, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : {}),
      deletedAt: existing.deletedAt ?? row.deletedAt,
    });
    if (existing.deletedAt !== undefined || row.deletedAt !== undefined) await deleteUnreferencedCollectionPhotos(ctx, photos);
  }
}

export const syncCollection = mutation({
  args: { push: v.array(pushedWork), since: v.number(), scope: v.string(), cursor: v.optional(cursor) },
  returns: v.object({
    pulled: v.array(collectionDoc), serverTime: v.number(), cursor: v.union(cursor, v.null()),
    accepted: v.array(v.object({ localId: v.string(), updatedAt: v.number(), updatedBy: v.id('devices'), deletedAt: v.optional(v.number()) })),
  }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    await limitDevice(ctx, 'sync', device._id);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    const scope = account ? `${account._id}:${account.deviceIds.slice().sort().join(',')}` : device._id;
    if (args.scope !== scope) throw new ConvexError({ code: 'sync_scope_changed' });
    const members = account?.deviceIds ?? [device._id];
    if (args.push.length > 500 || !Number.isFinite(args.since) || args.since < 0) {
      throw new ConvexError({ code: 'invalid_sync' });
    }
    const now = Date.now();
    const accepted = [];
    for (const work of args.push) {
      if (!work.localId.trim() || work.localId.length > 200 || !work.snapshot.title.trim() ||
        !Number.isFinite(work.savedAt) || (work.note?.length ?? 0) > MAX_NOTE_LENGTH ||
        Object.values(work.snapshot).some((value) => value.length > 10_000) ||
        (work.deletedAt !== undefined && !Number.isFinite(work.deletedAt))) {
        throw new ConvexError({ code: 'invalid_save' });
      }
      // The save UUID survives imports; each device writes only its own copy.
      const existing = await ctx.db.query('collections')
        .withIndex('by_device_localId', (q) => q.eq('deviceId', device._id).eq('localId', work.localId)).unique();
      const deletedAt = existing?.deletedAt ?? work.deletedAt;
      const version = { updatedAt: now, updatedBy: device._id };
      if (existing) {
        // A push republishes this copy; snapshots stay immutable and deletion stays terminal.
        await ctx.db.patch(existing._id, { note: work.note, deletedAt, ...version });
        if (deletedAt !== undefined) await deleteUnreferencedCollectionPhotos(ctx, existing);
      } else {
        await ctx.db.insert('collections', { ...work, deviceId: device._id, ...version });
      }
      accepted.push({ localId: work.localId, ...version, ...(deletedAt === undefined ? {} : { deletedAt }) });
    }
    // Read retained copies first so new imports are not returned twice in the same pull window.
    const siblings = account ? [device._id, ...members.filter((id) => id !== device._id).sort()] : [];
    const state = args.cursor ?? { deviceIndex: 0, page: null, until: now, photos: false };
    if (!Number.isInteger(state.deviceIndex) || state.deviceIndex < 0 || state.deviceIndex > siblings.length ||
      !Number.isFinite(state.until) || state.until > now || state.until < args.since) {
      throw new ConvexError({ code: 'invalid_sync_cursor' });
    }
    const sibling = siblings[state.deviceIndex];
    if (!sibling) return { accepted, pulled: [], serverTime: state.until, cursor: null };
    // Inclusive lower / exclusive upper bounds also preserve writes made in the checkpoint's millisecond.
    // Edited rows carry their photos, so the photo pass only covers photos that arrived after an older edit was pulled.
    const latePhotos = () => ctx.db.query('collections').withIndex('by_device_photoUpdatedAt',
      (q) => q.eq('deviceId', sibling).gte('photoUpdatedAt', args.since).lt('photoUpdatedAt', state.until))
      .filter((q) => q.lt(q.field('updatedAt'), args.since));
    const changes = state.photos ? latePhotos() : ctx.db.query('collections').withIndex('by_device_updatedAt',
      (q) => q.eq('deviceId', sibling).gte('updatedAt', args.since).lt('updatedAt', state.until));
    const page = await changes.paginate({ numItems: 500, cursor: state.page, maximumBytesRead: 500_000 });
    for (const row of page.page) await retainImportedWork(ctx, device._id, row);
    // A sibling without late photos costs one round trip; only a non-empty photo pass takes another.
    const next = !page.isDone ? { ...state, page: page.continueCursor }
      : !state.photos && await latePhotos().first() ? { ...state, page: null, photos: true }
        : state.deviceIndex + 1 < siblings.length ? { ...state, deviceIndex: state.deviceIndex + 1, page: null, photos: false } : null;
    const pulled = page.page.filter((row) => row.updatedBy !== device._id || row.deletedAt !== undefined || row.photoStorageId || row.cropStorageId);
    return { accepted, pulled, serverTime: state.until, cursor: next };
  },
});

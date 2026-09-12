import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireDevice } from './lib/auth';
import { limitDevice } from './lib/rateLimits';
import { snapshotFields } from './lib/validators';

const suggestion = v.object({ title: v.string(), artist: v.string() });

const same = (a: string, b: string) => a.trim() === b.trim();

export const saveToCollection = mutation({
  args: {
    localId: v.string(), scanId: v.optional(v.id('scans')), objectId: v.optional(v.id('objects')),
    artworkId: v.optional(v.id('artworks')), venueId: v.optional(v.id('museums')), visitId: v.optional(v.id('visits')),
    gallery: v.optional(v.string()), snapshot: snapshotFields, suggested: v.union(suggestion, v.null()),
    savedAt: v.number(), venueName: v.optional(v.string()),
  },
  returns: v.object({ collectionId: v.id('collections'), updatedAt: v.number(), updatedBy: v.id('devices'), deletedAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    await limitDevice(ctx, 'sync', device._id);
    if (!args.localId.trim() || args.localId.length > 200 || !args.snapshot.title.trim()) {
      throw new ConvexError({ code: 'invalid_save' });
    }
    const existing = await ctx.db.query('collections')
      .withIndex('by_device_localId', (q) => q.eq('deviceId', device._id).eq('localId', args.localId)).unique();
    if (existing?.confirmationRecorded) return {
      collectionId: existing._id, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy, deletedAt: existing.deletedAt,
    };
    if (args.scanId) {
      const scan = await ctx.db.get(args.scanId);
      if (!scan || scan.deviceId !== device._id) throw new ConvexError({ code: 'invalid_scan' });
    }
    if (args.visitId) {
      const visit = await ctx.db.get(args.visitId);
      if (!visit || visit.deviceId !== device._id) throw new ConvexError({ code: 'invalid_visit' });
    }
    const objectId = existing ? existing.objectId : args.objectId;
    const object = objectId ? await ctx.db.get(objectId) : null;
    if (objectId && !object) throw new ConvexError({ code: 'invalid_object' });
    const { suggested, ...row } = args;
    const updatedAt = existing?.updatedAt ?? Date.now();
    const updatedBy = existing?.updatedBy ?? device._id;
    const collectionId = existing?._id ?? await ctx.db.insert('collections', {
      ...row, deviceId: device._id, updatedAt, updatedBy, confirmationRecorded: true,
    });
    if (existing) await ctx.db.patch(existing._id, { confirmationRecorded: true });
    // Design §4.6: an untouched suggestion is a confirm; an edited title or artist counts as nothing.
    const artwork = object && suggested ? await ctx.db.get(object.artworkId) : null;
    const snapshot = existing?.snapshot ?? args.snapshot;
    if (object && suggested && artwork &&
      same(snapshot.title, suggested.title) && same(snapshot.artist, suggested.artist) &&
      same(suggested.title, artwork.title) && same(suggested.artist, artwork.artist)) {
      await ctx.db.patch(object._id, { confirmCount: object.confirmCount + 1 });
    }
    return { collectionId, updatedAt, updatedBy, deletedAt: existing?.deletedAt };
  },
});

export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const device = await requireDevice(ctx);
    return ctx.db.query('collections')
      .withIndex('by_device_savedAt', (q) => q.eq('deviceId', device._id)).order('desc')
      .filter((q) => q.eq(q.field('deletedAt'), undefined))
      .paginate(paginationOpts);
  },
});

export const remove = mutation({
  args: { localId: v.string() },
  returns: v.null(),
  handler: async (ctx, { localId }) => {
    const device = await requireDevice(ctx);
    const row = await ctx.db.query('collections')
      .withIndex('by_device_localId', (q) => q.eq('deviceId', device._id).eq('localId', localId)).unique();
    if (!row) throw new ConvexError({ code: 'not_found' });
    if (row.deletedAt === undefined) await ctx.db.patch(row._id, { deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: device._id });
    return null;
  },
});

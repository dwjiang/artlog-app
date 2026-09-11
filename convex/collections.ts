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
  },
  returns: v.object({ collectionId: v.id('collections') }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    await limitDevice(ctx, 'sync', device._id);
    if (!args.localId.trim() || args.localId.length > 200 || !args.snapshot.title.trim()) {
      throw new ConvexError({ code: 'invalid_save' });
    }
    const existing = await ctx.db.query('collections')
      .withIndex('by_device_localId', (q) => q.eq('deviceId', device._id).eq('localId', args.localId)).unique();
    if (existing) return { collectionId: existing._id };
    if (args.scanId) {
      const scan = await ctx.db.get(args.scanId);
      if (!scan || scan.deviceId !== device._id) throw new ConvexError({ code: 'invalid_scan' });
    }
    if (args.visitId) {
      const visit = await ctx.db.get(args.visitId);
      if (!visit || visit.deviceId !== device._id) throw new ConvexError({ code: 'invalid_visit' });
    }
    const object = args.objectId ? await ctx.db.get(args.objectId) : null;
    if (args.objectId && !object) throw new ConvexError({ code: 'invalid_object' });
    const { suggested, ...row } = args;
    const collectionId = await ctx.db.insert('collections', {
      ...row, deviceId: device._id, accountId: device.accountId, savedAt: Date.now(),
    });
    // Design §4.6: an untouched suggestion is a confirm; an edited title or artist counts as nothing.
    const artwork = object && suggested ? await ctx.db.get(object.artworkId) : null;
    if (object && suggested && artwork &&
      same(args.snapshot.title, suggested.title) && same(args.snapshot.artist, suggested.artist) &&
      same(suggested.title, artwork.title) && same(suggested.artist, artwork.artist)) {
      await ctx.db.patch(object._id, { confirmCount: object.confirmCount + 1 });
    }
    return { collectionId };
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
    if (row.deletedAt === undefined) await ctx.db.patch(row._id, { deletedAt: Date.now() });
    return null;
  },
});

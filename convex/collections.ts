import { pageArgs, pagination, validateSave } from '../shared/journal/contracts';
import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireJournalOwner, findOwnedSave, nextChangeVersion } from './lib/ownership';
import { upsertJournalSave } from './lib/journal';
import { invalidateDeletedSave } from './lib/publicationAccess';
import schema from './schema';
import { limitDevice } from './lib/rateLimits';
import { snapshotFields } from './lib/validators';

const suggestion = v.object({ title: v.string(), artist: v.string() });

const same = (a: string, b: string) => a.trim() === b.trim();

export const saveToCollection = mutation({
  args: {
    scope: v.string(), visitLocalId: v.optional(v.string()), localId: v.string(), scanId: v.optional(v.id('scans')), objectId: v.optional(v.id('objects')),
    artworkId: v.optional(v.id('artworks')), venueId: v.optional(v.id('museums')),
    gallery: v.optional(v.string()), snapshot: snapshotFields, suggested: v.union(suggestion, v.null()),
    savedAt: v.number(), venueName: v.optional(v.string()),
  },
  returns: v.object({ collectionId: v.id('collections'), updatedAt: v.number(), updatedBy: v.id('devices'), deletedAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const { device, owner } = await requireJournalOwner(ctx, args.scope);
    await limitDevice(ctx, 'sync', device._id);
    validateSave(args);
    const existing = await findOwnedSave(ctx, owner, args.localId);
    if (existing && (existing.confirmationRecorded || existing.deletedAt !== undefined)) return {
      collectionId: existing._id, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy, deletedAt: existing.deletedAt,
    };
    if (args.scanId) {
      const scan = await ctx.db.get(args.scanId);
      if (!scan || scan.deviceId !== device._id) throw new ConvexError({ code: 'invalid_scan' });
    }
    const { suggested, scope: _scope, scanId, ...row } = args;
    const saved = existing ?? await upsertJournalSave(ctx, owner, device._id, row);
    const objectId = saved.objectId;
    const object = objectId ? await ctx.db.get(objectId) : null;
    const { updatedAt, updatedBy, _id: collectionId } = saved;
    await ctx.db.patch(collectionId, { confirmationRecorded: true, ...(scanId ? { scanId } : {}) });
    // An untouched suggestion is a confirm; an edited title or artist counts as nothing.
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
  args: { scope: v.string(), ...pageArgs },
  returns: v.object({ page: v.array(schema.doc('collections')), cursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const { owner } = await requireJournalOwner(ctx, args.scope);
    const result = await ctx.db.query('collections')
      .withIndex('by_owner_savedAt', (q) => q.eq('owner', owner).eq('deletedAt', undefined)).order('desc').paginate(pagination(args));
    return { page: result.page, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
  },
});

export const remove = mutation({
  args: { scope: v.string(), localId: v.string() }, returns: v.null(),
  handler: async (ctx, { scope, localId }) => {
    const { device, owner } = await requireJournalOwner(ctx, scope);
    const row = await findOwnedSave(ctx, owner, localId);
    if (!row) throw new ConvexError({ code: 'not_found' });
    if (row.deletedAt === undefined) {
      await ctx.db.patch(row._id, { deletedAt: Date.now(), updatedAt: Date.now(), updatedBy: device._id,
        changeVersion: await nextChangeVersion(ctx, owner) });
      await invalidateDeletedSave(ctx, (await ctx.db.get(row._id))!);
    }
    return null;
  },
});

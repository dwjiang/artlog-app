import { ConvexError, type Infer, v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, type MutationCtx } from './_generated/server';
import { deleteOrbIfUnreferenced } from './lib/orbStorage';
import { clearDocent } from './docent';
import { bumpCounter } from './ingest';

// Outer cascades select small pages; each object's child tables are cleaned in separate transactions.
const CHUNK = 25;
const CHUNK_BYTES = 2 * 1024 * 1024;
const cursorArg = v.union(v.string(), v.null());
const cleanupPhase = v.union(v.literal('vectors'), v.literal('descriptors'), v.literal('placements'), v.literal('contributions'));

export async function beginRevert(ctx: MutationCtx, object: Doc<'objects'>, reason: string): Promise<void> {
  if (object.reverted) return;
  await ctx.db.patch(object._id, {
    reverted: true, revertedReason: reason, thumbnailStorageId: undefined,
    ...(object.thumbnailStorageId ? { imageRef: undefined } : {}),
  });
  if (object.thumbnailStorageId) await ctx.storage.delete(object.thumbnailStorageId);
}

export const beginObjectRevert = internalMutation({
  args: { objectId: v.id('objects'), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { objectId, reason }) => {
    const object = await ctx.db.get(objectId);
    if (!object) throw new ConvexError({ code: 'object_not_found' });
    await beginRevert(ctx, object, reason);
    return null;
  },
});

export const cleanupObjectPage = internalMutation({
  args: { objectId: v.id('objects'), phase: cleanupPhase, cursor: cursorArg },
  returns: cursorArg,
  handler: async (ctx, { objectId, phase, cursor }) => {
    const object = await ctx.db.get(objectId);
    if (!object?.reverted) throw new ConvexError({ code: 'object_not_reverted' });
    const options = { cursor, numItems: 64, maximumBytesRead: 1024 * 1024 };
    switch (phase) {
      case 'vectors': {
        const page = await ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) => q.eq('objectId', objectId)).paginate(options);
        for (const row of page.page) await ctx.db.delete(row._id);
        await bumpCounter(ctx, 'vectors', -page.page.length);
        return page.isDone ? null : page.continueCursor;
      }
      case 'descriptors': {
        const page = await ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', objectId)).paginate(options);
        for (const row of page.page) {
          await ctx.db.delete(row._id);
          await deleteOrbIfUnreferenced(ctx, row.storageId);
        }
        await bumpCounter(ctx, 'descriptors', -page.page.length);
        return page.isDone ? null : page.continueCursor;
      }
      case 'placements': {
        const page = await ctx.db.query('placements').withIndex('by_objectId', (q) => q.eq('objectId', objectId)).paginate(options);
        for (const row of page.page) {
          if (row.closedAt === undefined) await ctx.db.patch(row._id, { closedAt: Date.now() });
        }
        return page.isDone ? null : page.continueCursor;
      }
      case 'contributions': {
        const page = await ctx.db.query('contributions').withIndex('by_promotedObject_device', (q) => q.eq('promotedObjectId', objectId)).paginate(options);
        for (const row of page.page) {
          const missingCrop = row.cropStorageId && !await ctx.db.system.get('_storage', row.cropStorageId);
          await ctx.db.patch(row._id, {
            ...(row.status === 'rejected' ? {} : { status: 'rejected', rejectedReason: 'object_reverted' }),
            ...(missingCrop ? { cropStorageId: undefined } : {}),
          });
        }
        return page.isDone ? null : page.continueCursor;
      }
    }
  },
});

export const revertObjectById = internalAction({
  args: { objectId: v.id('objects'), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { objectId, reason }) => {
    await ctx.runMutation(internal.revert.beginObjectRevert, { objectId, reason });
    // Restarting after an interrupted action is safe: deletion, closing and rejection are idempotent.
    for (const phase of ['vectors', 'descriptors', 'placements', 'contributions'] as const) {
      let cursor: string | null = null;
      do {
        cursor = await ctx.runMutation(internal.revert.cleanupObjectPage, { objectId, phase, cursor });
      } while (cursor !== null);
    }
    return null;
  },
});

const deviceCursor = v.object({
  phase: v.union(v.literal('objects'), v.literal('contributions'), v.literal('proposals'), v.literal('feedback'),
    v.literal('promotedProposals'), v.literal('firstWitness'), v.literal('secondWitness')),
  cursor: v.union(v.string(), v.null()),
});
type DeviceCursor = Infer<typeof deviceCursor>;
// The device's own rows are rejected first so they carry the ban as their reason; reverting a shared
// object afterwards only touches the partners' contributions.
const NEXT_PHASE: Record<DeviceCursor['phase'], DeviceCursor['phase'] | null> = {
  contributions: 'objects', objects: 'proposals', proposals: 'promotedProposals', promotedProposals: 'feedback', feedback: 'firstWitness',
  firstWitness: 'secondWitness', secondWitness: null,
};

function paging(cursor: string | null) {
  return { cursor, numItems: CHUNK, maximumBytesRead: CHUNK_BYTES };
}

async function resetMultiView(ctx: MutationCtx, row: Doc<'feedback'>): Promise<number> {
  const vector = row.multiViewVectorId ? await ctx.db.get(row.multiViewVectorId) : null;
  if (vector) {
    await ctx.db.delete(vector._id);
    await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, { vectorId: vector._id, cursor: null });
  }
  await ctx.db.patch(row._id, {
    multiViewAt: undefined, multiViewVectorId: undefined, multiViewDuplicateVectorId: undefined, multiViewAgreement: undefined,
  });
  return Number(vector !== null);
}

export const requeueDuplicateViews = internalMutation({
  args: { vectorId: v.id('vectors'), cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { vectorId, cursor }) => {
    const page = await ctx.db.query('feedback')
      .withIndex('by_multiViewDuplicateVectorId', (q) => q.eq('multiViewDuplicateVectorId', vectorId)).paginate(paging(cursor));
    for (const row of page.page) await resetMultiView(ctx, row);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, { vectorId, cursor: page.continueCursor });
    return null;
  },
});

async function revertDevicePhase(ctx: MutationCtx, deviceId: Id<'devices'>, at: DeviceCursor, now: number) {
  switch (at.phase) {
    case 'objects': {
      const page = await ctx.db.query('objects').withIndex('by_source', (q) => q.eq('source', 'user')).paginate(paging(at.cursor));
      const objectIds: Id<'objects'>[] = [];
      for (const object of page.page) {
        if (object.provenance?.deviceIds.includes(deviceId)) objectIds.push(object._id);
      }
      return { cursor: page.isDone ? null : page.continueCursor, objectIds };
    }
    case 'contributions': {
      const page = await ctx.db.query('contributions').withIndex('by_deviceId', (q) => q.eq('deviceId', deviceId)).paginate(paging(at.cursor));
      for (const row of page.page) {
        if (row.status !== 'rejected') await ctx.db.patch(row._id, { status: 'rejected', rejectedReason: 'device_reverted' });
      }
      return { cursor: page.isDone ? null : page.continueCursor, objectIds: [] };
    }
    case 'proposals': {
      const page = await ctx.db.query('placementProposals').withIndex('by_status', (q) => q.eq('status', 'pending')).paginate(paging(at.cursor));
      for (const row of page.page) {
        if (row.deviceIds.includes(deviceId)) await ctx.db.patch(row._id, { status: 'rejected', reviewedAt: now });
      }
      return { cursor: page.isDone ? null : page.continueCursor, objectIds: [] };
    }
    case 'promotedProposals': {
      const page = await ctx.db.query('placementProposals').withIndex('by_status', (q) => q.eq('status', 'promoted')).paginate(paging(at.cursor));
      for (const row of page.page) {
        if (row.kind === 'move' && row.deviceIds.includes(deviceId) && row.revertedAt === undefined) {
          await ctx.scheduler.runAfter(0, internal.placements.revertMove, { proposalId: row._id });
        }
      }
      return { cursor: page.isDone ? null : page.continueCursor, objectIds: [] };
    }
    case 'feedback': {
      const page = await ctx.db.query('feedback').withIndex('by_device_object', (q) => q.eq('deviceId', deviceId)).paginate(paging(at.cursor));
      let deleted = 0;
      for (const row of page.page) {
        deleted += await resetMultiView(ctx, row);
        await ctx.db.patch(row._id, { resolution: { kind: 'unresolved' } });
      }
      await bumpCounter(ctx, 'vectors', -deleted);
      return { cursor: page.isDone ? null : page.continueCursor, objectIds: [] };
    }
    case 'firstWitness':
    case 'secondWitness': {
      const query = at.phase === 'firstWitness'
        ? ctx.db.query('feedback').withIndex('by_multiViewFirstDevice', (q) => q.eq('multiViewAgreement.firstDeviceId', deviceId))
        : ctx.db.query('feedback').withIndex('by_multiViewSecondDevice', (q) => q.eq('multiViewAgreement.secondDeviceId', deviceId));
      const page = await query.paginate(paging(at.cursor));
      let deleted = 0;
      for (const row of page.page) deleted += await resetMultiView(ctx, row);
      await bumpCounter(ctx, 'vectors', -deleted);
      return { cursor: page.isDone ? null : page.continueCursor, objectIds: [] };
    }
  }
}

export const revertDevice = internalMutation({
  args: { deviceId: v.id('devices'), reason: v.string(), cursor: v.optional(deviceCursor) },
  returns: v.union(deviceCursor, v.null()),
  handler: async (ctx, { deviceId, reason, cursor }) => {
    const device = await ctx.db.get(deviceId);
    if (!device) throw new ConvexError({ code: 'device_not_found' });
    const now = Date.now();
    if (!cursor) await ctx.db.patch(deviceId, { banned: true, bannedReason: reason });
    const at = cursor ?? { phase: 'contributions', cursor: null };
    const page = await revertDevicePhase(ctx, deviceId, at, now);
    const phase = page.cursor === null ? NEXT_PHASE[at.phase] : at.phase;
    const next = phase === null ? null : { phase, cursor: page.cursor };
    if (page.objectIds.length) await ctx.scheduler.runAfter(0, internal.revert.revertDeviceObjects, { deviceId, reason, objectIds: page.objectIds, next });
    else if (next) await ctx.scheduler.runAfter(0, internal.revert.revertDevice, { deviceId, reason, cursor: next });
    return next;
  },
});

export const revertDeviceObjects = internalAction({
  args: { deviceId: v.id('devices'), reason: v.string(), objectIds: v.array(v.id('objects')), next: v.union(deviceCursor, v.null()) },
  returns: v.null(),
  handler: async (ctx, { deviceId, reason, objectIds, next }) => {
    for (const objectId of objectIds) await ctx.runAction(internal.revert.revertObjectById, { objectId, reason: `device_reverted: ${reason}` });
    if (next) await ctx.scheduler.runAfter(0, internal.revert.revertDevice, { deviceId, reason, cursor: next });
    return null;
  },
});

const rightsTarget = v.union(
  v.object({ kind: v.literal('venue'), venueId: v.id('museums'), optOutId: v.id('optOuts') }),
  v.object({ kind: v.literal('artwork'), artworkId: v.id('artworks'), takedownId: v.id('takedowns') }),
  v.object({ kind: v.literal('object'), takedownId: v.id('takedowns') }),
);

export const completeRightsRequest = internalMutation({
  args: { requestId: v.union(v.id('optOuts'), v.id('takedowns')) },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    await ctx.db.patch(requestId, { appliedAt: Date.now() });
    return null;
  },
});

export const revertRightsObjects = internalAction({
  args: { objectIds: v.array(v.id('objects')), proposalIds: v.array(v.id('placementProposals')), target: rightsTarget, cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { objectIds, proposalIds, target, cursor }) => {
    const reason = target.kind === 'venue' ? `opt_out: ${target.venueId}` : `takedown: ${target.takedownId}`;
    for (const proposalId of proposalIds) await ctx.runMutation(internal.placements.revertMove, { proposalId });
    for (const objectId of objectIds) await ctx.runAction(internal.revert.revertObjectById, { objectId, reason });
    if (cursor === null) {
      await ctx.runMutation(internal.revert.completeRightsRequest, { requestId: target.kind === 'venue' ? target.optOutId : target.takedownId });
    } else if (target.kind === 'venue') {
      await ctx.scheduler.runAfter(0, internal.revert.revertVenueObjects, { venueId: target.venueId, optOutId: target.optOutId, cursor });
    } else if (target.kind === 'artwork') {
      await ctx.scheduler.runAfter(0, internal.revert.revertArtworkObjects, { artworkId: target.artworkId, takedownId: target.takedownId, cursor });
    }
    return null;
  },
});

export const applyOptOut = internalMutation({
  args: { venueId: v.id('museums'), requester: v.string() },
  returns: v.id('optOuts'),
  handler: async (ctx, { venueId, requester }) => {
    const venue = await ctx.db.get(venueId);
    if (!venue) throw new ConvexError({ code: 'venue_not_found' });
    const optOutId = await ctx.db.insert('optOuts', { venueId, requester, receivedAt: Date.now() });
    await ctx.db.patch(venueId, { optOut: true });
    await ctx.scheduler.runAfter(0, internal.revert.revertVenueFeedback, { venueId, optOutId, cursor: null });
    return optOutId;
  },
});

export const revertVenueFeedback = internalMutation({
  args: { venueId: v.id('museums'), optOutId: v.id('optOuts'), cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { venueId, optOutId, cursor }) => {
    const page = await ctx.db.query('feedback').withIndex('by_venueId', (q) => q.eq('venueId', venueId)).paginate(paging(cursor));
    let deleted = 0;
    for (const row of page.page) {
      deleted += await resetMultiView(ctx, row);
      await ctx.db.patch(row._id, { multiViewAt: Date.now() });
    }
    await bumpCounter(ctx, 'vectors', -deleted);
    if (page.isDone) await ctx.scheduler.runAfter(0, internal.revert.revertVenueObjects, { venueId, optOutId, cursor: null });
    else await ctx.scheduler.runAfter(0, internal.revert.revertVenueFeedback, { venueId, optOutId, cursor: page.continueCursor });
    return null;
  },
});

export const revertVenueObjects = internalMutation({
  args: { venueId: v.id('museums'), optOutId: v.id('optOuts'), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { venueId, optOutId, cursor }) => {
    const page = await ctx.db.query('placements').withIndex('by_venueId', (q) => q.eq('venueId', venueId)).paginate(paging(cursor));
    const objectIds: Id<'objects'>[] = [];
    const proposalIds: Id<'placementProposals'>[] = [];
    for (const placement of page.page) {
      const object = await ctx.db.get(placement.objectId);
      if (object?.source === 'user') objectIds.push(object._id);
      if (placement.proposalId) proposalIds.push(placement.proposalId);
    }
    await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
      objectIds: [...new Set(objectIds)], proposalIds: [...new Set(proposalIds)],
      target: { kind: 'venue', venueId, optOutId }, cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

export const applyTakedown = internalMutation({
  args: { artworkId: v.optional(v.id('artworks')), objectId: v.optional(v.id('objects')), requester: v.string() },
  returns: v.id('takedowns'),
  handler: async (ctx, { artworkId, objectId, requester }) => {
    if ((artworkId === undefined) === (objectId === undefined)) throw new ConvexError({ code: 'takedown_target' });
    const now = Date.now();
    if (objectId !== undefined) {
      const object = await ctx.db.get(objectId);
      if (!object) throw new ConvexError({ code: 'object_not_found' });
      const takedownId = await ctx.db.insert('takedowns', { objectId, requester, receivedAt: now });
      await beginRevert(ctx, object, `takedown: ${takedownId}`);
      await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
        objectIds: [object._id], proposalIds: [], target: { kind: 'object', takedownId }, cursor: null,
      });
      return takedownId;
    }
    const artwork = await ctx.db.get(artworkId!);
    if (!artwork) throw new ConvexError({ code: 'artwork_not_found' });
    const takedownId = await ctx.db.insert('takedowns', { artworkId: artwork._id, requester, receivedAt: now });
    await clearDocent(ctx, artwork);
    // The hold keeps enrichment from regenerating the sheet; review.replaceFactSheet lifts it deliberately.
    await ctx.db.patch(artwork._id, { factSheet: undefined, factSheetUpdatedAt: undefined, factSheetNeedsReview: true });
    await ctx.scheduler.runAfter(0, internal.revert.revertArtworkObjects, { artworkId: artwork._id, takedownId, cursor: null });
    return takedownId;
  },
});

export const revertArtworkObjects = internalMutation({
  args: { artworkId: v.id('artworks'), takedownId: v.id('takedowns'), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { artworkId, takedownId, cursor }) => {
    const page = await ctx.db.query('objects').withIndex('by_artworkId', (q) => q.eq('artworkId', artworkId)).paginate(paging(cursor));
    await ctx.scheduler.runAfter(0, internal.revert.revertRightsObjects, {
      objectIds: page.page.map((object) => object._id), proposalIds: [],
      target: { kind: 'artwork', artworkId, takedownId }, cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

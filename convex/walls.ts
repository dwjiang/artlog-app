import { ownedAlbumPhoto, selectedPhotoMedia } from './lib/albumMedia';
import { ConvexError, type Infer, v } from 'convex/values';
import { isRevision, LIMITS } from '../shared/journal/limits';
import { validateWallItems, wallArtwork, wallLayout } from '../shared/social/contracts';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { mutation, query, type QueryCtx } from './_generated/server';
import { activeProfile, requireClaimComplete, requireOwnedSave, requireProfile } from './lib/ownership';
import { requirePublicWallItem } from './lib/publicationAccess';
import { projectWallArtwork } from './lib/projections';
import { contributionSource, resolveDisplayAsset } from './lib/displayMedia';

export const DEFAULT_WALL_COLOR = '#45524B';
const selection = v.object({ placementId: v.string(), photoLocalId: v.optional(v.string()), saveLocalId: v.string(), layout: wallLayout });
const ownerItem = v.object({ ...wallArtwork.fields, placementId: v.string(), photoLocalId: v.optional(v.string()), saveLocalId: v.string(), noteVisible: v.boolean(),
  noteRevision: v.number(), noteEligible: v.boolean(), privateNote: v.optional(v.string()) });
const ownerWall = v.object({ scope: v.string(), profileId: v.id('profiles'), revision: v.number(), color: v.string(), items: v.array(ownerItem) });

async function wallOwner(ctx: QueryCtx, scope?: string) {
  const result = await requireProfile(ctx);
  if (scope !== undefined && result.scope !== scope) throw new ConvexError({ code: 'sync_scope_changed' });
  await requireClaimComplete(ctx, result.device._id);
  return result;
}
async function activeItems(ctx: QueryCtx, wall: Doc<'walls'> | null) {
  return wall ? ctx.db.query('wallItems').withIndex('by_wall_active', (q) => q.eq('wallId', wall._id).eq('active', true)).take(LIMITS.wallItems) : [];
}
async function currentProjection(ctx: QueryCtx, item: Doc<'wallItems'>) {
  try {
    const current = await requirePublicWallItem(ctx, item._id);
    const projection = projectWallArtwork(current.item, current.save, await resolveDisplayAsset(ctx, current.save));
    if (item.photoLocalId) projection.artwork.media = await selectedPhotoMedia(ctx, current.save, item.photoLocalId, { kind: 'wallItem', itemId: item._id });
    return { ...current, projection };
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === 'not_found') return null;
    throw error;
  }
}
async function readMine(ctx: QueryCtx): Promise<Infer<typeof ownerWall>> {
  const { profile, scope } = await wallOwner(ctx);
  const wall = await ctx.db.query('walls').withIndex('by_profileId', (q) => q.eq('profileId', profile._id)).unique();
  const items = [];
  for (const item of await activeItems(ctx, wall)) {
    const current = await currentProjection(ctx, item);
    if (current) items.push({ ...current.projection, placementId: item.placementId, ...(item.photoLocalId ? { photoLocalId: item.photoLocalId } : {}), saveLocalId: item.saveLocalId, noteVisible: item.noteVisible,
      noteRevision: item.noteRevision, noteEligible: !!current.save.note?.trim(), ...(current.save.note ? { privateNote: current.save.note } : {}) });
  }
  return { scope, profileId: profile._id, revision: wall?.layoutRevision ?? 0, color: wall?.color ?? DEFAULT_WALL_COLOR,
    items: items.sort((a, b) => a.layout.layer - b.layout.layer) };
}
export const getMine = query({ args: {}, returns: ownerWall, handler: readMine });
export const getPublic = query({
  args: { profileId: v.id('profiles') },
  returns: v.union(v.object({ profileId: v.id('profiles'), color: v.string(), items: v.array(wallArtwork) }), v.null()),
  handler: async (ctx, { profileId }) => {
    if (!await activeProfile(ctx, profileId)) return null;
    const wall = await ctx.db.query('walls').withIndex('by_profileId', (q) => q.eq('profileId', profileId)).unique();
    const items = [];
    for (const item of await activeItems(ctx, wall)) {
      const current = await currentProjection(ctx, item);
      if (current) items.push(current.projection);
    }
    return { profileId, color: wall?.color ?? DEFAULT_WALL_COLOR, items: items.sort((a, b) => a.layout.layer - b.layout.layer) };
  },
});
export const getArtwork = query({
  args: { itemId: v.id('wallItems') }, returns: v.union(wallArtwork, v.null()),
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    return item ? (await currentProjection(ctx, item))?.projection ?? null : null;
  },
});
const sameLayout = (a: Infer<typeof wallLayout>, b: Infer<typeof wallLayout>) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.layer === b.layer && a.frame === b.frame;

export const setLayout = mutation({
  args: { scope: v.string(), revision: v.number(), color: v.string(), items: v.array(selection) }, returns: ownerWall,
  handler: async (ctx, input) => {
    const { profile, owner } = await wallOwner(ctx, input.scope);
    validateWallItems(input.items, input.revision);
    if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new ConvexError({ code: 'invalid_wall' });
    const color = input.color.toUpperCase();
    const selected = await Promise.all(input.items.map(async (item) => {
      const save = await requireOwnedSave(ctx, owner, item.saveLocalId);
      if (item.photoLocalId) await ownedAlbumPhoto(ctx, save, item.photoLocalId);
      return { ...item, save };
    }));
    const wall = await ctx.db.query('walls').withIndex('by_profileId', (q) => q.eq('profileId', profile._id)).unique();
    const previous = await activeItems(ctx, wall);
    const unchanged = color === (wall?.color ?? DEFAULT_WALL_COLOR) && previous.length === selected.length &&
      selected.every((item) => previous.some((old) => old.placementId === item.placementId && old.saveId === item.save._id && old.photoLocalId === item.photoLocalId && sameLayout(old.layout, item.layout)));
    if (!unchanged && input.revision !== (wall?.layoutRevision ?? 0)) throw new ConvexError({ code: 'conflict' });
    const wallId = wall?._id ?? await ctx.db.insert('walls', { profileId: profile._id, color, layoutRevision: 0 });
    if (unchanged) return readMine(ctx);
    const selectedIds = new Set(selected.map((item) => item.placementId));
    for (const item of previous) if (!selectedIds.has(item.placementId)) {
      await ctx.db.patch(item._id, { active: false, noteVisible: false, noteRevision: item.noteRevision + 1 });
    }
    for (const item of selected) {
      const existing = await ctx.db.query('wallItems').withIndex('by_wall_placement', (q) => q.eq('wallId', wallId).eq('placementId', item.placementId)).unique();
      if (existing && existing.saveId !== item.save._id) throw new ConvexError({ code: 'invalid_wall' });
      if (existing) await ctx.db.patch(existing._id, { photoLocalId: item.photoLocalId, layout: item.layout, active: true, noteVisible: existing.active && existing.noteVisible });
      else await ctx.db.insert('wallItems', { wallId, profileId: profile._id, saveId: item.save._id, saveLocalId: item.saveLocalId,
        placementId: item.placementId, photoLocalId: item.photoLocalId, layout: item.layout, active: true, noteVisible: false, noteRevision: 0 });
      if (!await resolveDisplayAsset(ctx, item.save) && await contributionSource(ctx, item.save)) {
        await ctx.scheduler.runAfter(0, internal.displayMediaPrepare.prepare, { saveId: item.save._id });
      }
    }
    await ctx.db.patch(wallId, { color, layoutRevision: (wall?.layoutRevision ?? 0) + 1 });
    await ctx.db.patch(profile._id, { publishedWallCount: selected.length });
    return readMine(ctx);
  },
});
export const setNoteVisibility = mutation({
  args: { scope: v.string(), changes: v.array(v.object({ itemId: v.id('wallItems'), noteRevision: v.number(), visible: v.boolean() })) },
  returns: ownerWall,
  handler: async (ctx, { scope, changes }) => {
    const { profile } = await wallOwner(ctx, scope);
    if (changes.length > LIMITS.wallItems || new Set(changes.map((c) => c.itemId)).size !== changes.length ||
      changes.some((c) => !isRevision(c.noteRevision))) throw new ConvexError({ code: 'invalid_wall' });
    for (const change of changes) {
      const { item, save } = await requirePublicWallItem(ctx, change.itemId);
      if (item.profileId !== profile._id) throw new ConvexError({ code: 'not_found' });
      if (item.noteRevision !== change.noteRevision) throw new ConvexError({ code: 'conflict' });
      if (change.visible && !save.note?.trim()) throw new ConvexError({ code: 'invalid_wall' });
      if (item.noteVisible !== change.visible) await ctx.db.patch(item._id, { noteVisible: change.visible, noteRevision: item.noteRevision + 1 });
    }
    return readMine(ctx);
  },
});

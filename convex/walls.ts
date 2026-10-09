import { ConvexError, type Infer, v } from "convex/values";

import { LIMITS } from "../shared/journal/limits";
import { artworkDetail, displayMedia, wallArtwork, wallPattern } from "../shared/social/contracts";
import { DEFAULT_WALL_COLOR } from "../shared/wall/defaults";
import { query, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { selectedPhotoMedia } from "./lib/albumMedia";
import { blockedEitherWay } from "./lib/friendships";
import { activeProfile, optionalProfile, requireClaimComplete, requireProfile } from "./lib/ownership";
import { projectArtworkDetail } from "./lib/projections";
import { projectArtworkStory, publicArtworkStory } from "./lib/publicArtworkStory";
import { requirePublicWallItem, requireSharedVisitItem } from "./lib/publicationAccess";
import { activeWallItems, publicWallProjection } from "./lib/publicWall";
import { setWallLayout, wallEdit } from "./lib/wallLayouts";

const ownerItem = v.object({
  ...wallArtwork.fields,
  placementId: v.string(),
  photoLocalId: v.optional(v.string()),
  saveLocalId: v.string(),
});
const ownerWall = v.object({
  scope: v.string(),
  profileId: v.id("profiles"),
  revision: v.number(),
  color: v.string(),
  pattern: v.optional(wallPattern),
  items: v.array(ownerItem),
});

async function wallOwner(ctx: QueryCtx, scope?: string) {
  const result = await requireProfile(ctx);
  if (scope !== undefined && result.scope !== scope) {
    throw new ConvexError({ code: "sync_scope_changed" });
  }
  await requireClaimComplete(ctx, result.device._id);
  return result;
}
async function readMine(ctx: QueryCtx): Promise<Infer<typeof ownerWall>> {
  const { profile, scope } = await wallOwner(ctx);
  const wall = await ctx.db
    .query("walls")
    .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
    .unique();
  const items = [];
  for (const item of await activeWallItems(ctx, wall)) {
    const current = await publicWallProjection(ctx, item);
    if (current) {
      items.push({
        ...current.projection,
        placementId: item.placementId,
        ...(item.photoLocalId ? { photoLocalId: item.photoLocalId } : {}),
        saveLocalId: item.saveLocalId,
      });
    }
  }
  return {
    scope,
    profileId: profile._id,
    revision: wall?.layoutRevision ?? 0,
    color: wall?.color ?? DEFAULT_WALL_COLOR,
    ...(wall?.pattern ? { pattern: wall.pattern } : {}),
    items: items.sort((a, b) => a.layout.layer - b.layout.layer),
  };
}
export const getMine = query({
  args: {},
  returns: ownerWall,
  handler: readMine,
});
export const getPublic = query({
  args: { profileId: v.id("profiles") },
  // artworkCount is computed here because public items carry no save identity; a save may hang more than once.
  returns: v.union(
    v.object({
      profileId: v.id("profiles"),
      color: v.string(),
      pattern: v.optional(wallPattern),
      artworkCount: v.number(),
      items: v.array(wallArtwork),
    }),
    v.null(),
  ),
  handler: async (ctx, { profileId }) => {
    if (!(await activeProfile(ctx, profileId))) return null;
    const viewer = await optionalProfile(ctx);
    if (viewer && (await blockedEitherWay(ctx, viewer._id, profileId))) return null;
    const wall = await ctx.db
      .query("walls")
      .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
      .unique();
    const items = [];
    const saves = new Set<string>();
    for (const item of await activeWallItems(ctx, wall)) {
      const current = await publicWallProjection(ctx, item);
      if (current) {
        items.push(current.projection);
        saves.add(current.save._id);
      }
    }
    return {
      profileId,
      color: wall?.color ?? DEFAULT_WALL_COLOR,
      ...(wall?.pattern ? { pattern: wall.pattern } : {}),
      artworkCount: saves.size,
      items: items.sort((a, b) => a.layout.layer - b.layout.layer),
    };
  },
});
export const getArtwork = query({
  args: { itemId: v.id("wallItems") },
  returns: v.union(
    v.object({
      ...wallArtwork.fields,
      artwork: artworkDetail,
      profileId: v.id("profiles"),
      photos: v.array(displayMedia),
      enrichment: v.optional(publicArtworkStory),
    }),
    v.null(),
  ),
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get("wallItems", itemId);
    const current = item ? await publicWallProjection(ctx, item) : null;
    if (!current) return null;
    const viewer = await optionalProfile(ctx);
    if (viewer && (await blockedEitherWay(ctx, viewer._id, current.profile._id))) return null;
    const photos = new Map<string, Infer<typeof displayMedia>>();
    const placements = await ctx.db
      .query("wallItems")
      .withIndex("by_save_active", (q) => q.eq("saveId", current.save._id).eq("active", true))
      .take(LIMITS.wallItems);
    // Keep the tapped full photo first; each additional photo retains its own live access boundary.
    for (const placement of [current.item, ...placements.filter((row) => row._id !== itemId)]) {
      if (!placement.photoLocalId || photos.has(placement.photoLocalId)) continue;
      try {
        await requirePublicWallItem(ctx, placement._id);
        photos.set(
          placement.photoLocalId,
          await selectedPhotoMedia(ctx, current.save, placement.photoLocalId, {
            kind: "wallItem",
            itemId: placement._id,
          }),
        );
      } catch (error) {
        if (!(error instanceof ConvexError && error.data.code === "not_found")) throw error;
      }
    }
    const selections = await ctx.db
      .query("sharedVisitItems")
      .withIndex("by_saveId", (q) => q.eq("saveId", current.save._id))
      .take(101);
    for (const selection of selections) {
      const publication = await ctx.db.get("sharedVisits", selection.publicationId);
      if (!publication) continue;
      try {
        await requireSharedVisitItem(ctx, publication.postId, selection._id, viewer?._id);
        for (const localId of selection.photoLocalIds ?? []) {
          if (!photos.has(localId)) {
            photos.set(
              localId,
              await selectedPhotoMedia(ctx, current.save, localId, {
                kind: "sharedVisit",
                postId: publication.postId,
                itemId: selection._id,
              }),
            );
          }
        }
      } catch (error) {
        if (!(error instanceof ConvexError && error.data.code === "not_found")) throw error;
      }
    }
    const enrichment = await projectArtworkStory(ctx, current.save);
    return {
      ...current.projection,
      artwork: projectArtworkDetail(current.projection.artwork, current.save),
      profileId: current.profile._id,
      photos: photos.size > 0 ? [...photos.values()] : [current.projection.artwork.media],
      ...(enrichment ? { enrichment } : {}),
    };
  },
});
export const setLayout = mutation({
  args: { scope: v.string(), ...wallEdit.fields },
  returns: ownerWall,
  handler: async (ctx, input) => {
    const identity = await wallOwner(ctx, input.scope);
    await setWallLayout(ctx, identity, input);
    return readMine(ctx);
  },
});

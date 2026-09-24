import { ConvexError, v } from "convex/values";

import { LIMITS } from "../shared/journal/limits";
import { query } from "./_generated/server";
import { findOwnedSave, requireJournalOwner, requireMembership } from "./lib/ownership";
import { readablePublication, requirePublicWallItem } from "./lib/publicationAccess";

export const forArtwork = query({
  args: { scope: v.string(), savedLocalId: v.string() },
  returns: v.array(
    v.object({
      photoLocalId: v.string(),
      wallPlacements: v.number(),
      sharedVisits: v.number(),
    }),
  ),
  handler: async (ctx, { scope, savedLocalId }) => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const save = await findOwnedSave(ctx, owner, savedLocalId);
    if (!save || save.deletedAt !== undefined) return [];
    const photos = await ctx.db
      .query("artworkPhotos")
      .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
      .take(101);
    const counts = new Map(
      photos.map((photo) => [photo.localId, { photoLocalId: photo.localId, wallPlacements: 0, sharedVisits: 0 }]),
    );
    const placements = await ctx.db
      .query("wallItems")
      .withIndex("by_save_active", (q) => q.eq("saveId", save._id).eq("active", true))
      .take(LIMITS.wallItems + 1);
    for (const item of placements) {
      const count = item.photoLocalId && counts.get(item.photoLocalId);
      if (!count) continue;
      try {
        await requirePublicWallItem(ctx, item._id);
        count.wallPlacements++;
      } catch (error) {
        if (!(error instanceof ConvexError) || error.data.code !== "not_found") {
          throw error;
        }
      }
    }
    const selections = await ctx.db
      .query("sharedVisitItems")
      .withIndex("by_saveId", (q) => q.eq("saveId", save._id))
      .take(101);
    for (const item of selections) {
      if (item.saveLocalId !== save.localId) continue;
      const publication = await ctx.db.get("sharedVisits", item.publicationId);
      const access = publication && (await readablePublication(ctx, publication, publication.profileId));
      if (!access) continue;
      try {
        await requireMembership(ctx, save, access.visit);
      } catch (error) {
        if (!(error instanceof ConvexError) || error.data.code !== "not_found") {
          throw error;
        }
        continue;
      }
      for (const photoLocalId of new Set(item.photoLocalIds ?? [])) {
        const count = counts.get(photoLocalId);
        if (count) count.sharedVisits++;
      }
    }
    return [...counts.values()];
  },
});

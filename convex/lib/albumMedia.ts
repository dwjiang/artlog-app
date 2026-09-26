import { ConvexError, type Infer } from "convex/values";

import type { displayMediaContext, displayMedia } from "../../shared/social/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { advancePublicationRevision } from "./publicationUpdates";
import { deactivateWallItem } from "./wallItems";

export async function ownedAlbumPhoto(ctx: QueryCtx, save: Doc<"collections">, localId: string) {
  const photo = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_owner_localId", (q) => q.eq("owner", save.owner).eq("localId", localId))
    .unique();
  if (!photo || photo.saveId !== save._id || photo.deletedAt !== undefined || save.deletedAt !== undefined) {
    throw new ConvexError({ code: "not_found" });
  }
  return photo;
}
export async function selectedPhotoMedia(
  ctx: QueryCtx,
  save: Doc<"collections">,
  localId: string,
  context: Infer<typeof displayMediaContext>,
): Promise<Infer<typeof displayMedia>> {
  const photo = await ownedAlbumPhoto(ctx, save, localId);
  return {
    kind: "photo",
    width: photo.width ?? 1,
    height: photo.height ?? 1,
    reference: { ...context, photoLocalId: localId },
  };
}

export async function invalidateAlbumPhoto(ctx: MutationCtx, photo: Doc<"artworkPhotos">) {
  const items = await ctx.db
    .query("wallItems")
    .withIndex("by_save_active", (q) => q.eq("saveId", photo.saveId).eq("active", true))
    .take(101);
  for (const item of items) {
    if (item.active && item.photoLocalId === photo.localId) {
      await deactivateWallItem(ctx, item);
    }
  }
  const selections = await ctx.db
    .query("sharedVisitItems")
    .withIndex("by_saveId", (q) => q.eq("saveId", photo.saveId))
    .take(101);
  for (const item of selections) {
    if (item.photoLocalIds?.includes(photo.localId)) {
      const remaining = item.photoLocalIds.filter((id) => id !== photo.localId);
      if (remaining.length > 0) {
        await ctx.db.patch("sharedVisitItems", item._id, { photoLocalIds: remaining });
      } else {
        await ctx.db.delete("sharedVisitItems", item._id);
      }
      const post = await ctx.db.get("sharedVisits", item.publicationId);
      if (post) await advancePublicationRevision(ctx, post);
    }
  }
}

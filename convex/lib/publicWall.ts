import { ConvexError } from "convex/values";

import { LIMITS } from "../../shared/journal/limits";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { selectedPhotoMedia } from "./albumMedia";
import { resolveDisplayAsset } from "./displayMedia";
import { projectWallArtwork } from "./projections";
import { requirePublicWallItem } from "./publicationAccess";

export async function activeWallItems(ctx: QueryCtx, wall: Doc<"walls"> | null) {
  return wall
    ? ctx.db
        .query("wallItems")
        .withIndex("by_wall_active", (q) => q.eq("wallId", wall._id).eq("active", true))
        .take(LIMITS.wallItems)
    : [];
}
/** The item as its public wall shows it, or null once it is no longer public. */
export async function publicWallProjection(ctx: QueryCtx, item: Doc<"wallItems">) {
  try {
    const current = await requirePublicWallItem(ctx, item._id);
    const projection = projectWallArtwork(current.item, current.save, await resolveDisplayAsset(ctx, current.save));
    if (item.photoLocalId) {
      projection.artwork.media = await selectedPhotoMedia(ctx, current.save, item.photoLocalId, {
        kind: "wallItem",
        itemId: item._id,
      });
      const { save } = current;
      if (
        save.cropPhotoLocalId === item.photoLocalId
        && save.cropStorageId
        && save.cropWidth
        && save.cropHeight
        && save.photoUpdatedAt
      ) {
        projection.artwork.media = {
          kind: "photo",
          width: save.cropWidth,
          height: save.cropHeight,
          reference: {
            kind: "wallItem",
            itemId: item._id,
            photoLocalId: item.photoLocalId,
            variant: "crop",
            cropRevision: save.photoUpdatedAt,
          },
        };
      }
    }
    return { ...current, projection };
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "not_found") {
      return null;
    }
    throw error;
  }
}

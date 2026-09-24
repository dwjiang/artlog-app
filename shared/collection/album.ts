import { ConvexError, type Infer, v } from "convex/values";

import { isTimestamp, isUuid, LIMITS } from "../journal/limits";

export const photoKind = v.union(v.literal("full"), v.literal("detail"), v.literal("label"));
export const albumPhoto = v.object({
  localId: v.string(),
  savedLocalId: v.string(),
  kind: photoKind,
  capturedAt: v.number(),
  visitLocalId: v.optional(v.string()),
  caption: v.optional(v.string()),
  deletedAt: v.optional(v.number()),
});
export const albumEncounter = v.object({
  savedLocalId: v.string(),
  visitLocalId: v.string(),
  note: v.optional(v.string()),
  deletedAt: v.optional(v.number()),
});
export type PhotoKind = Infer<typeof photoKind>;
export type AlbumPhoto = Infer<typeof albumPhoto>;
export type AlbumEncounter = Infer<typeof albumEncounter>;

export function validateAlbumPhoto(photo: AlbumPhoto) {
  if (
    !isUuid(photo.localId)
    || !isUuid(photo.savedLocalId)
    || !isTimestamp(photo.capturedAt)
    || (photo.visitLocalId !== undefined && !isUuid(photo.visitLocalId))
    || (photo.caption?.length ?? 0) > LIMITS.note
    || (photo.deletedAt !== undefined && !isTimestamp(photo.deletedAt))
  ) {
    throw new ConvexError({ code: "invalid_photo" });
  }
}
export function validateAlbumEncounter(encounter: AlbumEncounter) {
  if (
    !isUuid(encounter.savedLocalId)
    || !isUuid(encounter.visitLocalId)
    || (encounter.note?.length ?? 0) > LIMITS.note
    || (encounter.deletedAt !== undefined && !isTimestamp(encounter.deletedAt))
  ) {
    throw new ConvexError({ code: "invalid_encounter" });
  }
}

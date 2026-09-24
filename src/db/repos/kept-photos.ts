import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkPhotos, savedWorks } from "@/db/schema";

/** Storage maintenance covers all journals on this installation, including saves interrupted before resizing. */
export function listKeptPhotos() {
  const photos = new Map<string, { path: string; kind: "full" | "detail" | "label" }>();
  for (const { path } of db
    .select({ path: savedWorks.photoPath })
    .from(savedWorks)
    .where(and(isNull(savedWorks.deletedAt), isNotNull(savedWorks.photoPath)))
    .all()) {
    if (path) photos.set(path, { path, kind: "full" });
  }
  for (const photo of db
    .select({ path: artworkPhotos.path, kind: artworkPhotos.kind })
    .from(artworkPhotos)
    .innerJoin(
      savedWorks,
      and(eq(savedWorks.owner, artworkPhotos.owner), eq(savedWorks.localId, artworkPhotos.savedLocalId)),
    )
    .where(and(isNull(artworkPhotos.deletedAt), isNull(savedWorks.deletedAt), isNotNull(artworkPhotos.path)))
    .all()) {
    if (photo.path) photos.set(photo.path, { path: photo.path, kind: photo.kind });
  }
  return [...photos.values()];
}

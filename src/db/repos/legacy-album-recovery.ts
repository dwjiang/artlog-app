import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkPhotos, pendingScans, savedWorks, settings, type ArtworkPhoto } from "@/db/schema";

type RecoveredPhoto = Pick<
  ArtworkPhoto,
  "localId" | "capturedAt" | "visitLocalId" | "path" | "storageId" | "deletedAt"
>;

function recoveryFilter(owner: string, saveLocalIds?: string[]) {
  const prefix = `albumRecovery:${owner}:`;
  return saveLocalIds
    ? inArray(
        settings.key,
        saveLocalIds.map((localId) => `${prefix}${localId}`),
      )
    : sql`substr(${settings.key}, 1, ${prefix.length}) = ${prefix}`;
}

export function hasLegacyAlbumRecovery(owner: string, saveLocalIds?: string[]): boolean {
  return !!db.select().from(settings).where(recoveryFilter(owner, saveLocalIds)).limit(1).get();
}

// Call only after pulling all album pages: a synced save can arrive before its original photo or tombstone.
export function recoverLegacyAlbumPhotos(owner: string): void {
  db.transaction((tx) => {
    const deferred = tx.select().from(settings).where(recoveryFilter(owner)).all();
    for (const entry of deferred) {
      const photo = JSON.parse(entry.value) as RecoveredPhoto;
      const work = tx
        .select()
        .from(savedWorks)
        .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, photo.localId)))
        .get();
      if (work) {
        const existing = tx
          .select()
          .from(artworkPhotos)
          .where(
            and(
              eq(artworkPhotos.owner, owner),
              or(
                eq(artworkPhotos.localId, photo.localId),
                work.cropPhotoLocalId ? eq(artworkPhotos.localId, work.cropPhotoLocalId) : undefined,
                and(eq(artworkPhotos.savedLocalId, work.localId), eq(artworkPhotos.capturedAt, photo.capturedAt)),
                photo.path ? eq(artworkPhotos.path, photo.path) : undefined,
                photo.storageId ? eq(artworkPhotos.storageId, photo.storageId) : undefined,
              ),
            ),
          )
          .get();
        if (!existing) {
          tx.insert(artworkPhotos)
            .values({
              ...photo,
              owner,
              savedLocalId: work.localId,
              kind: "full",
              deletedAt: work.deletedAt ?? photo.deletedAt,
            })
            .run();
        } else {
          tx.update(pendingScans)
            .set({ savedPhotoLocalId: existing.localId })
            .where(and(eq(pendingScans.owner, owner), eq(pendingScans.savedPhotoLocalId, photo.localId)))
            .run();
          if (!existing.storageId && !existing.recoveryStorageId && photo.storageId && existing.deletedAt === null) {
            tx.update(artworkPhotos)
              .set({ recoveryStorageId: photo.storageId })
              .where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, existing.localId)))
              .run();
          }
        }
      }
      tx.delete(settings).where(eq(settings.key, entry.key)).run();
    }
  });
}

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../client";
import { artworkPhotos, pendingScans, savedWorks, settings } from "../schema";

export const recognitionSyncKey = (owner: string, localId: string) => `recognitionSync:${owner}:${localId}`;

export function pendingSavedRecognition(owner: string, localId?: string) {
  return db
    .select({ localId: savedWorks.localId, sourceLocalId: pendingScans.localId })
    .from(savedWorks)
    .innerJoin(
      artworkPhotos,
      and(eq(artworkPhotos.owner, savedWorks.owner), eq(artworkPhotos.savedLocalId, savedWorks.localId)),
    )
    .innerJoin(
      pendingScans,
      and(
        eq(pendingScans.owner, artworkPhotos.owner),
        or(eq(pendingScans.localId, artworkPhotos.localId), eq(pendingScans.photoPath, artworkPhotos.path)),
      ),
    )
    .leftJoin(
      settings,
      eq(settings.key, sql`'recognitionSync:' || ${savedWorks.owner} || ':' || ${savedWorks.localId}`),
    )
    .where(
      and(
        eq(savedWorks.owner, owner),
        localId ? eq(savedWorks.localId, localId) : undefined,
        isNull(savedWorks.deletedAt),
        isNull(artworkPhotos.deletedAt),
        ne(artworkPhotos.kind, "label"),
        isNull(settings.key),
      ),
    )
    .groupBy(savedWorks.owner, savedWorks.localId)
    .orderBy(savedWorks.savedAt, savedWorks.localId)
    .limit(20)
    .all();
}

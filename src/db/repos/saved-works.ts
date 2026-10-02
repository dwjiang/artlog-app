import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  artworkPhotos,
  artworkEncounters,
  notes,
  pendingScans,
  savedWorks,
  type NewSavedWork,
  type SavedWork,
} from "@/db/schema";
import { getLocalOwner } from "@/lib/account/owner-store";
import { requestCollectionSync } from "@/lib/account/sync-events";

import type { Doc } from "../../../convex/_generated/dataModel";
import { saveArtworkSession, selectArtworkPhotos } from "./artwork-album";
import { requireVisitMembership } from "./visit-membership";

/** A save with its capture as the first album photo; the scan flow builds the same session in saveResult. */
export async function insertSavedWork(work: NewSavedWork, owner = getLocalOwner()): Promise<void> {
  requireVisitMembership(owner, work);
  const path = work.photoPath ?? work.cropPath;
  const visitLocalId = work.visitLocalId ?? undefined;
  saveArtworkSession(
    work.localId,
    work,
    path
      ? [
          {
            localId: work.localId,
            savedLocalId: work.localId,
            kind: "full",
            capturedAt: work.savedAt,
            visitLocalId,
            path,
          },
        ]
      : [],
    visitLocalId,
    owner,
  );
}

/** The row as a query for `useLiveQuery`; `getSavedWork` reads it once. */
export function selectSavedWork(localId: string, owner = getLocalOwner()) {
  return db
    .select()
    .from(savedWorks)
    .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId)));
}

export async function getSavedWork(localId: string, owner = getLocalOwner()): Promise<SavedWork | undefined> {
  return selectSavedWork(localId, owner).get();
}

export function listSavedWorks(owner = getLocalOwner(), includeDeleted = false) {
  return db
    .select()
    .from(savedWorks)
    .where(and(eq(savedWorks.owner, owner), includeDeleted ? undefined : isNull(savedWorks.deletedAt)))
    .orderBy(desc(savedWorks.savedAt), desc(savedWorks.localId));
}

/** Catalogue artworks the owner has kept, so suggestions can leave them out. */
export function listSavedArtworkIds(owner = getLocalOwner()) {
  return db
    .selectDistinct({ artworkId: savedWorks.artworkId })
    .from(savedWorks)
    .where(and(eq(savedWorks.owner, owner), isNull(savedWorks.deletedAt), isNotNull(savedWorks.artworkId)));
}

export async function softDeleteSavedWork(
  localId: string,
  deletedAt = Date.now(),
  owner = getLocalOwner(),
): Promise<void> {
  await db
    .update(savedWorks)
    .set({
      deletedAt,
      syncedAt: null,
      revision: sql`${savedWorks.revision} + 1`,
    })
    .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId)));
  db.update(artworkPhotos)
    .set({ deletedAt, syncedAt: null })
    .where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.savedLocalId, localId)))
    .run();
  db.update(artworkEncounters)
    .set({ deletedAt, syncedAt: null })
    .where(and(eq(artworkEncounters.owner, owner), eq(artworkEncounters.savedLocalId, localId)))
    .run();
  requestCollectionSync();
}

export type SyncAcknowledgement = Pick<Doc<"collections">, "localId" | "updatedAt" | "updatedBy" | "deletedAt"> & {
  revision: number;
};

function isNewer(row: Pick<Doc<"collections">, "updatedAt" | "updatedBy">, existing: SavedWork): boolean {
  return (
    existing.syncedAt === null
    || row.updatedAt > existing.syncedAt
    || (row.updatedAt === existing.syncedAt && row.updatedBy > (existing.syncedBy ?? ""))
  );
}

export async function markSynced(rows: SyncAcknowledgement[], owner = getLocalOwner()): Promise<void> {
  db.transaction((tx) => {
    for (const row of rows) {
      const existing = tx
        .select()
        .from(savedWorks)
        .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
        .get();
      if (!existing) continue;
      if (row.deletedAt !== undefined && existing.deletedAt === null) {
        tx.update(savedWorks)
          .set({ deletedAt: row.deletedAt })
          .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
          .run();
      }
      if (existing.revision === row.revision && isNewer(row, existing)) {
        tx.update(savedWorks)
          .set({ syncedAt: row.updatedAt, syncedBy: row.updatedBy })
          .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
          .run();
      }
    }
  });
}

export async function listUnsynced(owner = getLocalOwner()) {
  return db
    .select({ work: savedWorks, note: notes.text })
    .from(savedWorks)
    .leftJoin(notes, and(eq(notes.owner, savedWorks.owner), eq(notes.savedLocalId, savedWorks.localId)))
    .where(and(eq(savedWorks.owner, owner), isNull(savedWorks.syncedAt)))
    .orderBy(savedWorks.savedAt, savedWorks.localId)
    .limit(50);
}

/** Returns the local crop files a newer remote crop displaced; callers remove those no row still references. */
export async function upsertFromRemote(rows: Doc<"collections">[], owner = getLocalOwner()): Promise<string[]> {
  const displaced: string[] = [];
  db.transaction((tx) => {
    for (const row of rows) {
      requireVisitMembership(owner, { ...row, visitId: undefined });
      const existing = tx
        .select()
        .from(savedWorks)
        .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
        .get();
      const newlyDeleted = existing?.deletedAt === null && row.deletedAt !== undefined;
      if (existing) {
        const pendingCrop = !!existing.cropPath && !existing.cropStorageId;
        if (!pendingCrop && row.cropStorageId && (row.photoUpdatedAt ?? 0) >= existing.photoUpdatedAt) {
          const replaced = row.cropStorageId !== existing.cropStorageId;
          if (replaced && existing.cropPath) displaced.push(existing.cropPath);
          tx.update(savedWorks)
            .set({
              cropStorageId: row.cropStorageId,
              cropPhotoLocalId: row.cropPhotoLocalId ?? null,
              photoUpdatedAt: row.photoUpdatedAt ?? 0,
              ...(replaced ? { cropPath: null, cropCorners: null } : {}),
            })
            .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
            .run();
        }
        // Tombstones must survive even when a local edit is pending or a newer note arrived first.
        if (newlyDeleted) {
          tx.update(savedWorks)
            .set({
              deletedAt: row.deletedAt,
              syncedAt: null,
              revision: sql`${savedWorks.revision} + 1`,
            })
            .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
            .run();
        }
        // A save's museum follows its visit on the server, even past an edit still pending here.
        if (existing.venueId !== (row.venueId ?? null) || existing.venueName !== (row.venueName ?? null)) {
          tx.update(savedWorks)
            .set({ venueId: row.venueId ?? null, venueName: row.venueName ?? null })
            .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
            .run();
        }
        if (existing.syncedAt === null || !isNewer(row, existing)) continue;
        // Optional snapshot fields arrive absent when cleared; drizzle skips undefined in SET, so write nulls explicitly.
        tx.update(savedWorks)
          .set({
            ...row.snapshot,
            date: row.snapshot.date ?? null,
            medium: row.snapshot.medium ?? null,
            institution: row.snapshot.institution ?? null,
            objectId: row.objectId ?? null,
            artworkId: row.artworkId ?? null,
            syncedAt: newlyDeleted ? null : row.updatedAt,
            syncedBy: row.updatedBy,
          })
          .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, row.localId)))
          .run();
      } else {
        tx.insert(savedWorks)
          .values({
            owner,
            localId: row.localId,
            visitLocalId: row.visitLocalId,
            ...row.snapshot,
            venueId: row.venueId,
            venueName: row.venueName,
            gallery: row.gallery,
            savedAt: row.savedAt,
            objectId: row.objectId,
            artworkId: row.artworkId,
            photoPath: null,
            cropPath: null,
            syncedAt: row.updatedAt,
            syncedBy: row.updatedBy,
            deletedAt: row.deletedAt,
            cropStorageId: row.cropStorageId,
            cropPhotoLocalId: row.cropPhotoLocalId,
            photoUpdatedAt: row.photoUpdatedAt ?? 0,
          })
          .run();
      }
      tx.insert(notes)
        .values({
          owner,
          savedLocalId: row.localId,
          text: row.note ?? "",
          updatedAt: row.updatedAt,
        })
        .onConflictDoUpdate({
          target: [notes.owner, notes.savedLocalId],
          set: { text: row.note ?? "", updatedAt: row.updatedAt },
        })
        .run();
    }
  });
  return displaced;
}

export function listPhotoTransfers(owner = getLocalOwner()) {
  return db
    .select()
    .from(savedWorks)
    .where(
      and(
        eq(savedWorks.owner, owner),
        isNull(savedWorks.deletedAt),
        or(
          and(isNotNull(savedWorks.cropPath), isNull(savedWorks.cropStorageId)),
          and(isNull(savedWorks.cropPath), isNotNull(savedWorks.cropStorageId)),
        ),
      ),
    )
    .orderBy(savedWorks.localId)
    .limit(20);
}

export async function updatePhotoTransfer(
  localId: string,
  values: Partial<Pick<SavedWork, "cropPath" | "cropStorageId" | "photoUpdatedAt">>,
  owner = getLocalOwner(),
  expected?: Pick<SavedWork, "cropPath" | "cropStorageId">,
): Promise<boolean> {
  const updated = await db
    .update(savedWorks)
    .set(values)
    .where(
      and(
        eq(savedWorks.owner, owner),
        eq(savedWorks.localId, localId),
        isNull(savedWorks.deletedAt),
        expected
          && (expected.cropPath === null ? isNull(savedWorks.cropPath) : eq(savedWorks.cropPath, expected.cropPath)),
        expected
          && (expected.cropStorageId === null
            ? isNull(savedWorks.cropStorageId)
            : eq(savedWorks.cropStorageId, expected.cropStorageId)),
      ),
    )
    .returning({ localId: savedWorks.localId });
  return updated.length > 0;
}

export function replaceSavedCrop(
  localId: string,
  cropPath: string,
  cropCorners: SavedWork["cropCorners"],
  photoPath: SavedWork["photoPath"],
  owner = getLocalOwner(),
) {
  const work = selectSavedWork(localId, owner).get();
  if (!work || work.deletedAt !== null) throw new Error("Artwork unavailable");
  const source = photoPath
    ? selectArtworkPhotos(localId, owner)
        .all()
        .find((photo) => photo.path === photoPath)
    : undefined;
  db.update(savedWorks)
    .set({ cropPath, cropCorners, photoPath, cropPhotoLocalId: source?.localId ?? null, cropStorageId: null })
    .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId)))
    .run();
  requestCollectionSync();
}

export function listDeletedPhotoFiles(owner = getLocalOwner()) {
  return db
    .select({
      localId: savedWorks.localId,
      photoPath: savedWorks.photoPath,
      cropPath: savedWorks.cropPath,
    })
    .from(savedWorks)
    .where(
      and(
        eq(savedWorks.owner, owner),
        isNotNull(savedWorks.deletedAt),
        or(isNotNull(savedWorks.photoPath), isNotNull(savedWorks.cropPath)),
      ),
    )
    .limit(20);
}

export async function isPhotoFileReferenced(path: string): Promise<boolean> {
  const saved = await db
    .select({ localId: savedWorks.localId })
    .from(savedWorks)
    .where(and(isNull(savedWorks.deletedAt), or(eq(savedWorks.photoPath, path), eq(savedWorks.cropPath, path))))
    .limit(1);
  const pending = await db
    .select({ localId: pendingScans.localId })
    .from(pendingScans)
    .where(or(eq(pendingScans.photoPath, path), eq(pendingScans.cropPath, path)))
    .limit(1);
  const album = db
    .select()
    .from(artworkPhotos)
    .where(and(eq(artworkPhotos.path, path), isNull(artworkPhotos.deletedAt)))
    .limit(1)
    .all();
  return saved.length > 0 || pending.length > 0 || album.length > 0;
}

export async function clearDeletedPhotoPaths(localId: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(savedWorks)
    .set({ photoPath: null, cropPath: null })
    .where(and(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId)), isNotNull(savedWorks.deletedAt)));
}

export function editSavedWork(
  localId: string,
  fields: Pick<SavedWork, "title" | "artist" | "date" | "medium">,
  owner = getLocalOwner(),
) {
  const work = selectSavedWork(localId, owner).get();
  if (!work || work.deletedAt !== null) throw new Error("Artwork unavailable");
  db.update(savedWorks)
    .set({
      ...fields,
      syncedAt: null,
      revision: sql`${savedWorks.revision} + 1`,
    })
    .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId)))
    .run();
  requestCollectionSync();
}

import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { AlbumEncounter, AlbumPhoto } from '../../../shared/collection/album';
import { getLocalOwner } from '../../lib/account/owner-store';
import { requestCollectionSync } from '../../lib/account/sync-events';
import { db } from '../client';
import { artworkEncounters, artworkPhotos, savedWorks, visits, type ArtworkPhoto } from '../schema';

function requireWork(localId: string, owner: string) {
  const work = db.select().from(savedWorks).where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, localId), isNull(savedWorks.deletedAt))).get();
  if (!work) throw new Error('Artwork is unavailable');
  return work;
}
function requireVisit(localId: string, owner: string) {
  if (!db.select().from(visits).where(and(eq(visits.owner, owner), eq(visits.localId, localId))).get()) throw new Error('Visit is unavailable');
}
export function selectArtworkPhotos(savedLocalId: string, owner = getLocalOwner()) {
  return db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.savedLocalId, savedLocalId), isNull(artworkPhotos.deletedAt)))
    .orderBy(asc(artworkPhotos.capturedAt), asc(artworkPhotos.localId));
}
/** Photos captured during one visit; a photo saved without a visit or at another visit belongs to neither share. */
export function selectVisitArtworkPhotos(savedLocalId: string, visitLocalId: string, owner = getLocalOwner()) {
  return db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.savedLocalId, savedLocalId),
    eq(artworkPhotos.visitLocalId, visitLocalId), isNull(artworkPhotos.deletedAt))).orderBy(asc(artworkPhotos.capturedAt), asc(artworkPhotos.localId));
}
/** Any album row with this id, tombstoned or live; ids are stable so a capture's row outlives its file path. */
export function findArtworkPhoto(localId: string, owner = getLocalOwner()) {
  return db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, localId))).get();
}
export function selectArtworkEncounters(owner = getLocalOwner()) {
  return db.select().from(artworkEncounters).where(and(eq(artworkEncounters.owner, owner), isNull(artworkEncounters.deletedAt)));
}
export function linkArtworkVisit(savedLocalId: string, visitLocalId: string, owner = getLocalOwner()) {
  requireWork(savedLocalId, owner); requireVisit(visitLocalId, owner);
  const existing = db.select().from(artworkEncounters).where(and(eq(artworkEncounters.owner, owner), eq(artworkEncounters.savedLocalId, savedLocalId), eq(artworkEncounters.visitLocalId, visitLocalId))).get();
  if (existing && existing.deletedAt === null) return;
  db.insert(artworkEncounters).values({ owner, savedLocalId, visitLocalId }).onConflictDoUpdate({
    target: [artworkEncounters.owner, artworkEncounters.savedLocalId, artworkEncounters.visitLocalId],
    set: { deletedAt: null, syncedAt: null, revision: sql`${artworkEncounters.revision} + 1` },
  }).run();
  requestCollectionSync();
}
export function linkArtworksVisit(savedLocalIds: string[], visitLocalId: string, owner = getLocalOwner()) {
  db.transaction(() => {
    for (const id of new Set(savedLocalIds)) linkArtworkVisit(id, visitLocalId, owner);
  });
}
export function linkArtworkVisits(savedLocalId: string, visitLocalIds: string[], owner = getLocalOwner()) {
  db.transaction(() => {
    for (const id of new Set(visitLocalIds)) linkArtworkVisit(savedLocalId, id, owner);
  });
}
export function addArtworkPhoto(input: AlbumPhoto & { path: string }, owner = getLocalOwner()) {
  requireWork(input.savedLocalId, owner);
  if (input.visitLocalId) requireVisit(input.visitLocalId, owner);
  const existing = db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, input.localId))).get();
  if (existing && existing.savedLocalId !== input.savedLocalId) throw new Error('Photo already belongs to another artwork');
  if (!existing && selectArtworkPhotos(input.savedLocalId, owner).all().length >= 100) throw new Error('An artwork can hold 100 photos');
  db.transaction(() => {
    db.insert(artworkPhotos).values({ ...input, owner }).onConflictDoNothing().run();
    if (input.visitLocalId) linkArtworkVisit(input.savedLocalId, input.visitLocalId, owner);
  });
  requestCollectionSync();
}
export function editArtworkPhoto(localId: string, patch: Pick<Partial<ArtworkPhoto>, 'kind' | 'caption' | 'deletedAt' | 'savedLocalId'>, owner = getLocalOwner()) {
  const photo = db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, localId))).get();
  if (!photo || photo.deletedAt !== null) throw new Error('Photo is unavailable');
  requireWork(photo.savedLocalId, owner);
  if (patch.savedLocalId) requireWork(patch.savedLocalId, owner);
  const moving = patch.savedLocalId && patch.savedLocalId !== photo.savedLocalId;
  if (moving && selectArtworkPhotos(patch.savedLocalId!, owner).all().length >= 100) throw new Error('An artwork can hold 100 photos');
  db.transaction(() => {
    if (moving && photo.visitLocalId) linkArtworkVisit(patch.savedLocalId!, photo.visitLocalId, owner);
    db.update(artworkPhotos).set({ ...patch, syncedAt: null, revision: sql`${artworkPhotos.revision} + 1` })
      .where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, localId))).run();
  });
  requestCollectionSync();
}
export function editEncounter(savedLocalId: string, visitLocalId: string, patch: { note?: string; deletedAt?: number }, owner = getLocalOwner()) {
  requireWork(savedLocalId, owner); requireVisit(visitLocalId, owner);
  db.update(artworkEncounters).set({ ...patch, syncedAt: null, revision: sql`${artworkEncounters.revision} + 1` })
    .where(and(eq(artworkEncounters.owner, owner), eq(artworkEncounters.savedLocalId, savedLocalId), eq(artworkEncounters.visitLocalId, visitLocalId))).run();
  requestCollectionSync();
}
export function pendingAlbum(owner: string) {
  return {
    photos: db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), isNull(artworkPhotos.syncedAt))).limit(25).all(),
    encounters: db.select().from(artworkEncounters).where(and(eq(artworkEncounters.owner, owner), isNull(artworkEncounters.syncedAt))).limit(25).all(),
  };
}
export function photoInput(photo: ArtworkPhoto): AlbumPhoto {
  return { localId: photo.localId, savedLocalId: photo.savedLocalId, kind: photo.kind, capturedAt: photo.capturedAt,
    caption: photo.caption ?? undefined, visitLocalId: photo.visitLocalId ?? undefined, deletedAt: photo.deletedAt ?? undefined };
}
export function encounterInput(row: typeof artworkEncounters.$inferSelect): AlbumEncounter {
  return { savedLocalId: row.savedLocalId, visitLocalId: row.visitLocalId, note: row.note ?? undefined, deletedAt: row.deletedAt ?? undefined };
}
export function acknowledgeAlbum(pending: ReturnType<typeof pendingAlbum>, owner: string) {
  db.transaction((tx) => {
    for (const row of pending.photos) tx.update(artworkPhotos).set({ syncedAt: Date.now() })
      .where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, row.localId), eq(artworkPhotos.revision, row.revision))).run();
    for (const row of pending.encounters) tx.update(artworkEncounters).set({ syncedAt: Date.now() })
      .where(and(eq(artworkEncounters.owner, owner), eq(artworkEncounters.savedLocalId, row.savedLocalId), eq(artworkEncounters.visitLocalId, row.visitLocalId), eq(artworkEncounters.revision, row.revision))).run();
  });
}
export function applyAlbum(photos: Doc<'artworkPhotos'>[], encounters: Doc<'artworkEncounters'>[], owner: string) {
  db.transaction((tx) => {
    for (const row of photos) {
      const where = and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, row.localId));
      const existing = tx.select().from(artworkPhotos).where(where).get();
      const fields = { ...photoInput({ ...row, caption: row.caption ?? null, visitLocalId: row.visitLocalId ?? null, deletedAt: row.deletedAt ?? null,
        owner, path: null, storageId: row.storageId ?? null, syncedAt: row.updatedAt, revision: 0 }),
        caption: row.caption ?? null, visitLocalId: row.visitLocalId ?? null, deletedAt: row.deletedAt ?? null, storageId: row.storageId ?? null, syncedAt: row.updatedAt };
      if (!existing) tx.insert(artworkPhotos).values({ ...fields, owner }).run();
      else if (existing.syncedAt !== null || row.deletedAt !== undefined) tx.update(artworkPhotos).set(fields).where(where).run();
      else if (row.storageId) tx.update(artworkPhotos).set({ storageId: row.storageId }).where(where).run();
    }
    for (const row of encounters) {
      const where = and(eq(artworkEncounters.owner, owner), eq(artworkEncounters.savedLocalId, row.savedLocalId), eq(artworkEncounters.visitLocalId, row.visitLocalId));
      const existing = tx.select().from(artworkEncounters).where(where).get();
      const fields = { savedLocalId: row.savedLocalId, visitLocalId: row.visitLocalId, note: row.note ?? null, deletedAt: row.deletedAt ?? null, syncedAt: row.updatedAt };
      if (!existing) tx.insert(artworkEncounters).values({ ...fields, owner }).run();
      else if (existing.syncedAt !== null) tx.update(artworkEncounters).set(fields).where(where).run();
    }
  });
}
export function albumPhotoTransfers(owner: string) {
  return db.select({ photo: artworkPhotos }).from(artworkPhotos).innerJoin(savedWorks, and(eq(savedWorks.owner, artworkPhotos.owner), eq(savedWorks.localId, artworkPhotos.savedLocalId)))
    .where(and(eq(artworkPhotos.owner, owner), isNull(savedWorks.deletedAt), isNull(artworkPhotos.deletedAt),
      sql`${artworkPhotos.syncedAt} IS NOT NULL AND ((${artworkPhotos.path} IS NULL AND ${artworkPhotos.storageId} IS NOT NULL) OR (${artworkPhotos.path} IS NOT NULL AND ${artworkPhotos.storageId} IS NULL))`)).limit(20).all().map(({ photo }) => photo);
}
export function updateAlbumTransfer(localId: string, fields: { storageId?: ArtworkPhoto['storageId']; path?: string }, owner: string): boolean {
  return db.update(artworkPhotos).set(fields).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, localId), isNull(artworkPhotos.deletedAt)))
    .returning({ localId: artworkPhotos.localId }).all().length > 0;
}
/** True while a photo the caller is about to reference has no storage yet, or a save's album rows still await the server. */
export function albumMediaPending(owner: string, { photoLocalIds = [], saveLocalIds = [] }: { photoLocalIds?: string[]; saveLocalIds?: string[] }): boolean {
  const live = and(eq(artworkPhotos.owner, owner), isNull(artworkPhotos.deletedAt));
  if (photoLocalIds.length && db.select({ localId: artworkPhotos.localId }).from(artworkPhotos)
    .where(and(live, inArray(artworkPhotos.localId, photoLocalIds), or(isNull(artworkPhotos.storageId), isNull(artworkPhotos.syncedAt)))).limit(1).all().length) return true;
  if (!saveLocalIds.length) return false;
  return db.select({ localId: artworkPhotos.localId }).from(artworkPhotos)
    .where(and(eq(artworkPhotos.owner, owner), inArray(artworkPhotos.savedLocalId, saveLocalIds), isNull(artworkPhotos.syncedAt))).limit(1).all().length > 0
    || db.select({ localId: artworkEncounters.savedLocalId }).from(artworkEncounters)
      .where(and(eq(artworkEncounters.owner, owner), inArray(artworkEncounters.savedLocalId, saveLocalIds), isNull(artworkEncounters.syncedAt))).limit(1).all().length > 0;
}
export function deletedAlbumPhotoFiles(owner: string) {
  return db.select({ localId: artworkPhotos.localId, path: artworkPhotos.path }).from(artworkPhotos)
    .where(and(eq(artworkPhotos.owner, owner), isNotNull(artworkPhotos.deletedAt), isNotNull(artworkPhotos.path))).limit(20).all() as { localId: string; path: string }[];
}
export function clearDeletedAlbumPhotoPath(localId: string, owner: string) {
  db.update(artworkPhotos).set({ path: null }).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, localId), isNotNull(artworkPhotos.deletedAt))).run();
}

export function selectAllArtworkPhotos(owner = getLocalOwner()) {
  return db.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), isNull(artworkPhotos.deletedAt)));
}

export function saveArtworkSession(savedLocalId: string, newWork: import('../schema').NewSavedWork | undefined, photos: (AlbumPhoto & { path: string })[], visitLocalId: string | undefined, owner: string) {
  if (!newWork) requireWork(savedLocalId, owner);
  if (visitLocalId) requireVisit(visitLocalId, owner);
  const currentPhotos = newWork ? [] : selectArtworkPhotos(savedLocalId, owner).all();
  if (currentPhotos.length + photos.filter((photo) => !currentPhotos.some((current) => current.localId === photo.localId)).length > 100) throw new Error('An artwork can hold 100 photos');
  db.transaction((tx) => {
    if (newWork) tx.insert(savedWorks).values({ ...newWork, owner }).run();
    for (const photo of photos) {
      const existing = tx.select().from(artworkPhotos).where(and(eq(artworkPhotos.owner, owner), eq(artworkPhotos.localId, photo.localId))).get();
      if (existing && existing.savedLocalId !== savedLocalId) throw new Error('Photo belongs to another artwork');
      if (!existing) tx.insert(artworkPhotos).values({ ...photo, savedLocalId, owner }).run();
    }
    if (visitLocalId) tx.insert(artworkEncounters).values({ owner, savedLocalId, visitLocalId }).onConflictDoUpdate({
      target: [artworkEncounters.owner, artworkEncounters.savedLocalId, artworkEncounters.visitLocalId],
      set: { deletedAt: null, syncedAt: null, revision: sql`${artworkEncounters.revision} + 1` },
    }).run();
  });
  requestCollectionSync();
}

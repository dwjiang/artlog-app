import { and, desc, eq, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import type { Doc } from '../../../convex/_generated/dataModel';
import { requestCollectionSync } from '../../lib/account/sync-events';

import { db } from '../client';
import { notes, savedWorks, type NewSavedWork, type SavedWork } from '../schema';

// Snapshot fields are immutable by construction: this module exposes no update to them (design §4.2 *Moves*).

export async function insertSavedWork(work: NewSavedWork): Promise<void> {
  await db.insert(savedWorks).values(work);
}

/** The row as a query for `useLiveQuery`; `getSavedWork` reads it once. */
export function selectSavedWork(localId: string) {
  return db.select().from(savedWorks).where(eq(savedWorks.localId, localId));
}

export async function getSavedWork(localId: string): Promise<SavedWork | undefined> {
  return selectSavedWork(localId).get();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function contains(column: SQLWrapper, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/** Saved works newest first, without deleted rows; `search` matches title, artist or institution. */
export function listSavedWorks({ search }: { search?: string } = {}) {
  const term = search?.trim();
  const pattern = term ? `%${escapeLike(term)}%` : undefined;
  return db.select().from(savedWorks)
    .where(and(
      isNull(savedWorks.deletedAt),
      pattern === undefined ? undefined : or(
        contains(savedWorks.title, pattern), contains(savedWorks.artist, pattern), contains(savedWorks.institution, pattern),
      ),
    ))
    .orderBy(desc(savedWorks.savedAt));
}

export async function softDeleteSavedWork(localId: string, deletedAt = Date.now()): Promise<void> {
  await db.update(savedWorks).set({ deletedAt, syncedAt: null, revision: sql`${savedWorks.revision} + 1` }).where(eq(savedWorks.localId, localId));
  requestCollectionSync();
}

export type SyncAcknowledgement = Pick<Doc<'collections'>, 'localId' | 'updatedAt' | 'updatedBy' | 'deletedAt'> & { revision: number };

function isNewer(row: Pick<Doc<'collections'>, 'updatedAt' | 'updatedBy'>, existing: SavedWork): boolean {
  return existing.syncedAt === null || row.updatedAt > existing.syncedAt ||
    (row.updatedAt === existing.syncedAt && row.updatedBy > (existing.syncedBy ?? ''));
}

export async function markSynced(rows: SyncAcknowledgement[]): Promise<void> {
  db.transaction((tx) => {
    for (const row of rows) {
      const existing = tx.select().from(savedWorks).where(eq(savedWorks.localId, row.localId)).get();
      if (!existing) continue;
      if (row.deletedAt !== undefined && existing.deletedAt === null) {
        tx.update(savedWorks).set({ deletedAt: row.deletedAt }).where(eq(savedWorks.localId, row.localId)).run();
      }
      if (existing.revision === row.revision && isNewer(row, existing)) {
        tx.update(savedWorks).set({ syncedAt: row.updatedAt, syncedBy: row.updatedBy })
          .where(eq(savedWorks.localId, row.localId)).run();
      }
    }
  });
}

export async function listUnsynced() {
  return db.select({ work: savedWorks, note: notes.text }).from(savedWorks)
    .leftJoin(notes, eq(notes.savedLocalId, savedWorks.localId))
    .where(isNull(savedWorks.syncedAt)).orderBy(savedWorks.savedAt, savedWorks.localId).limit(500);
}

export async function queueAllForSync(): Promise<void> {
  await db.update(savedWorks).set({ syncedAt: null, revision: sql`${savedWorks.revision} + 1` });
}

export async function upsertFromRemote(rows: Doc<'collections'>[]): Promise<void> {
  db.transaction((tx) => {
    for (const row of rows) {
      const existing = tx.select().from(savedWorks).where(eq(savedWorks.localId, row.localId)).get();
      const newlyDeleted = existing?.deletedAt === null && row.deletedAt !== undefined;
      if (existing) {
        // Tombstones must survive even when a local edit is pending or a newer note arrived first.
        if (newlyDeleted) {
          tx.update(savedWorks).set({ deletedAt: row.deletedAt, syncedAt: null, revision: sql`${savedWorks.revision} + 1` })
            .where(eq(savedWorks.localId, row.localId)).run();
        }
        if (existing.syncedAt === null || !isNewer(row, existing)) continue;
        tx.update(savedWorks).set({ syncedAt: newlyDeleted ? null : row.updatedAt, syncedBy: row.updatedBy })
          .where(eq(savedWorks.localId, row.localId)).run();
      } else {
        tx.insert(savedWorks).values({
          localId: row.localId, ...row.snapshot, venueId: row.venueId, venueName: row.venueName, gallery: row.gallery,
          savedAt: row.savedAt, objectId: row.objectId, artworkId: row.artworkId,
          photoPath: null, cropPath: null, syncedAt: row.updatedAt, syncedBy: row.updatedBy, deletedAt: row.deletedAt,
        }).run();
      }
      tx.insert(notes).values({ savedLocalId: row.localId, text: row.note ?? '', updatedAt: row.updatedAt })
        .onConflictDoUpdate({ target: notes.savedLocalId, set: { text: row.note ?? '', updatedAt: row.updatedAt } }).run();
    }
  });
}

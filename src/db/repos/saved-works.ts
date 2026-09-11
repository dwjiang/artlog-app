import { and, desc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { db } from '../client';
import { savedWorks, type NewSavedWork, type SavedWork } from '../schema';

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
  await db.update(savedWorks).set({ deletedAt }).where(eq(savedWorks.localId, localId));
}

export async function markSynced(localIds: string[], syncedAt: number): Promise<void> {
  if (localIds.length === 0) return;
  await db.update(savedWorks).set({ syncedAt }).where(inArray(savedWorks.localId, localIds));
}

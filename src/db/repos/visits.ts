import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';

import { db } from '../client';
import { visits, type NewVisit, type Visit } from '../schema';

/** Inserts the visit or merges the given fields into the existing row. */
export async function upsertVisit(visit: NewVisit): Promise<void> {
  const { localId: _localId, ...fields } = visit;
  await db.insert(visits).values(visit).onConflictDoUpdate({ target: visits.localId, set: fields });
}

export async function getVisit(localId: string): Promise<Visit | undefined> {
  return db.select().from(visits).where(eq(visits.localId, localId)).get();
}

export async function patchVisit(localId: string, fields: Partial<Omit<Visit, 'localId'>>): Promise<void> {
  await db.update(visits).set(fields).where(eq(visits.localId, localId));
}

export async function getNextVisitToSync(): Promise<Visit | undefined> {
  return db.select().from(visits).where(or(
    isNull(visits.remoteVisitId),
    and(isNotNull(visits.endedAt), isNull(visits.endSyncedAt)),
  )).orderBy(asc(visits.startedAt), asc(visits.localId)).limit(1).get();
}

export function listVisits() {
  return db.select().from(visits).orderBy(desc(visits.startedAt));
}

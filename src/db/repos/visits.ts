import { desc, eq } from 'drizzle-orm';

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

export function listVisits() {
  return db.select().from(visits).orderBy(desc(visits.startedAt));
}

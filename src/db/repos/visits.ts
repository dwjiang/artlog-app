import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Doc } from '../../../convex/_generated/dataModel';
import { getLocalOwner } from '../../lib/account/owner-store';
import { requestCollectionSync } from '../../lib/account/sync-events';
import { db } from '../client';
import { visits, type NewVisit, type Visit } from '../schema';

export async function upsertVisit(visit: NewVisit, owner = getLocalOwner()): Promise<void> {
  const { localId: _localId, owner: _owner, ...fields } = visit;
  await db.insert(visits).values({ ...visit, owner }).onConflictDoUpdate({ target: [visits.owner, visits.localId],
    set: { ...fields, syncedAt: null, revision: sql`${visits.revision} + 1` } });
  requestCollectionSync();
}
export async function getVisit(localId: string, owner = getLocalOwner()) {
  return db.select().from(visits).where(and(eq(visits.owner, owner), eq(visits.localId, localId))).get();
}
export async function patchVisit(localId: string, fields: Partial<Omit<Visit, 'localId' | 'owner'>>, owner = getLocalOwner()): Promise<void> {
  await db.update(visits).set({ ...fields, syncedAt: null, revision: sql`${visits.revision} + 1` })
    .where(and(eq(visits.owner, owner), eq(visits.localId, localId)));
  requestCollectionSync();
}
export function listUnsyncedVisits(owner = getLocalOwner()) {
  return db.select().from(visits).where(and(eq(visits.owner, owner), isNull(visits.syncedAt)))
    .orderBy(visits.visitedOn, visits.localId).limit(50);
}
export function listVisits(owner = getLocalOwner()) {
  return db.select().from(visits).where(eq(visits.owner, owner)).orderBy(desc(visits.visitedOn), desc(visits.localId));
}
export async function markVisitsSynced(rows: { localId: string; visitId: Doc<'visits'>['_id']; revision: number; updatedAt: number; updatedBy: Doc<'visits'>['updatedBy'] }[], owner = getLocalOwner()) {
  db.transaction((tx) => {
    for (const row of rows) {
      const target = and(eq(visits.owner, owner), eq(visits.localId, row.localId));
      tx.update(visits).set({ remoteVisitId: row.visitId }).where(target).run();
      tx.update(visits).set({ syncedAt: row.updatedAt, syncedBy: row.updatedBy })
        .where(and(target, eq(visits.revision, row.revision))).run();
    }
  });
}
export async function upsertVisitsFromRemote(rows: Doc<'visits'>[], owner = getLocalOwner()) {
  db.transaction((tx) => {
    for (const row of rows) {
      const target = and(eq(visits.owner, owner), eq(visits.localId, row.localId));
      const existing = tx.select().from(visits).where(target).get();
      if (existing && (existing.syncedAt === null || existing.syncedAt > row.updatedAt ||
        (existing.syncedAt === row.updatedAt && (existing.syncedBy ?? '') > row.updatedBy))) continue;
      const fields = { owner, localId: row.localId, venueId: row.venueId, venueName: row.venueName,
        visitedOn: row.visitedOn, timeZone: row.timeZone, reflection: row.reflection ?? null,
        startedAt: row.startedAt ?? null, endedAt: row.endedAt ?? null, remoteVisitId: row._id, syncedAt: row.updatedAt, syncedBy: row.updatedBy };
      tx.insert(visits).values(fields).onConflictDoUpdate({ target: [visits.owner, visits.localId], set: fields }).run();
    }
  });
}

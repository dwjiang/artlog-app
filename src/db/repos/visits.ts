import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Doc } from '../../../convex/_generated/dataModel';
import { ConvexError } from 'convex/values';
import { validateVisit } from '../../../shared/journal/contracts';
import { visitInput } from '../../lib/journal/visit-payload';
import { getLocalOwner } from '../../lib/account/owner-store';
import { requestCollectionSync } from '../../lib/account/sync-events';
import { db } from '../client';
import { visits, type NewVisit, type Visit } from '../schema';

/** Sync state is owned by markVisitsSynced and upsertVisitsFromRemote; callers describe only the visit itself. */
export type VisitDraft = Omit<NewVisit, 'owner' | 'remoteVisitId' | 'syncedAt' | 'syncedBy' | 'revision'>;
export async function upsertVisit(visit: VisitDraft, owner = getLocalOwner()): Promise<void> {
  validateVisit(visitInput(visit));
  db.transaction((tx) => {
    const existing = tx.select().from(visits).where(and(eq(visits.owner, owner), eq(visits.localId, visit.localId))).get();
    if (existing && existing.venueId !== visit.venueId) throw new ConvexError({ code: 'invalid_visit' });
    const fields = { ...visitInput(visit), venueName: visit.venueName, reflection: visit.reflection ?? null,
      startedAt: visit.startedAt ?? null, endedAt: visit.endedAt ?? null };
    if (existing && Object.entries(fields).every(([key, value]) => existing[key as keyof Visit] === value)) return;
    tx.insert(visits).values({ ...fields, owner }).onConflictDoUpdate({ target: [visits.owner, visits.localId],
      set: { ...fields, syncedAt: null, revision: sql`${visits.revision} + 1` } }).run();
  });
  requestCollectionSync();
}
export async function getVisit(localId: string, owner = getLocalOwner()) {
  return db.select().from(visits).where(and(eq(visits.owner, owner), eq(visits.localId, localId))).get();
}
export async function patchVisit(localId: string, fields: Partial<Pick<Visit, 'visitedOn' | 'timeZone' | 'startedAt' | 'endedAt' | 'reflection'>>, owner = getLocalOwner()): Promise<void> {
  db.transaction((tx) => {
    const target = and(eq(visits.owner, owner), eq(visits.localId, localId));
    const existing = tx.select().from(visits).where(target).get();
    if (!existing) throw new ConvexError({ code: 'not_found' });
    const merged = { ...existing, ...fields };
    validateVisit(visitInput(merged));
    tx.update(visits).set({ ...fields, syncedAt: null, revision: sql`${visits.revision} + 1` }).where(target).run();
  });
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
      // The server accepted the row at updatedAt on its clock; a device running behind must not reject it.
      validateVisit(row, Math.max(Date.now(), row.updatedAt));
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

import { ConvexError } from "convex/values";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { artworkEncounters, savedWorks, visits, type NewVisit, type Visit } from "@/db/schema";
import { getLocalOwner } from "@/lib/account/owner-store";
import { requestCollectionSync } from "@/lib/account/sync-events";
import { visitInput } from "@/lib/journal/visit-payload";
import { validateVisit } from "@/shared/journal/contracts";

import type { Doc, Id } from "../../../convex/_generated/dataModel";

/** Sync state is owned by markVisitsSynced and upsertVisitsFromRemote; callers describe only the visit itself. */
export type VisitDraft = Omit<NewVisit, "owner" | "remoteVisitId" | "syncedAt" | "syncedBy" | "revision">;
export async function upsertVisit(visit: VisitDraft, owner = getLocalOwner(), artworkLocalId?: string): Promise<void> {
  validateVisit(visitInput(visit));
  db.transaction((tx) => {
    if (
      artworkLocalId
      && !tx
        .select()
        .from(savedWorks)
        .where(and(eq(savedWorks.owner, owner), eq(savedWorks.localId, artworkLocalId), isNull(savedWorks.deletedAt)))
        .get()
    ) {
      throw new ConvexError({ code: "not_found" });
    }
    const existing = tx
      .select()
      .from(visits)
      .where(and(eq(visits.owner, owner), eq(visits.localId, visit.localId)))
      .get();
    if (existing && existing.venueId !== visit.venueId) {
      throw new ConvexError({ code: "invalid_visit" });
    }
    const fields = {
      ...visitInput({
        ...visit,
        visibility: visit.visibility ?? existing?.visibility,
      }),
      venueName: visit.venueName,
      reflection: visit.reflection ?? null,
      startedAt: visit.startedAt ?? null,
      endedAt: visit.endedAt ?? null,
    };
    if (!existing || Object.entries(fields).some(([key, value]) => existing[key as keyof Visit] !== value)) {
      tx.insert(visits)
        .values({ ...fields, owner })
        .onConflictDoUpdate({
          target: [visits.owner, visits.localId],
          set: {
            ...fields,
            syncedAt: null,
            revision: sql`${visits.revision} + 1`,
          },
        })
        .run();
    }
    if (artworkLocalId) {
      const encounter = tx
        .select()
        .from(artworkEncounters)
        .where(
          and(
            eq(artworkEncounters.owner, owner),
            eq(artworkEncounters.savedLocalId, artworkLocalId),
            eq(artworkEncounters.visitLocalId, visit.localId),
          ),
        )
        .get();
      if (!encounter || encounter.deletedAt !== null) {
        tx.insert(artworkEncounters)
          .values({
            owner,
            savedLocalId: artworkLocalId,
            visitLocalId: visit.localId,
          })
          .onConflictDoUpdate({
            target: [artworkEncounters.owner, artworkEncounters.savedLocalId, artworkEncounters.visitLocalId],
            set: {
              deletedAt: null,
              syncedAt: null,
              revision: sql`${artworkEncounters.revision} + 1`,
            },
          })
          .run();
      }
    }
  });
  requestCollectionSync();
}
export async function getVisit(localId: string, owner = getLocalOwner()) {
  return db
    .select()
    .from(visits)
    .where(and(eq(visits.owner, owner), eq(visits.localId, localId)))
    .get();
}
/** The visit at the museum on that calendar day, the latest started first; `open` skips visits that have ended. */
export async function findVisitOnDay(
  venueId: Id<"museums">,
  visitedOn: string,
  owner = getLocalOwner(),
  { open = false } = {},
) {
  const day = and(eq(visits.owner, owner), eq(visits.venueId, venueId), eq(visits.visitedOn, visitedOn));
  return db
    .select()
    .from(visits)
    .where(open ? and(day, isNull(visits.endedAt)) : day)
    .orderBy(desc(visits.startedAt))
    .get();
}
/** Visits with a start and no end, from any day; the venue controller closes the ones whose day has passed. */
export async function listOpenVisits(owner = getLocalOwner()) {
  return db
    .select()
    .from(visits)
    .where(and(eq(visits.owner, owner), isNotNull(visits.startedAt), isNull(visits.endedAt)))
    .orderBy(visits.startedAt)
    .all();
}
/** When the visit's most recent artwork was saved, or undefined when nothing was saved on it. */
export async function latestVisitActivity(localId: string, owner = getLocalOwner()): Promise<number | undefined> {
  const row = db
    .select({ latest: sql<number | null>`max(${savedWorks.savedAt})` })
    .from(artworkEncounters)
    .innerJoin(
      savedWorks,
      and(eq(savedWorks.owner, artworkEncounters.owner), eq(savedWorks.localId, artworkEncounters.savedLocalId)),
    )
    .where(
      and(
        eq(artworkEncounters.owner, owner),
        eq(artworkEncounters.visitLocalId, localId),
        isNull(artworkEncounters.deletedAt),
        isNull(savedWorks.deletedAt),
      ),
    )
    .get();
  return row?.latest ?? undefined;
}
/** `sync: false` leaves the edit pending for the next sync request instead of scheduling one now. */
export async function patchVisit(
  localId: string,
  fields: Partial<Pick<Visit, "visitedOn" | "timeZone" | "startedAt" | "endedAt" | "reflection" | "visibility">>,
  owner = getLocalOwner(),
  { sync = true } = {},
): Promise<void> {
  db.transaction((tx) => {
    const target = and(eq(visits.owner, owner), eq(visits.localId, localId));
    const existing = tx.select().from(visits).where(target).get();
    if (!existing) throw new ConvexError({ code: "not_found" });
    const merged = { ...existing, ...fields };
    validateVisit(visitInput(merged));
    tx.update(visits)
      .set({ ...fields, syncedAt: null, revision: sql`${visits.revision} + 1` })
      .where(target)
      .run();
  });
  if (sync) requestCollectionSync();
}
export function listUnsyncedVisits(owner = getLocalOwner()) {
  return db
    .select()
    .from(visits)
    .where(and(eq(visits.owner, owner), isNull(visits.syncedAt)))
    .orderBy(visits.visitedOn, visits.localId)
    .limit(50);
}
export function listVisits(owner = getLocalOwner()) {
  return db.select().from(visits).where(eq(visits.owner, owner)).orderBy(desc(visits.visitedOn), desc(visits.localId));
}
export async function markVisitsSynced(
  rows: {
    localId: string;
    visitId: Doc<"visits">["_id"];
    revision: number;
    updatedAt: number;
    updatedBy: Doc<"visits">["updatedBy"];
  }[],
  owner = getLocalOwner(),
) {
  db.transaction((tx) => {
    for (const row of rows) {
      const target = and(eq(visits.owner, owner), eq(visits.localId, row.localId));
      tx.update(visits).set({ remoteVisitId: row.visitId }).where(target).run();
      tx.update(visits)
        .set({ syncedAt: row.updatedAt, syncedBy: row.updatedBy })
        .where(and(target, eq(visits.revision, row.revision)))
        .run();
    }
  });
}
export async function upsertVisitsFromRemote(rows: Doc<"visits">[], owner = getLocalOwner()) {
  db.transaction((tx) => {
    for (const row of rows) {
      // The server accepted the row at updatedAt on its clock; a device running behind must not reject it.
      validateVisit(row, Math.max(Date.now(), row.updatedAt));
      const target = and(eq(visits.owner, owner), eq(visits.localId, row.localId));
      const existing = tx.select().from(visits).where(target).get();
      if (
        existing
        && (existing.syncedAt === null
          || existing.syncedAt > row.updatedAt
          || (existing.syncedAt === row.updatedAt && (existing.syncedBy ?? "") > row.updatedBy))
      ) {
        continue;
      }
      const fields = {
        owner,
        localId: row.localId,
        venueId: row.venueId,
        venueName: row.venueName,
        visibility: row.visibility,
        visitedOn: row.visitedOn,
        timeZone: row.timeZone,
        reflection: row.reflection ?? null,
        startedAt: row.startedAt ?? null,
        endedAt: row.endedAt ?? null,
        remoteVisitId: row._id,
        syncedAt: row.updatedAt,
        syncedBy: row.updatedBy,
      };
      tx.insert(visits)
        .values(fields)
        .onConflictDoUpdate({
          target: [visits.owner, visits.localId],
          set: fields,
        })
        .run();
    }
  });
}

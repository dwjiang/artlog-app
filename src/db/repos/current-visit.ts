import { ConvexError } from "convex/values";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { settings, visits } from "@/db/schema";
import { requestCollectionSync } from "@/lib/account/sync-events";
import { visitInput } from "@/lib/journal/visit-payload";
import { validateVisit } from "@/shared/journal/contracts";

import type { VisitDraft } from "./visits";

export function visitSettingKeys(owner: string) {
  return { current: `currentVisit:${owner}`, manual: `manualVisit:${owner}`, ended: `endedVisit:${owner}` };
}

// No async work inside this transaction: cancellation is checked before committing, and sync only sees both visits.
export function activateVisit(
  visit: VisitDraft & { startedAt: number },
  owner: string,
  { manual = false, endPrevious }: { manual?: boolean; endPrevious?: { localId: string; at: number } } = {},
): void {
  const keys = visitSettingKeys(owner);
  db.transaction((tx) => {
    const target = and(eq(visits.owner, owner), eq(visits.localId, visit.localId));
    const existing = tx.select().from(visits).where(target).get();
    if (existing && (existing.venueId !== visit.venueId || existing.endedAt !== null)) {
      throw new ConvexError({ code: "invalid_visit" });
    }
    validateVisit(visitInput(existing ? { ...existing, startedAt: visit.startedAt } : visit));
    if (existing) {
      if (existing.startedAt !== visit.startedAt) {
        tx.update(visits)
          .set({ startedAt: visit.startedAt, syncedAt: null, revision: sql`${visits.revision} + 1` })
          .where(target)
          .run();
      }
    } else {
      tx.insert(visits)
        .values({ ...visitInput(visit), venueName: visit.venueName, owner })
        .run();
    }
    if (endPrevious) {
      const previousTarget = and(eq(visits.owner, owner), eq(visits.localId, endPrevious.localId));
      const previous = tx.select().from(visits).where(previousTarget).get();
      if (!previous || previous.localId === visit.localId || previous.endedAt !== null) {
        throw new ConvexError({ code: "invalid_visit" });
      }
      validateVisit(visitInput({ ...previous, endedAt: endPrevious.at }));
      tx.update(visits)
        .set({ endedAt: endPrevious.at, syncedAt: null, revision: sql`${visits.revision} + 1` })
        .where(previousTarget)
        .run();
    }
    tx.delete(settings)
      .where(inArray(settings.key, [keys.ended, keys.manual]))
      .run();
    if (manual) tx.insert(settings).values({ key: keys.manual, value: visit.localId }).run();
    tx.insert(settings)
      .values({ key: keys.current, value: visit.localId })
      .onConflictDoUpdate({ target: settings.key, set: { value: visit.localId } })
      .run();
  });
  requestCollectionSync();
}

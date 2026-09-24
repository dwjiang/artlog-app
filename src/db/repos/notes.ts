import { and, eq, sql } from "drizzle-orm";

import {
  MAX_NOTE_LENGTH,
  NOTE_LENGTH_MESSAGE,
} from "../../../shared/collection/collection-limits";
import { requestCollectionSync } from "../../lib/account/sync-events";

import { getLocalOwner } from "../../lib/account/owner-store";
import { db } from "../client";
import { notes, savedWorks, type Note } from "../schema";

export async function setNote(
  savedLocalId: string,
  text: string,
  updatedAt = Date.now(),
  owner = getLocalOwner(),
): Promise<void> {
  if (text.length > MAX_NOTE_LENGTH) throw new RangeError(NOTE_LENGTH_MESSAGE);
  db.transaction((tx) => {
    tx.insert(notes)
      .values({ owner, savedLocalId, text, updatedAt })
      .onConflictDoUpdate({
        target: [notes.owner, notes.savedLocalId],
        set: { text, updatedAt },
      })
      .run();
    tx.update(savedWorks)
      .set({ syncedAt: null, revision: sql`${savedWorks.revision} + 1` })
      .where(
        and(eq(savedWorks.owner, owner), eq(savedWorks.localId, savedLocalId)),
      )
      .run();
  });
  requestCollectionSync();
}

export async function getNote(
  savedLocalId: string,
  owner = getLocalOwner(),
): Promise<Note | undefined> {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.owner, owner), eq(notes.savedLocalId, savedLocalId)))
    .get();
}

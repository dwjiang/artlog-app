import { eq } from 'drizzle-orm';

import { db } from '../client';
import { notes, type Note } from '../schema';

export async function setNote(savedLocalId: string, text: string, updatedAt = Date.now()): Promise<void> {
  await db.insert(notes).values({ savedLocalId, text, updatedAt })
    .onConflictDoUpdate({ target: notes.savedLocalId, set: { text, updatedAt } });
}

export async function getNote(savedLocalId: string): Promise<Note | undefined> {
  return db.select().from(notes).where(eq(notes.savedLocalId, savedLocalId)).get();
}

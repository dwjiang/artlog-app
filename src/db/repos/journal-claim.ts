import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { notes, pendingScans, savedWorks, settings, visits } from '../schema';

export async function claimLocalJournal(source: string, accountOwner: string, claimId: string): Promise<void> {
  if (!source.startsWith('device:') || !accountOwner.startsWith('account:')) throw new Error('Invalid journal claim');
  db.transaction((tx) => {
    const key = `journalClaim:${source}:${claimId}`;
    if (tx.select().from(settings).where(eq(settings.key, key)).get()?.value === accountOwner) return;
    for (const table of [visits, savedWorks, pendingScans]) {
      const collision = tx.get(sql`SELECT 1 FROM ${table} AS source JOIN ${table} AS target ON source.localId = target.localId
        WHERE source.owner = ${source} AND target.owner = ${accountOwner} LIMIT 1`);
      if (collision) throw new Error('Journal ownership collision');
    }
    for (const draftKind of ['labelDraft', 'photoDraft']) {
      const prefix = `${draftKind}:${source}:`;
      const drafts = tx.select().from(settings).where(sql`substr(${settings.key}, 1, ${prefix.length}) = ${prefix}`).all();
      for (const draft of drafts) {
        const target = `${draftKind}:${accountOwner}:${draft.key.slice(prefix.length)}`;
        if (tx.select().from(settings).where(eq(settings.key, target)).get()) throw new Error('Journal ownership collision');
        tx.update(settings).set({ key: target }).where(eq(settings.key, draft.key)).run();
      }
    }
    // Composite foreign keys cascade ownership to associated saves, notes, and captures.
    tx.update(visits).set({ owner: accountOwner }).where(eq(visits.owner, source)).run();
    tx.update(savedWorks).set({ owner: accountOwner }).where(eq(savedWorks.owner, source)).run();
    tx.update(notes).set({ owner: accountOwner }).where(eq(notes.owner, source)).run();
    tx.update(pendingScans).set({ owner: accountOwner }).where(eq(pendingScans.owner, source)).run();
    // Visit preferences follow the journal; an existing account preference on this device wins.
    for (const preference of ['currentVisit', 'captureVisit']) {
      const current = tx.select().from(settings).where(eq(settings.key, `${preference}:${source}`)).get();
      if (!current) continue;
      const usable = ['auto', 'none'].includes(current.value) ||
        !!tx.select().from(visits).where(and(eq(visits.owner, accountOwner), eq(visits.localId, current.value))).get();
      if (usable) tx.insert(settings).values({ key: `${preference}:${accountOwner}`, value: current.value }).onConflictDoNothing().run();
      tx.delete(settings).where(eq(settings.key, current.key)).run();
    }
    tx.insert(settings).values({ key, value: accountOwner }).onConflictDoUpdate({ target: settings.key, set: { value: accountOwner } }).run();
  });
}

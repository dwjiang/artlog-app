import { useEffect } from 'react';
import { reportError } from '@/lib/observability';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@/db/client';
import { settings, type Visit } from '@/db/schema';

export const seenVisitsKey = (owner: string) => `seenVisits:${owner}`;

/** The stored value is a JSON array of visit ids; anything unreadable counts as nothing seen. */
export function parseSeenVisits(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function selectSeenVisits(owner: string) {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, seenVisitsKey(owner)));
}

/** Visits opened since they closed; a closed visit outside this set is shown as new. */
export function useSeenVisits(owner: string): Set<string> {
  const rows = useLiveQuery(selectSeenVisits(owner), [owner]);
  useEffect(() => { if (rows.error) reportError(rows.error, 'journal.seen-visits.load'); }, [rows.error]);
  return new Set(parseSeenVisits(rows.data[0]?.value));
}

export function markVisitSeen(localId: string, owner: string): void {
  const current = parseSeenVisits(db.select({ value: settings.value }).from(settings).where(eq(settings.key, seenVisitsKey(owner))).get()?.value);
  if (current.includes(localId)) return;
  const value = JSON.stringify([...current, localId]);
  db.insert(settings).values({ key: seenVisitsKey(owner), value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** Open visits and manually added ones are never "new"; only a visit that ended and has not been opened since. */
export function isVisitNew(visit: Pick<Visit, 'localId' | 'endedAt'>, seen: Set<string>): boolean {
  return visit.endedAt !== null && !seen.has(visit.localId);
}

import { useEffect } from 'react';
import { reportError } from '@/lib/observability';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { selectArtworkEncounters } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import type { SavedWork } from '@/db/schema';
import { useRemovedWorkIds } from '../collection/pending-removals';

/** Artworks saved on one visit, newest first, for overlays that need a count and thumbnails without the whole journal. */
export function useVisitWorks(visitLocalId: string | undefined, owner: string) {
  const removedIds = useRemovedWorkIds(owner);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const error = encounters.error ?? works.error;
  useEffect(() => { if (error) reportError(error, 'journal.visit-artworks.load'); }, [error]);
  const loading = !!visitLocalId && !error && (!encounters.updatedAt || !works.updatedAt);
  const linked = new Set(encounters.data
    .filter((encounter) => encounter.owner === owner && encounter.visitLocalId === visitLocalId && encounter.deletedAt === null)
    .map((encounter) => encounter.savedLocalId));
  const rows: SavedWork[] = works.data.filter((work) => work.owner === owner && linked.has(work.localId) && work.deletedAt === null && !removedIds.includes(work.localId))
    .sort((a, b) => b.savedAt - a.savedAt || a.localId.localeCompare(b.localId));
  return { works: visitLocalId ? rows : [], loading, error };
}

/** "2:10 PM" in the museum's time zone. */
export function formatVisitStart(startedAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(startedAt);
}

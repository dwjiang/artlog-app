import { useConvexAuth } from 'convex/react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useReducer } from 'react';

import { useLocalOwner, useOwnerGeneration } from '@/lib/account/owner-store';
import { pendingScansQuery } from '@/db/repos/pending-scans';
import type { PendingScan } from '@/db/schema';
import { startPendingShareFlusher } from '@/lib/label/share-saved-label';
import { startQueueFlusher } from './queue';

export type QueueState = { pending: number; items: PendingScan[]; loading: boolean; error?: Error };

/** Pending counts unfinished requests; items keep every unsaved capture available to resume. */
export function useQueue(): QueueState {
  const owner = useLocalOwner();
  const [albumRevision, refreshAlbum] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => {
    // Drizzle observes only the base table; saving changes the joined album table.
    const subscription = addDatabaseChangeListener(({ tableName }) => {
      if (tableName === 'artworkPhotos') refreshAlbum();
    });
    return () => subscription.remove();
  }, []);
  const { data: rows, updatedAt, error } = useLiveQuery(pendingScansQuery(owner), [owner, albumRevision]);
  const data = rows.filter((row) => row.owner === owner);
  return { pending: data.filter((row) => row.status === 'queued' || row.status === 'identifying').length, items: data, loading: !updatedAt && !error, error };
}

/** Runs the flushers once the anonymous session exists; identify and contribute reject callers before that. */
export function useQueueFlusher(): void {
  const generation = useOwnerGeneration();
  const { isAuthenticated } = useConvexAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    const stopQueue = startQueueFlusher(), stopShares = startPendingShareFlusher();
    return () => { stopQueue(); stopShares(); };
  }, [isAuthenticated, generation]);
}

export function QueueFlusher(): null {
  useQueueFlusher();
  return null;
}

import { useConvexAuth } from 'convex/react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect } from 'react';

import { pendingScansQuery } from '@/db/repos/pending-scans';
import type { PendingScan } from '@/db/schema';
import { startQueueFlusher } from './queue';

export type QueueState = { pending: number; items: PendingScan[] };

/** Live view of captures still waiting; queued and identifying rows count as pending, failed rows stay listed. */
export function useQueue(): QueueState {
  const { data } = useLiveQuery(pendingScansQuery());
  return { pending: data.filter((row) => row.status === 'queued' || row.status === 'identifying').length, items: data };
}

/** Runs the flusher once the anonymous session exists; identify rejects callers before that. */
export function useQueueFlusher(): void {
  const { isAuthenticated } = useConvexAuth();
  useEffect(() => (isAuthenticated ? startQueueFlusher() : undefined), [isAuthenticated]);
}

export function QueueFlusher(): null {
  useQueueFlusher();
  return null;
}

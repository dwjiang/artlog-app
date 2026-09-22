import { and, eq } from 'drizzle-orm';
import type { OfflineResult } from '@/shared/offline/types';
import { getLocalOwner } from '@/lib/account/owner-store';
import { db } from '../client';
import { offlineScanResults } from '../schema';

export const offlineResultQuery = (localId: string, owner = getLocalOwner()) => db.select().from(offlineScanResults)
  .where(and(eq(offlineScanResults.owner, owner), eq(offlineScanResults.localId, localId)));
export async function cacheOfflineResult(localId: string, result: OfflineResult, owner = getLocalOwner()) {
  await db.insert(offlineScanResults).values({ owner, localId, result }).onConflictDoUpdate({ target: [offlineScanResults.owner, offlineScanResults.localId], set: { result } });
}

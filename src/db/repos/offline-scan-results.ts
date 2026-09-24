import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { offlineScanResults } from "@/db/schema";
import { getLocalOwner } from "@/lib/account/owner-store";
import type { OfflineResult } from "@/shared/offline/types";

export const offlineResultQuery = (localId: string, owner = getLocalOwner()) =>
  db
    .select()
    .from(offlineScanResults)
    .where(and(eq(offlineScanResults.owner, owner), eq(offlineScanResults.localId, localId)));
export async function cacheOfflineResult(localId: string, result: OfflineResult, owner = getLocalOwner()) {
  await db
    .insert(offlineScanResults)
    .values({ owner, localId, result })
    .onConflictDoUpdate({
      target: [offlineScanResults.owner, offlineScanResults.localId],
      set: { result },
    });
}

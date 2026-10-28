import { getVisit } from "@/db/repos/visits";
import { flushJournal } from "@/lib/account/collection-sync";
import { captureOwner } from "@/lib/account/owner-store";
import { SyncUnavailableError } from "@/lib/network-error";

import type { Id } from "../../../convex/_generated/dataModel";

/** The server id a scan's visit carries; undefined once the visit was discarded, so the scan goes on without it. */
export async function resolveScanVisit(localId: string): Promise<Id<"visits"> | undefined> {
  const current = captureOwner();
  let visit = await getVisit(localId, current.owner, { discarded: true });
  if (!current.isCurrent()) throw new Error("Journal owner changed");
  if (!visit) {
    throw new Error("The capture is linked to an invalid visit");
  }
  if (visit.deletedAt !== null) return undefined;
  if (!visit.remoteVisitId || visit.syncedAt === null) {
    await flushJournal();
    if (!current.isCurrent()) throw new Error("Journal owner changed");
    visit = await getVisit(localId, current.owner, { discarded: true });
    if (visit?.deletedAt != null) return undefined;
  }
  if (!visit?.remoteVisitId) {
    throw new Error("The capture visit could not be synchronized");
  }
  if (visit.syncedAt === null) throw new SyncUnavailableError();
  return visit.remoteVisitId;
}

import type { Id } from "../../../convex/_generated/dataModel";
import { getVisit } from "@/db/repos/visits";
import { flushJournal } from "@/lib/account/collection-sync";
import { captureOwner } from "@/lib/account/owner-store";

export async function resolveScanVisit(localId: string, venueId: Id<"museums">): Promise<Id<"visits">> {
  const current = captureOwner();
  let visit = await getVisit(localId, current.owner);
  if (!current.isCurrent()) throw new Error("Journal owner changed");
  if (!visit || visit.venueId !== venueId) {
    throw new Error("The capture is linked to an invalid visit");
  }
  if (!visit.remoteVisitId) {
    await flushJournal();
    if (!current.isCurrent()) throw new Error("Journal owner changed");
    visit = await getVisit(localId, current.owner);
  }
  if (!visit?.remoteVisitId) {
    throw new Error("The capture visit could not be synchronized");
  }
  return visit.remoteVisitId;
}

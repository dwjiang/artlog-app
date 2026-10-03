import { patchVisit } from "@/db/repos/visits";
import type { Visit } from "@/db/schema";
import { flushJournal } from "@/lib/account/collection-sync";
import { captureOwner } from "@/lib/account/owner-store";
import { withTimeout } from "@/lib/with-timeout";
import type { VisitVisibility } from "@/shared/journal/contracts";

/** A signed-in visibility change is complete only after the journal has synced it. */
export async function saveVisitVisibility(
  visit: Pick<Visit, "localId" | "owner">,
  visibility: VisitVisibility,
): Promise<void> {
  const session = captureOwner();
  const checkOwner = () => {
    if (session.owner !== visit.owner || !session.isCurrent()) throw new Error("Journal owner changed");
  };
  checkOwner();
  await patchVisit(visit.localId, { visibility }, visit.owner);
  checkOwner();
  if (!visit.owner.startsWith("account:")) return;
  await withTimeout(flushJournal(), 30_000, "Visibility sync timed out");
  checkOwner();
}

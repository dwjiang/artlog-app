import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import { loadLabelDraft } from "@/lib/label/draft";
import type { ScanResult } from "@/lib/result/state";

export async function restoreConfirmedMuseumFlow(
  scan: Pick<NonNullable<ScanResult>, "scanId" | "museumSearch" | "labelFlow">,
): Promise<LabelFlowDisplay | undefined> {
  const { museumSearch: search, labelFlow: flow } = scan;
  if (
    search?.stage !== "confirmed"
    || flow?.stage !== "verified"
    || flow.moderation !== "clear"
  ) {
    return;
  }
  if (
    flow.updatedAt !== search.updatedAt
    || flow.sourceUrl !== search.selected.sourceUrl
  ) {
    // Sharing keeps the confirmation's identity while verification replaces the server's fields.
    if (!(await loadLabelDraft(scan.scanId, search.updatedAt))) return;
  }
  return flow;
}

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_EVIDENCE_SCANS = 6;

// Reads one row past the cap so callers can reject a link set that grew beyond it.
export function loadProposalEvidence(
  ctx: QueryCtx,
  proposalId: Id<"placementProposals">,
): Promise<Doc<"proposalEvidence">[]> {
  return ctx.db
    .query("proposalEvidence")
    .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
    .take(MAX_EVIDENCE_SCANS + 1);
}

export function evidenceDeviceIds(links: Pick<Doc<"proposalEvidence">, "deviceId">[]): Id<"devices">[] {
  return [...new Set(links.map((link) => link.deviceId))];
}

export async function replaceProposalEvidence(
  ctx: MutationCtx,
  proposalId: Id<"placementProposals">,
  links: Doc<"proposalEvidence">[],
  scans: Pick<Doc<"scans">, "_id" | "deviceId">[],
): Promise<void> {
  for (const link of links) await ctx.db.delete("proposalEvidence", link._id);
  for (const scan of scans) {
    await ctx.db.insert("proposalEvidence", { proposalId, deviceId: scan.deviceId, scanId: scan._id });
  }
}

import { and, eq } from "drizzle-orm";
import { ConvexError } from "convex/values";
import { db } from "../client";
import { visits } from "../schema";

export function requireVisitMembership(
  owner: string,
  row: {
    visitLocalId?: string | null;
    venueId?: string | null;
    visitId?: string | null;
  },
): void {
  if (row.visitLocalId == null && row.visitId == null) return;
  const visit = row.visitLocalId
    ? db
        .select()
        .from(visits)
        .where(and(eq(visits.owner, owner), eq(visits.localId, row.visitLocalId)))
        .get()
    : undefined;
  if (!visit || visit.venueId !== row.venueId || (row.visitId != null && visit.remoteVisitId !== row.visitId)) {
    throw new ConvexError({ code: "not_found" });
  }
}

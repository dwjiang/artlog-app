import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function searchRecordId(row: Pick<Doc<"vectors">, "_id" | "contentHash" | "partition">): string {
  // Immutable IDs keep a delayed upsert from overwriting a newer embedding or partition.
  return `${row._id}:${row.contentHash}:${row.partition}`;
}

export async function queueVectorSync(
  ctx: MutationCtx,
  row: Pick<Doc<"vectors">, "_id" | "contentHash" | "partition">,
  operation: "upsert" | "delete",
): Promise<void> {
  // Callers wake once per batch. Reading the queue head here would make imports conflict with worker claims.
  const recordId = searchRecordId(row);
  const existing = await ctx.db
    .query("vectorSyncJobs")
    .withIndex("by_recordId", (q) => q.eq("recordId", recordId))
    .unique();
  if (existing) {
    if (existing.operation === operation && existing.state === "pending") return;
    await ctx.db.patch("vectorSyncJobs", existing._id, {
      operation,
      revision: existing.revision + 1,
      attempts: 0,
      state: "pending",
      availableAt: existing.lease ? existing.availableAt : Date.now(),
    });
  } else {
    await ctx.db.insert("vectorSyncJobs", {
      vectorId: row._id,
      recordId,
      operation,
      revision: 0,
      attempts: 0,
      state: "pending",
      availableAt: Date.now(),
    });
  }
}

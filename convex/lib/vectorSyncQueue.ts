import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function searchRecordId(row: Pick<Doc<"vectors">, "_id" | "contentHash" | "partition">): string {
  // Immutable IDs keep a delayed upsert from overwriting a newer embedding or partition.
  return `${row._id}:${row.contentHash}:${row.partition}`;
}

// Convex builds a scheduler per transaction. One drain serves a whole batch; more would only contend for its claims.
const drainScheduled = new WeakSet<MutationCtx["scheduler"]>();

// Append-only: reading the outbox here would make every import batch conflict with worker claims.
export async function queueVectorSync(
  ctx: MutationCtx,
  row: Pick<Doc<"vectors">, "_id" | "contentHash" | "partition">,
): Promise<void> {
  await ctx.db.insert("vectorSyncJobs", {
    vectorId: row._id,
    recordId: searchRecordId(row),
    attempts: 0,
    state: "pending",
    availableAt: Date.now(),
  });
  if (drainScheduled.has(ctx.scheduler)) return;
  drainScheduled.add(ctx.scheduler);
  await ctx.scheduler.runAfter(0, internal.vectorSync.drain, {});
}

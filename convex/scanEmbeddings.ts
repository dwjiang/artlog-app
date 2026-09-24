import { ConvexError } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function readEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings">): Promise<number[] | null> {
  return (await ctx.db.get("scanEmbeddings", id))?.vector ?? null;
}

// Device removal deletes a banned device's payloads while its scans remain.
export async function requireEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings">): Promise<number[]> {
  const vector = await readEmbedding(ctx, id);
  if (!vector) throw new ConvexError({ code: "scan_not_found" });
  return vector;
}

export async function deleteEmbedding(ctx: MutationCtx, id: Id<"scanEmbeddings">): Promise<void> {
  if (await ctx.db.get("scanEmbeddings", id)) await ctx.db.delete("scanEmbeddings", id);
}

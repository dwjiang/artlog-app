import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { withErrorReporting } from "./lib/observability";

export const SCAN_VECTOR_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const EXPIRE_BATCH = 256;
const EXPIRE_BATCH_BYTES = 4 * 1024 * 1024;

export async function readEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings">): Promise<number[] | null> {
  return (await ctx.db.get("scanEmbeddings", id))?.vector ?? null;
}

// Device removal and expiry delete payloads while their scans remain.
export async function requireEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings">): Promise<number[]> {
  const vector = await readEmbedding(ctx, id);
  if (!vector) throw new ConvexError({ code: "scan_not_found" });
  return vector;
}

export function insertExpiringEmbedding(ctx: MutationCtx, vector: number[]): Promise<Id<"scanEmbeddings">> {
  return ctx.db.insert("scanEmbeddings", { vector, expiresAt: Date.now() + SCAN_VECTOR_TTL_MS });
}

export async function deleteEmbedding(ctx: MutationCtx, id: Id<"scanEmbeddings">): Promise<void> {
  if (await ctx.db.get("scanEmbeddings", id)) await ctx.db.delete("scanEmbeddings", id);
}

export const expireBatch = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    // The lower bound skips contribution copies, which have no expiry and sort first.
    const { page, isDone } = await ctx.db
      .query("scanEmbeddings")
      .withIndex("by_expiresAt", (q) => q.gte("expiresAt", 0).lte("expiresAt", Date.now()))
      .paginate({ cursor: null, numItems: EXPIRE_BATCH, maximumBytesRead: EXPIRE_BATCH_BYTES });
    // Deleting the page lets the next batch start at the first remaining expired row.
    for (const row of page) await ctx.db.delete("scanEmbeddings", row._id);
    return !isDone;
  },
});

export const expire = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx) =>
    withErrorReporting("scanEmbeddings.expire", async () => {
      let more = true;
      while (more) more = await ctx.runMutation(internal.scanEmbeddings.expireBatch, {});
      return null;
    }),
});

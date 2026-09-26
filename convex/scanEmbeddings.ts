import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { withErrorReporting } from "./lib/observability";
import type { EmbeddingArchive } from "./lib/validators";
import { expireVectorArchiveIfUnreferenced, retainVectorArchive } from "./lib/vectorStore";

export const SCAN_VECTOR_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const EXPIRE_BATCH = 256;
const EXPIRE_BATCH_BYTES = 4 * 1024 * 1024;

export async function getEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings"> | undefined) {
  return id ? ctx.db.get("scanEmbeddings", id) : null;
}

// Device removal and expiry delete payloads while their scans remain.
export async function requireEmbedding(ctx: QueryCtx, id: Id<"scanEmbeddings"> | undefined): Promise<EmbeddingArchive> {
  const row = await getEmbedding(ctx, id);
  if (!row) throw new ConvexError({ code: "scan_not_found" });
  return { archiveId: row.archiveId, contentHash: row.contentHash };
}

export async function insertEmbedding(
  ctx: MutationCtx,
  archive: EmbeddingArchive,
  expiresAt?: number,
): Promise<Id<"scanEmbeddings">> {
  await retainVectorArchive(ctx, archive.archiveId, archive.contentHash);
  return ctx.db.insert("scanEmbeddings", { ...archive, expiresAt });
}

export function insertExpiringEmbedding(ctx: MutationCtx, archive: EmbeddingArchive): Promise<Id<"scanEmbeddings">> {
  return insertEmbedding(ctx, archive, Date.now() + SCAN_VECTOR_TTL_MS);
}

export async function deleteEmbedding(ctx: MutationCtx, id: Id<"scanEmbeddings"> | undefined): Promise<void> {
  const row = await getEmbedding(ctx, id);
  if (!row) return;
  await ctx.db.delete("scanEmbeddings", row._id);
  await expireVectorArchiveIfUnreferenced(ctx, row.archiveId);
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
    for (const row of page) await deleteEmbedding(ctx, row._id);
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

import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { validateVector } from "./modelVersion";
import { recognitionPartition } from "./recognitionEligibility";
import { queueVectorSync, searchRecordId } from "./vectorSyncQueue";

type VectorInput = Omit<Doc<"vectors">, "_id" | "_creationTime" | "embeddingId" | "contentHash"> & { vector: number[] };

function embeddingTable(ctx: QueryCtx, id: Doc<"vectors">["embeddingId"]) {
  return ctx.db.normalizeId("embeddings", id) ? "embeddings" : "tentativeEmbeddings";
}

export async function vectorHash(vector: number[]): Promise<string> {
  const bytes = new ArrayBuffer(vector.length * 8);
  const view = new DataView(bytes);
  vector.forEach((value, index) => view.setFloat64(index * 8, value, true));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readVector(ctx: QueryCtx, row: Doc<"vectors">): Promise<number[]> {
  const payload = await ctx.db.get(embeddingTable(ctx, row.embeddingId), row.embeddingId);
  if (!payload) throw new ConvexError({ code: "vector_payload_missing" });
  return payload.vector;
}

export async function insertVector(ctx: MutationCtx, input: VectorInput): Promise<Id<"vectors">> {
  const { vector, ...identity } = input;
  validateVector(vector);
  const table = input.partition === recognitionPartition(input.modelVersion) ? "embeddings" : "tentativeEmbeddings";
  const embeddingId = await ctx.db.insert(table, { vector, partition: input.partition });
  const fields = { ...identity, embeddingId, contentHash: await vectorHash(vector) };
  const id = await ctx.db.insert("vectors", fields);
  await queueVectorSync(ctx, { ...fields, _id: id }, "upsert");
  return id;
}

export async function replaceVector(ctx: MutationCtx, row: Doc<"vectors">, input: VectorInput): Promise<void> {
  const { vector, ...identity } = input;
  validateVector(vector);
  const contentHash = await vectorHash(vector);
  const table = input.partition === recognitionPartition(input.modelVersion) ? "embeddings" : "tentativeEmbeddings";
  let { embeddingId } = row;
  const currentTable = embeddingTable(ctx, embeddingId);
  if (currentTable !== table) {
    await ctx.db.delete(currentTable, embeddingId);
    embeddingId = await ctx.db.insert(table, { vector, partition: input.partition });
  } else if (row.contentHash !== contentHash || row.partition !== input.partition) {
    await ctx.db.replace(table, embeddingId, { vector, partition: input.partition });
  }
  const fields = { ...identity, embeddingId, contentHash };
  if (
    Object.entries(fields).some(([key, value]) => row[key as keyof typeof row] !== value)
    || Object.entries(row).some(
      ([key, value]) => key !== "_id" && key !== "_creationTime" && fields[key as keyof typeof fields] !== value,
    )
  ) {
    await ctx.db.replace("vectors", row._id, fields);
    if (searchRecordId(row) !== searchRecordId(fields)) {
      await queueVectorSync(ctx, row, "delete");
      await queueVectorSync(ctx, { ...fields, _id: row._id }, "upsert");
    }
  }
}

export async function deleteVector(ctx: MutationCtx, row: Doc<"vectors">): Promise<void> {
  await ctx.db.delete(embeddingTable(ctx, row.embeddingId), row.embeddingId);
  await ctx.db.delete("vectors", row._id);
  await queueVectorSync(ctx, row, "delete");
}

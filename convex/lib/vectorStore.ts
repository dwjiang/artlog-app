import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { recognitionPartition } from "./recognitionEligibility";

type VectorInput = Omit<Doc<"vectors">, "_id" | "_creationTime" | "embeddingId" | "contentHash"> & { vector: number[] };

export async function vectorHash(vector: number[]): Promise<string> {
  const bytes = new ArrayBuffer(vector.length * 8);
  const view = new DataView(bytes);
  vector.forEach((value, index) => view.setFloat64(index * 8, value, true));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readVector(ctx: QueryCtx, row: Doc<"vectors">): Promise<number[]> {
  const payload = await ctx.db.get(row.embeddingId);
  if (!payload) throw new ConvexError({ code: "vector_payload_missing" });
  return payload.vector;
}

export async function insertVector(ctx: MutationCtx, input: VectorInput): Promise<Id<"vectors">> {
  const { vector, ...identity } = input;
  const table = input.partition === recognitionPartition(input.modelVersion) ? "embeddings" : "tentativeEmbeddings";
  const embeddingId = await ctx.db.insert(table, { vector, partition: input.partition });
  return ctx.db.insert("vectors", { ...identity, embeddingId, contentHash: await vectorHash(vector) });
}

export async function replaceVector(ctx: MutationCtx, row: Doc<"vectors">, input: VectorInput): Promise<void> {
  const { vector, ...identity } = input;
  const contentHash = await vectorHash(vector);
  const table = input.partition === recognitionPartition(input.modelVersion) ? "embeddings" : "tentativeEmbeddings";
  let embeddingId = row.embeddingId;
  if (!ctx.db.normalizeId(table, embeddingId)) {
    await ctx.db.delete(embeddingId);
    embeddingId = await ctx.db.insert(table, { vector, partition: input.partition });
  } else if (row.contentHash !== contentHash || row.partition !== input.partition) {
    await ctx.db.replace(embeddingId, { vector, partition: input.partition });
  }
  const fields = { ...identity, embeddingId, contentHash };
  if (
    Object.entries(fields).some(([key, value]) => row[key as keyof typeof row] !== value)
    || Object.entries(row).some(
      ([key, value]) => key !== "_id" && key !== "_creationTime" && fields[key as keyof typeof fields] !== value,
    )
  ) {
    await ctx.db.replace(row._id, fields);
  }
}

export async function deleteVector(ctx: MutationCtx, row: Doc<"vectors">): Promise<void> {
  await ctx.db.delete(row.embeddingId);
  await ctx.db.delete(row._id);
}

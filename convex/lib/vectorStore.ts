import { ConvexError } from "convex/values";

import model from "../../shared/model/model-version.json";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { fileHash, fileStorage } from "./fileStorage";
import { validateVector } from "./modelVersion";
import type { EmbeddingArchive } from "./validators";
import { queueVectorSync, searchRecordId } from "./vectorSyncQueue";

type VectorInput = Omit<Doc<"vectors">, "_id" | "_creationTime" | "contentHash"> & { vector: number[] };
export const VECTOR_CONTENT_TYPE = "application/vnd.artlog.embedding";
// Longer than a Convex action's lifetime so readers of an earlier snapshot can finish.
export const VECTOR_ARCHIVE_GRACE_MS = 31 * 60_000;

export function packVector(vector: number[]): Blob {
  validateVector(vector);
  const bytes = new ArrayBuffer(vector.length * 8);
  const view = new DataView(bytes);
  vector.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return new Blob([bytes], { type: VECTOR_CONTENT_TYPE });
}

export async function vectorHash(vector: number[]): Promise<string> {
  return fileHash(packVector(vector));
}

export async function readVector(ctx: Pick<ActionCtx, "runQuery">, row: EmbeddingArchive): Promise<number[]> {
  const blob = await fileStorage.get(ctx, row.archiveId);
  if (!blob) throw new ConvexError({ code: "vector_archive_missing" });
  // Convex response blobs are single-use; buffer once for integrity checking and decoding.
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength !== model.embeddingDim * 8 || (await fileHash(new Blob([bytes]))) !== row.contentHash) {
    throw new ConvexError({ code: "vector_archive_invalid" });
  }
  const view = new DataView(bytes);
  const vector = Array.from({ length: model.embeddingDim }, (_, i) => view.getFloat64(i * 8, true));
  validateVector(vector);
  return vector;
}

export async function retainVectorArchive(
  ctx: MutationCtx,
  archiveId: Id<"files">,
  contentHash: string,
): Promise<void> {
  const file = await fileStorage.getMetadata(ctx, archiveId);
  if (
    !file
    || file.size !== model.embeddingDim * 8
    || file.sha256 !== contentHash
    || file.contentType !== VECTOR_CONTENT_TYPE
  ) {
    throw new ConvexError({ code: "vector_archive_invalid" });
  }
}

export async function expireVectorArchiveIfUnreferenced(ctx: MutationCtx, archiveId: Id<"files">): Promise<void> {
  const file = await fileStorage.getMetadata(ctx, archiveId);
  if (file?.refCount === 0) await ctx.db.patch("files", file._id, { expiresAt: Date.now() + VECTOR_ARCHIVE_GRACE_MS });
}

export async function insertVector(ctx: MutationCtx, input: VectorInput): Promise<Id<"vectors">> {
  const { vector, ...identity } = input;
  const contentHash = await vectorHash(vector);
  return insertArchivedVector(ctx, { ...identity, contentHash });
}

export async function insertArchivedVector(
  ctx: MutationCtx,
  fields: Omit<Doc<"vectors">, "_id" | "_creationTime">,
): Promise<Id<"vectors">> {
  await retainVectorArchive(ctx, fields.archiveId, fields.contentHash);
  const id = await ctx.db.insert("vectors", fields);
  await queueVectorSync(ctx, { ...fields, _id: id }, "upsert");
  return id;
}

export async function replaceVector(ctx: MutationCtx, row: Doc<"vectors">, input: VectorInput): Promise<void> {
  const { vector, ...identity } = input;
  const contentHash = await vectorHash(vector);
  const archiveId = row.contentHash === contentHash ? row.archiveId : identity.archiveId;
  if (archiveId !== row.archiveId) await retainVectorArchive(ctx, archiveId, contentHash);
  const fields = { ...identity, archiveId, contentHash };
  if (
    Object.entries(fields).some(([key, value]) => row[key as keyof typeof row] !== value)
    || Object.entries(row).some(
      ([key, value]) => key !== "_id" && key !== "_creationTime" && fields[key as keyof typeof fields] !== value,
    )
  ) {
    await ctx.db.replace("vectors", row._id, fields);
    if (searchRecordId(row) !== searchRecordId({ ...fields, _id: row._id })) {
      await queueVectorSync(ctx, row, "delete");
      await queueVectorSync(ctx, { ...fields, _id: row._id }, "upsert");
    }
    if (row.archiveId !== archiveId) await expireVectorArchiveIfUnreferenced(ctx, row.archiveId);
  }
  if (identity.archiveId !== archiveId) {
    await expireVectorArchiveIfUnreferenced(ctx, identity.archiveId);
  }
}

export async function deleteVector(ctx: MutationCtx, row: Doc<"vectors">): Promise<void> {
  await ctx.db.delete("vectors", row._id);
  await queueVectorSync(ctx, row, "delete");
  await expireVectorArchiveIfUnreferenced(ctx, row.archiveId);
}

export async function withVectorArchives<T>(
  ctx: Pick<ActionCtx, "runMutation">,
  vectors: { vector: number[]; archiveId?: Id<"files"> }[],
  commit: (archiveIds: Id<"files">[]) => Promise<T>,
): Promise<T> {
  const uploaded: Id<"files">[] = [];
  const archiveIds: Id<"files">[] = [];
  try {
    for (let start = 0; start < vectors.length; start += 8) {
      const results = await Promise.allSettled(
        vectors.slice(start, start + 8).map(async ({ vector, archiveId }) => {
          if (archiveId) return archiveId;
          const id = await fileStorage.store(ctx, packVector(vector));
          uploaded.push(id);
          return id;
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        archiveIds.push(result.value);
      }
    }
    return await commit(archiveIds);
  } finally {
    // A commit response can be lost after success; never discard a referenced archive.
    if (uploaded.length > 0) await ctx.runMutation(internal.vectorArchives.discard, { ids: uploaded });
  }
}

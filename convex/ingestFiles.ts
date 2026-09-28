import { ConvexError, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { DESCRIPTOR_BYTES, KEYPOINT_BYTES, MAX_KEYPOINTS } from "../shared/orb/features";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { fileStorage, reserveFile } from "./lib/fileStorage";
import { withErrorReporting } from "./lib/observability";
import { ORB_CONTENT_TYPE } from "./lib/orbStorage";
import { r2 } from "./lib/r2";
import { VECTOR_CONTENT_TYPE } from "./lib/vectorStore";
import schema from "./schema";

export const MAX_UPLOAD_BATCH = 100;
const VERIFICATION_CONCURRENCY = 32;
const upload = v.object({
  contentType: v.union(v.literal(VECTOR_CONTENT_TYPE), v.literal(ORB_CONTENT_TYPE)),
  size: v.number(),
  sha256: v.string(),
  md5: v.string(),
  existingId: v.optional(v.id("files")),
});
const ids = { ids: v.array(v.id("files")) };

function checkBatch(rows: unknown[]) {
  if (rows.length > MAX_UPLOAD_BATCH) throw new ConvexError({ code: "batch_too_large" });
}

function checkPending(file: Doc<"files"> | null): asserts file is Doc<"files"> {
  if (!file || file.state === "deleting" || (file.expiresAt ?? Infinity) <= Date.now()) {
    throw new ConvexError({ code: "file_missing" });
  }
  if (file.state === "pending" && (!file.sha256 || !file.uploadMd5 || file.uploadOwner)) {
    throw new ConvexError({ code: "invalid_import_file" });
  }
}

export const reserve = internalMutation({
  args: { rows: v.array(upload) },
  returns: v.array(schema.doc("files")),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const files: Doc<"files">[] = [];
    for (const row of rows) {
      const validSize =
        row.contentType === VECTOR_CONTENT_TYPE
          ? row.size === model.embeddingDim * 8
          : Number.isInteger(row.size)
            && row.size >= 0
            && row.size <= MAX_KEYPOINTS * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)
            && row.size % (DESCRIPTOR_BYTES + KEYPOINT_BYTES) === 0;
      if (!validSize || !/^[a-f0-9]{64}$/.test(row.sha256) || !/^[A-Za-z0-9+/]{22}==$/.test(row.md5)) {
        throw new ConvexError({ code: "invalid_import_file" });
      }
      const existing = row.existingId ? await fileStorage.getMetadata(ctx, row.existingId) : null;
      if (existing?.sha256 === row.sha256 && existing.size === row.size && existing.contentType === row.contentType) {
        files.push(existing);
        continue;
      }
      const id = await reserveFile(ctx, row.contentType, row.size);
      await ctx.db.patch("files", id, { sha256: row.sha256, uploadMd5: row.md5 });
      files.push((await ctx.db.get("files", id))!);
    }
    return files;
  },
});

export const prepare = internalAction({
  args: { rows: v.array(upload) },
  returns: v.array(v.object({ id: v.id("files"), url: v.union(v.string(), v.null()) })),
  handler: (ctx, args): Promise<{ id: Id<"files">; url: string | null }[]> =>
    withErrorReporting("ingestFiles.prepare", async () => {
      const files = await ctx.runMutation(internal.ingestFiles.reserve, args);
      return Promise.all(
        files.map(async (file) => ({
          id: file._id,
          url:
            file.state === "ready"
              ? null
              : await r2.uploadUrl(file._id, file.contentType, file.size, {
                  md5: file.uploadMd5!,
                  sha256: file.sha256!,
                }),
        })),
      );
    }),
});

export const pending = internalQuery({
  args: ids,
  returns: v.array(schema.doc("files")),
  handler: async (ctx, { ids }) => {
    checkBatch(ids);
    return Promise.all(
      ids.map(async (id) => {
        const file = await ctx.db.get("files", id);
        checkPending(file);
        return file;
      }),
    );
  },
});

export const markReady = internalMutation({
  args: ids,
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    checkBatch(ids);
    for (const id of ids) {
      const file = await ctx.db.get("files", id);
      checkPending(file);
      if (file.state === "pending") await ctx.db.patch("files", id, { state: "ready", uploadMd5: undefined });
    }
    return null;
  },
});

export const complete = internalAction({
  args: ids,
  returns: v.null(),
  handler: (ctx, args): Promise<null> =>
    withErrorReporting("ingestFiles.complete", async () => {
      const files = await ctx.runQuery(internal.ingestFiles.pending, args);
      for (let start = 0; start < files.length; start += VERIFICATION_CONCURRENCY) {
        await Promise.all(
          files.slice(start, start + VERIFICATION_CONCURRENCY).map(async (file) => {
            if (file.state === "ready") return;
            const stored = await r2.head(file._id);
            // Signed Content-MD5 binds the immutable body; signed SHA-256 metadata binds its archive identity.
            const md5 = Array.from(atob(file.uploadMd5!), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(
              "",
            );
            if (
              !stored
              || stored.size !== file.size
              || stored.contentType !== file.contentType
              || stored.etag !== md5
              || stored.sha256 !== file.sha256
            ) {
              throw new ConvexError({ code: "import_upload_mismatch" });
            }
          }),
        );
      }
      await ctx.runMutation(internal.ingestFiles.markReady, args);
      return null;
    }),
});

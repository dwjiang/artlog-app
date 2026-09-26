import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { env, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { withErrorReporting } from "./observability";
import { r2, UPLOAD_LIFETIME_SECONDS } from "./r2";

type Reader = Pick<QueryCtx, "db"> | Pick<ActionCtx, "runQuery">;
type Writer = MutationCtx | Pick<ActionCtx, "runMutation">;

export const FILE_LEASE_MS = 24 * 60 * 60 * 1000;

export async function fileHash(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function reserveFile(ctx: MutationCtx, contentType: string, size: number, uploadOwner?: Id<"devices">) {
  const key = crypto.randomUUID();
  await ctx.db.insert("files", {
    key,
    contentType,
    size,
    uploadOwner,
    state: "pending",
    publicDownload: false,
    expiresAt: Date.now() + FILE_LEASE_MS,
    deleteAttempts: 0,
  });
  return key;
}

export async function findFile(ctx: Pick<QueryCtx, "db">, key: string): Promise<Doc<"files"> | null> {
  return ctx.db
    .query("files")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export async function retainFile(ctx: MutationCtx, id: string, publicDownload = false) {
  const file = await fileStorage.getMetadata(ctx, id);
  if (!file) throw new ConvexError({ code: "file_missing" });
  await ctx.db.patch("files", file._id, {
    expiresAt: undefined,
    publicDownload: file.publicDownload || publicDownload,
  });
}

export async function queueFileDeletion(ctx: MutationCtx, id: string) {
  const file = await findFile(ctx, id);
  if (!file || file.state === "deleting") return;
  // A direct-upload URL can still be used until it expires. Delete only after that window.
  const delay = file.uploadOwner
    ? Math.max(0, file._creationTime + (UPLOAD_LIFETIME_SECONDS + 60) * 1000 - Date.now())
    : 0;
  await ctx.db.patch("files", file._id, {
    state: "deleting",
    publicDownload: false,
    expiresAt: Date.now() + delay + 60 * 60 * 1000,
  });
  await ctx.scheduler.runAfter(delay, internal.files.deleteRemote, { id });
}

export const fileStorage = {
  async getMetadata(ctx: Reader, id: string): Promise<Doc<"files"> | null> {
    const file = "db" in ctx ? await findFile(ctx, id) : await ctx.runQuery(internal.files.metadata, { id });
    return file?.state === "ready" ? file : null;
  },
  async store(ctx: Pick<ActionCtx, "runMutation">, blob: Blob): Promise<string> {
    return withErrorReporting("files.store", async () => {
      if (!blob.type) blob = new Blob([blob], { type: "application/octet-stream" });
      const id = await ctx.runMutation(internal.files.reserve, { contentType: blob.type, size: blob.size });
      try {
        await r2.put(id, blob);
        const sha256 = await fileHash(blob);
        await ctx.runMutation(internal.files.complete, { id, sha256 });
        return id;
      } catch (error) {
        await ctx.runMutation(internal.files.discard, { id });
        throw error;
      }
    });
  },
  async get(ctx: Reader, id: string): Promise<Blob | null> {
    const file = await fileStorage.getMetadata(ctx, id);
    if (!file) return null;
    return withErrorReporting("files.get", () => r2.get(file.key));
  },
  async getUrl(ctx: Reader, id: string): Promise<string | null> {
    const file = await fileStorage.getMetadata(ctx, id);
    if (!file?.publicDownload) return null;
    // Reactive query results may be cached longer than a signed URL's lifetime.
    return `${env.CONVEX_SITE_URL}/file?id=${encodeURIComponent(id)}`;
  },
  async delete(ctx: Writer, id: string): Promise<void> {
    if ("db" in ctx) await queueFileDeletion(ctx, id);
    else await ctx.runMutation(internal.files.discard, { id });
  },
};

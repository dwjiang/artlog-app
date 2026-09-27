import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { httpAction, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { fileStorage, findFile, queueFileDeletion, reserveFile } from "./lib/fileStorage";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { r2 } from "./lib/r2";
import schema from "./schema";

export const reserve = internalMutation({
  args: { contentType: v.string(), size: v.number() },
  returns: v.id("files"),
  handler: (ctx, args) => reserveFile(ctx, args.contentType, args.size),
});

export const metadata = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("files"), v.null()),
  handler: (ctx, { id }) => findFile(ctx, id),
});

export const complete = internalMutation({
  args: { id: v.string(), sha256: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, sha256 }) => {
    const file = await findFile(ctx, id);
    if (file?.state === "ready" && file.sha256 === sha256) return null;
    if (!file || file.state !== "pending" || (file.expiresAt ?? 0) <= Date.now()) {
      throw new ConvexError({ code: "file_missing" });
    }
    await ctx.db.patch("files", file._id, { state: "ready", sha256 });
    return null;
  },
});

export const discard = internalMutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await queueFileDeletion(ctx, id);
    return null;
  },
});

export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", Date.now()))
      .take(100);
    for (const file of files) {
      if (file.state === "deleting") {
        // Recover a deletion action terminated before it could schedule its retry.
        await ctx.db.patch("files", file._id, { expiresAt: Date.now() + 60 * 60 * 1000 });
        await ctx.scheduler.runAfter(0, internal.files.deleteRemote, { id: file._id });
      } else {
        await queueFileDeletion(ctx, file._id);
      }
    }
    if (files.length === 100) await ctx.scheduler.runAfter(0, internal.files.expire, {});
    return null;
  },
});

export const deletionResult = internalMutation({
  args: { id: v.string(), success: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, success }) => {
    const file = await findFile(ctx, id);
    if (!file || file.state !== "deleting") return null;
    if (success) {
      await ctx.db.delete("files", file._id);
    } else {
      const deleteAttempts = file.deleteAttempts + 1;
      const delay = Math.min(3600, 2 ** Math.min(deleteAttempts, 12)) * 1000;
      await ctx.db.patch("files", file._id, { deleteAttempts, expiresAt: Date.now() + delay + 60 * 60 * 1000 });
      await ctx.scheduler.runAfter(delay, internal.files.deleteRemote, { id });
    }
    return null;
  },
});

export const deleteRemote = internalAction({
  args: { id: v.string() },
  returns: v.null(),
  handler: (ctx, { id }) =>
    withErrorReporting("files.deleteRemote", async () => {
      const file = await ctx.runQuery(internal.files.metadata, { id });
      if (file?.state !== "deleting") return null;
      let success = false;
      try {
        await r2.remove(file._id);
        success = true;
      } catch (error) {
        await reportBackendError(error, "files.delete");
      }
      await ctx.runMutation(internal.files.deletionResult, { id, success });
      return null;
    }),
});

export const download = httpAction(async (ctx, request) => {
  const headers = { "Cache-Control": "no-store" };
  try {
    const raw = new URL(request.url).searchParams.get("id");
    const id = raw ? await ctx.runQuery(internal.files.downloadable, { id: raw }) : null;
    if (!id) return new Response(null, { status: 404, headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: await r2.downloadUrl(id) } });
  } catch (error) {
    await reportBackendError(error, "files.download");
    return new Response(null, { status: 503, headers });
  }
});

export const downloadable = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.id("files"), v.null()),
  handler: async (ctx, { id }) => {
    const file = await fileStorage.getMetadata(ctx, id);
    return file?.publicDownload ? file._id : null;
  },
});

import { ConvexError, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import { httpAction, internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { fileStorage, findFile, queueFileDeletion, reserveFile } from "./lib/fileStorage";
import { narrationCurrent, narrationEntry, narrationFiles } from "./lib/narrationCache";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { activeProfile } from "./lib/ownership";
import { r2 } from "./lib/r2";
import { eligibleContribution } from "./lib/recognitionEligibility";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

export const reserve = internalMutation({
  args: { contentType: v.string(), size: v.number() },
  returns: v.id("files"),
  handler: (ctx, args) => reserveFile(ctx, args.contentType, args.size),
});

export const metadata = internalQuery({
  args: { id: v.id("files") },
  returns: v.union(schema.doc("files"), v.null()),
  handler: (ctx, { id }) => findFile(ctx, id),
});

export const complete = internalMutation({
  args: { id: v.id("files"), sha256: v.string() },
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
  args: { id: v.id("files") },
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
  args: { id: v.id("files"), success: v.boolean() },
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
  args: { id: v.id("files") },
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
    const params = new URL(request.url).searchParams;
    const raw = params.get("id");
    const id = raw
      ? await ctx.runQuery(internal.files.downloadable, {
          id: raw,
          artworkId: params.get("artworkId") ?? undefined,
          render: params.get("render") ?? undefined,
          venueId: params.get("venueId") ?? undefined,
          version: params.get("version") ?? undefined,
        })
      : null;
    if (!id) return new Response(null, { status: 404, headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: await r2.downloadUrl(id) } });
  } catch (error) {
    await reportBackendError(error, "files.download");
    return new Response(null, { status: 503, headers });
  }
});

export const downloadable = internalQuery({
  args: {
    id: v.string(),
    artworkId: v.optional(v.string()),
    render: v.optional(v.string()),
    venueId: v.optional(v.string()),
    version: v.optional(v.string()),
  },
  returns: v.union(v.id("files"), v.null()),
  handler: async (ctx, { id, artworkId: rawArtworkId, render, venueId: rawVenueId, version }) => {
    const fileId = ctx.db.normalizeId("files", id);
    const file = fileId ? await fileStorage.getMetadata(ctx, fileId) : null;
    if (!file?.publicDownload) return null;
    if (file.contributionCrop) {
      for await (const contribution of ctx.db
        .query("contributions")
        .withIndex("by_cropStorageId", (q) => q.eq("cropStorageId", file._id))) {
        if (await eligibleContribution(ctx, contribution)) return file._id;
      }
      return null;
    }
    // Older file rows also need live source authorization; a retained public flag cannot grant access on its own.
    if (file.contentType === "audio/mpeg") {
      const artworkId = rawArtworkId ? ctx.db.normalizeId("artworks", rawArtworkId) : null;
      const artwork = artworkId ? await ctx.db.get("artworks", artworkId) : null;
      const entry = artworkId ? await narrationEntry(ctx, artworkId) : null;
      return artwork
        && entry?.claim
        && entry.claim === render
        && narrationCurrent(entry, artwork)
        && narrationFiles(entry).includes(file._id)
        ? file._id
        : null;
    }
    if (file.contentType === "application/json") {
      const venueId = rawVenueId ? ctx.db.normalizeId("museums", rawVenueId) : null;
      const venue = venueId ? await ctx.db.get("museums", venueId) : null;
      if (!venue || (await isVenueOptedOut(ctx, venue))) return null;
      const row = await ctx.db
        .query("museumDownloads")
        .withIndex("by_venue", (q) => q.eq("venueId", venue._id))
        .unique();
      const pack = row?.published;
      return pack?.count
        && pack.version === version
        && pack.modelVersion === model.modelVersion
        && pack.chunks.some((part) => part.storageId === file._id)
        ? file._id
        : null;
    }
    let profilePhoto = false;
    for await (const profile of ctx.db
      .query("profiles")
      .withIndex("by_photoStorageId", (q) => q.eq("photoStorageId", file._id))) {
      profilePhoto = true;
      if (await activeProfile(ctx, profile._id)) return file._id;
    }
    return profilePhoto ? null : file._id;
  },
});

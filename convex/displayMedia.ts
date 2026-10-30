import { ConvexError, v } from "convex/values";

import { catalogMedia, validateMedia, wallItemMediaContext } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { ownedAlbumPhoto } from "./lib/albumMedia";
import {
  contributionSource,
  isCurrentAsset,
  resolveDisplayAsset,
  revokeContributionMedia,
  revokeSaveMedia,
} from "./lib/displayMedia";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { reportBackendError, reportMissingStoredFile } from "./lib/observability";
import { requirePublicWallItem } from "./lib/publicationAccess";
import schema from "./schema";
import { serveSharedMedia } from "./sharedMedia";

export const registerCatalog = internalMutation({
  args: {
    saveId: v.id("collections"),
    objectId: v.id("objects"),
    source: catalogMedia,
    imageRightsEvidence: v.string(),
  },
  returns: v.id("mediaAssets"),
  handler: async (ctx, { saveId, objectId, source, imageRightsEvidence }) => {
    validateMedia(source);
    const save = await ctx.db.get("collections", saveId);
    const object = await ctx.db.get("objects", objectId);
    if (
      !imageRightsEvidence.trim()
      || imageRightsEvidence.length > 4096
      || !save
      || save.deletedAt !== undefined
      || !object
      || object.reverted
      || save.objectId !== objectId
    ) {
      throw new ConvexError({ code: "invalid_media" });
    }
    const provenance = {
      kind: "catalog" as const,
      objectId,
      imageRightsEvidence,
    };
    const existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_save_kind", (q) => q.eq("saveId", saveId).eq("source.kind", "catalog"))
      .unique();
    if (!existing) {
      return ctx.db.insert("mediaAssets", {
        saveId,
        source,
        provenance,
      });
    }
    // A save keeps one catalog row, so a changed source or evidence replaces it in place.
    const current = existing.source.kind === "catalog" ? existing.source : null;
    const same =
      current !== null
      && existing.revokedAt === undefined
      && existing.provenance.kind === "catalog"
      && existing.provenance.objectId === objectId
      && existing.provenance.imageRightsEvidence === imageRightsEvidence
      && (["url", "sourceUrl", "rights", "credit", "width", "height"] as const).every(
        (key) => current[key] === source[key],
      );
    if (!same) {
      await ctx.db.patch("mediaAssets", existing._id, {
        source,
        provenance,
        revokedAt: undefined,
      });
    }
    return existing._id;
  },
});

export const beginPreparation = internalMutation({
  args: { saveId: v.id("collections") },
  returns: v.union(schema.doc("mediaAssets"), v.null()),
  handler: async (ctx, { saveId }) => {
    const save = await ctx.db.get("collections", saveId);
    if (!save || save.deletedAt !== undefined || (await resolveDisplayAsset(ctx, save))) {
      return null;
    }
    const source = await contributionSource(ctx, save);
    if (!source) return null;
    const existing = await ctx.db
      .query("mediaAssets")
      .withIndex("by_save_kind", (q) => q.eq("saveId", saveId).eq("source.kind", "derivative"))
      .unique();
    if (existing) {
      return existing.revokedAt !== undefined
        || existing.storageId
        || existing.provenance.kind !== "contribution"
        || existing.provenance.contributionId !== source.contributionId
        || existing.provenance.sourceStorageId !== source.sourceStorageId
        ? null
        : existing;
    }
    const id = await ctx.db.insert("mediaAssets", {
      saveId,
      source: {
        kind: "derivative",
        rights: "contributor_consent",
        width: 1,
        height: 1,
      },
      provenance: { kind: "contribution", ...source },
    });
    return ctx.db.get("mediaAssets", id);
  },
});
export const attach = internalMutation({
  args: {
    assetId: v.id("mediaAssets"),
    storageId: v.id("files"),
    width: v.number(),
    height: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { assetId, storageId, width, height }) => {
    const asset = await ctx.db.get("mediaAssets", assetId);
    const save = asset ? await ctx.db.get("collections", asset.saveId) : null;
    const source = save ? await contributionSource(ctx, save) : null;
    if (
      !asset
      || asset.revokedAt !== undefined
      || asset.source.kind !== "derivative"
      || asset.provenance.kind !== "contribution"
      || !source
      || source.contributionId !== asset.provenance.contributionId
      || source.sourceStorageId !== asset.provenance.sourceStorageId
    ) {
      return false;
    }
    if (asset.storageId) return asset.storageId === storageId;
    if (storageId === source.sourceStorageId || !(await fileStorage.getMetadata(ctx, storageId))) {
      return false;
    }
    const metadata = { ...asset.source, width, height };
    validateMedia(metadata);
    await retainFile(ctx, storageId);
    await ctx.db.patch("mediaAssets", assetId, { source: metadata, storageId });
    return true;
  },
});
export const discard = internalMutation({
  args: { storageId: v.id("files") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    await fileStorage.delete(ctx, storageId);
    return null;
  },
});
export const revokeSave = internalMutation({
  args: { saveId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, { saveId }) => {
    await revokeSaveMedia(ctx, saveId);
    return null;
  },
});
export const revokeContribution = internalMutation({
  args: { contributionId: v.id("contributions") },
  returns: v.null(),
  handler: async (ctx, { contributionId }) => {
    await revokeContributionMedia(ctx, contributionId);
    return null;
  },
});
export const findForWallItem = internalQuery({
  args: { context: wallItemMediaContext },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { context }) => {
    const { item, save } = await requirePublicWallItem(ctx, context.itemId);
    if (context.photoLocalId) {
      if (context.photoLocalId !== item.photoLocalId) {
        throw new ConvexError({ code: "not_found" });
      }
      const photo = await ownedAlbumPhoto(ctx, save, context.photoLocalId);
      if (context.variant === "crop") {
        if (save.cropPhotoLocalId !== photo.localId || context.cropRevision !== save.photoUpdatedAt) {
          throw new ConvexError({ code: "not_found" });
        }
        return save.cropStorageId ?? null;
      }
      if (context.cropRevision !== undefined) throw new ConvexError({ code: "not_found" });
      return photo.storageId ?? null;
    }
    if (context.variant || context.cropRevision !== undefined) throw new ConvexError({ code: "not_found" });
    const asset = await resolveDisplayAsset(ctx, save);
    return asset?.source.kind === "derivative" && (await isCurrentAsset(ctx, save, asset))
      ? (asset.storageId ?? null)
      : null;
  },
});
const PARAMS = {
  wallItem: ["itemId"],
  sharedVisit: ["itemId", "postId"],
} as const;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export const download = httpAction(async (ctx, request) => {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const keys: readonly string[] | null =
      kind && Object.hasOwn(PARAMS, kind) ? PARAMS[kind as keyof typeof PARAMS] : null;
    if (
      !keys
      || [...params.keys()].some(
        (key) =>
          key !== "kind"
          && key !== "photoLocalId"
          && !(kind === "wallItem" && (key === "variant" || key === "cropRevision"))
          && !(kind === "sharedVisit" && key === "size")
          && !keys.includes(key),
      )
      || keys.some((key) => !params.get(key))
      || (params.has("size") && params.get("size") !== "feed")
    ) {
      throw new ConvexError({ code: "invalid_media" });
    }
    const cropRevision = params.has("cropRevision") ? Number(params.get("cropRevision")) : undefined;
    if (cropRevision !== undefined && (!Number.isSafeInteger(cropRevision) || cropRevision <= 0)) {
      throw new ConvexError({ code: "invalid_media" });
    }
    // The internal queries validate table-specific IDs before any lookup.
    const context = {
      kind,
      ...Object.fromEntries(keys.map((key) => [key, params.get(key)!])),
      ...(params.get("photoLocalId") ? { photoLocalId: params.get("photoLocalId") } : {}),
      ...(params.get("variant") ? { variant: params.get("variant") } : {}),
      ...(cropRevision !== undefined ? { cropRevision } : {}),
    } as never;
    if (kind !== "wallItem") return await serveSharedMedia(ctx, context, params.has("size") ? "feed" : undefined);
    const storageId = await ctx.runQuery(internal.displayMedia.findForWallItem, { context });
    const blob = storageId ? await fileStorage.get(ctx, storageId) : null;
    const current = (await ctx.runQuery(internal.displayMedia.findForWallItem, { context })) === storageId;
    if (!blob || !current) {
      if (storageId && !blob && current) await reportMissingStoredFile("displayMedia.download", "wallItem");
      throw new ConvexError({ code: "not_found" });
    }
    return new Response(blob, {
      headers: { ...headers, "Content-Type": "image/jpeg" },
    });
  } catch (error) {
    // Malformed IDs are caller validation failures; retain the same non-disclosing response.
    if (!(error instanceof Error && error.message.includes("ArgumentValidationError"))) {
      await reportBackendError(error, "displayMedia.download");
    }
    return new Response("Image unavailable", { status: 404, headers });
  }
});

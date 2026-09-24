import { ownedAlbumPhoto } from "./lib/albumMedia";
import { ConvexError, v } from "convex/values";
import { reportBackendError } from "./lib/observability";
import { catalogMedia, validateMedia, wallItemMediaContext } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import {
  contributionSource,
  isCurrentAsset,
  resolveDisplayAsset,
  revokeContributionMedia,
  revokeSaveMedia,
} from "./lib/displayMedia";
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
    const save = await ctx.db.get(saveId);
    const object = await ctx.db.get(objectId);
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
        createdAt: Date.now(),
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
      await ctx.db.patch(existing._id, {
        source,
        provenance,
        createdAt: Date.now(),
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
    const save = await ctx.db.get(saveId);
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
      createdAt: Date.now(),
    });
    return ctx.db.get(id);
  },
});
export const attach = internalMutation({
  args: {
    assetId: v.id("mediaAssets"),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { assetId, storageId, width, height }) => {
    const asset = await ctx.db.get(assetId);
    const save = asset ? await ctx.db.get(asset.saveId) : null;
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
    if (storageId === source.sourceStorageId || !(await ctx.db.system.get(storageId))) {
      return false;
    }
    const metadata = { ...asset.source, width, height };
    validateMedia(metadata);
    await ctx.db.patch(assetId, { source: metadata, storageId });
    return true;
  },
});
export const discard = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const reference = await ctx.db
      .query("mediaAssets")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first();
    if (!reference && (await ctx.db.system.get(storageId))) {
      await ctx.storage.delete(storageId);
    }
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
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, { context }) => {
    const { item, save } = await requirePublicWallItem(ctx, context.itemId);
    if (context.photoLocalId) {
      if (context.photoLocalId !== item.photoLocalId) {
        throw new ConvexError({ code: "not_found" });
      }
      return (await ownedAlbumPhoto(ctx, save, context.photoLocalId)).storageId ?? null;
    }
    const asset = await resolveDisplayAsset(ctx, save);
    return asset?.source.kind === "derivative" && (await isCurrentAsset(ctx, save, asset))
      ? (asset.storageId ?? null)
      : null;
  },
});
const PARAMS = {
  wallItem: ["itemId"],
  sharedVisit: ["itemId", "postId"],
  sharedVisitPreview: ["visitLocalId", "saveLocalId"],
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
      || [...params.keys()].some((key) => key !== "kind" && key !== "photoLocalId" && !keys.includes(key))
      || keys.some((key) => !params.get(key))
    ) {
      throw new ConvexError({ code: "invalid_media" });
    }
    // The internal queries validate table-specific IDs before any lookup.
    const context = {
      kind,
      ...Object.fromEntries(keys.map((key) => [key, params.get(key)!])),
      ...(params.get("photoLocalId") ? { photoLocalId: params.get("photoLocalId") } : {}),
    } as never;
    if (kind !== "wallItem") return await serveSharedMedia(ctx, context);
    const storageId = await ctx.runQuery(internal.displayMedia.findForWallItem, { context });
    const blob = storageId ? await ctx.storage.get(storageId) : null;
    if (
      !blob
      || (await ctx.runQuery(internal.displayMedia.findForWallItem, {
        context,
      })) !== storageId
    ) {
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

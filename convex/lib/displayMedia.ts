import { validateMedia } from "../../shared/social/contracts";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { eligibleContribution, eligibleObject } from "./recognitionEligibility";

export async function contributionSource(ctx: QueryCtx, save: Doc<"collections">) {
  if (
    save.deletedAt !== undefined
    || !save.scanId
    || (save.owner.kind === "account" && !(await ctx.db.get("accounts", save.owner.accountId)))
  ) {
    return null;
  }
  // The contribution submission is the consent boundary; journal/owner photos are never sources. saveToCollection
  // only links scans made by the saving device, so the device's current account link is not rechecked here:
  // signing out must not unpublish media.
  const scan = await ctx.db.get("scans", save.scanId);
  const contribution = scan
    ? await ctx.db
        .query("contributions")
        .withIndex("by_scanId", (q) => q.eq("scanId", scan._id))
        .unique()
    : null;
  if (
    !scan
    || !contribution
    || !(await eligibleContribution(ctx, contribution))
    || contribution.deviceId !== scan.deviceId
    || contribution.status === "rejected"
    || contribution.displayMediaRevokedAt !== undefined
    || !contribution.cropStorageId
    || !(await ctx.db.system.get(contribution.cropStorageId))
  ) {
    return null;
  }
  return {
    contributionId: contribution._id,
    sourceStorageId: contribution.cropStorageId,
  };
}

export async function isCurrentAsset(
  ctx: QueryCtx,
  save: Doc<"collections">,
  asset: Doc<"mediaAssets">,
): Promise<boolean> {
  if (save.deletedAt !== undefined || asset.saveId !== save._id || asset.revokedAt !== undefined) {
    return false;
  }
  try {
    validateMedia(asset.source);
  } catch {
    return false;
  }
  if (asset.source.kind === "catalog") {
    if (asset.provenance.kind !== "catalog" || save.objectId !== asset.provenance.objectId) {
      return false;
    }
    const object = await ctx.db.get("objects", asset.provenance.objectId);
    const artwork = object ? await ctx.db.get("artworks", object.artworkId) : null;
    const venue = object?.ownerId ? await ctx.db.get("museums", object.ownerId) : null;
    return (
      !!object
      && (await eligibleObject(ctx, object, object.ownerId))
      && !object.reverted
      && !object.mergedInto
      && !!artwork
      && (!object.ownerId || (!!venue && !venue.optOut))
      && (!save.artworkId || save.artworkId === artwork._id)
    );
  }
  if (
    asset.provenance.kind !== "contribution"
    || !asset.storageId
    || asset.storageId === asset.provenance.sourceStorageId
    || !(await ctx.db.system.get(asset.storageId))
  ) {
    return false;
  }
  const source = await contributionSource(ctx, save);
  return (
    source?.contributionId === asset.provenance.contributionId
    && source?.sourceStorageId === asset.provenance.sourceStorageId
  );
}

export async function resolveDisplayAsset(ctx: QueryCtx, save: Doc<"collections">) {
  for (const kind of ["catalog", "derivative"] as const) {
    const asset = await ctx.db
      .query("mediaAssets")
      .withIndex("by_save_kind", (q) => q.eq("saveId", save._id).eq("source.kind", kind))
      .order("desc")
      .first();
    if (asset && (await isCurrentAsset(ctx, save, asset))) return asset;
  }
  return null;
}

export async function revokeAsset(ctx: MutationCtx, asset: Doc<"mediaAssets">) {
  await ctx.db.patch("mediaAssets", asset._id, {
    revokedAt: asset.revokedAt ?? Date.now(),
    storageId: undefined,
  });
  if (asset.storageId && (await ctx.db.system.get(asset.storageId))) {
    await ctx.storage.delete(asset.storageId);
  }
}
export async function revokeSaveMedia(ctx: MutationCtx, saveId: Id<"collections">) {
  const assets = await ctx.db
    .query("mediaAssets")
    .withIndex("by_save_kind", (q) => q.eq("saveId", saveId))
    .take(2);
  for (const asset of assets) await revokeAsset(ctx, asset);
}

export async function revokeContributionMedia(ctx: MutationCtx, contributionId: Id<"contributions">): Promise<void> {
  const contribution = await ctx.db.get("contributions", contributionId);
  if (contribution && contribution.displayMediaRevokedAt === undefined) {
    await ctx.db.patch("contributions", contributionId, { displayMediaRevokedAt: Date.now() });
  }
  const assets = await ctx.db
    .query("mediaAssets")
    .withIndex("by_contribution_revoked", (q) =>
      q.eq("provenance.contributionId", contributionId).eq("revokedAt", undefined),
    )
    .take(50);
  for (const asset of assets) await revokeAsset(ctx, asset);
  if (assets.length === 50) {
    await ctx.scheduler.runAfter(0, internal.displayMedia.revokeContribution, {
      contributionId,
    });
  }
}

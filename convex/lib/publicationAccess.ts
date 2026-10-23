import { ConvexError } from "convex/values";

import { sameOwner } from "../../shared/journal/contracts";
import { LIMITS } from "../../shared/journal/limits";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { deleteUnreferencedAlbumPhoto, deleteUnreferencedCollectionPhotos } from "./collectionPhotos";
import { revokeSaveMedia } from "./displayMedia";
import { relationshipSnapshot } from "./friendships";
import { activeProfile, nextChangeVersion, requireMembership } from "./ownership";
import { advancePublicationRevision } from "./publicationUpdates";
import { deleteSavedRecognition } from "./savedRecognition";
import { deactivateWallItem } from "./wallItems";

type ReadCtx = QueryCtx | MutationCtx;
export async function invalidateWallSave(ctx: MutationCtx, saveId: Id<"collections">): Promise<void> {
  const items = await ctx.db
    .query("wallItems")
    .withIndex("by_save_active", (q) => q.eq("saveId", saveId).eq("active", true))
    .take(LIMITS.wallItems + 1);
  for (const item of items) await deactivateWallItem(ctx, item);
}
export async function invalidateDeletedSave(ctx: MutationCtx, save: Doc<"collections">): Promise<void> {
  await deleteSavedRecognition(ctx, save._id);
  await invalidateWallSave(ctx, save._id);
  const photos = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
    .take(101);
  const encounters = await ctx.db
    .query("artworkEncounters")
    .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
    .take(101);
  const tombstone = async () => ({
    deletedAt: save.deletedAt ?? Date.now(),
    updatedAt: Date.now(),
    changeVersion: await nextChangeVersion(ctx, save.owner),
  });
  for (const photo of photos) await ctx.db.patch("artworkPhotos", photo._id, await tombstone());
  for (const encounter of encounters) await ctx.db.patch("artworkEncounters", encounter._id, await tombstone());
  for (const photo of photos) await deleteUnreferencedAlbumPhoto(ctx, photo);
  const selections = await ctx.db
    .query("sharedVisitItems")
    .withIndex("by_saveId", (q) => q.eq("saveId", save._id))
    .take(101);
  for (const item of selections) {
    await ctx.db.delete("sharedVisitItems", item._id);
    const publication = await ctx.db.get("sharedVisits", item.publicationId);
    if (publication) await advancePublicationRevision(ctx, publication);
  }
  await revokeSaveMedia(ctx, save._id);
  await deleteUnreferencedCollectionPhotos(ctx, save);
}
export async function requirePublicWallItem(ctx: ReadCtx, itemId: Id<"wallItems">) {
  const item = await ctx.db.get("wallItems", itemId);
  const profile = item ? await activeProfile(ctx, item.profileId) : null;
  const save = item ? await ctx.db.get("collections", item.saveId) : null;
  const wall = item ? await ctx.db.get("walls", item.wallId) : null;
  if (
    !wall
    || wall.profileId !== item?.profileId
    || item?.saveLocalId !== save?.localId
    || !item?.active
    || item.removal
    || !profile
    || !save
    || save.deletedAt !== undefined
    || !sameOwner(save.owner, { kind: "account", accountId: profile.accountId })
  ) {
    throw new ConvexError({ code: "not_found" });
  }
  return { item, profile, save };
}
export async function readablePublication(ctx: ReadCtx, publication: Doc<"sharedVisits">, viewerId?: Id<"profiles">) {
  if (publication.status !== "active" || publication.removal) return null;
  const visit = await ctx.db.get("visits", publication.visitId);
  const own = viewerId === publication.profileId;
  if (!visit || (visit.visibility === "private" && !own) || (visit.visibility === "friends" && !viewerId)) return null;
  if (viewerId && !own) {
    const { edge, block, reverseBlock } = await relationshipSnapshot(ctx, publication.profileId, viewerId);
    if (block?.active || reverseBlock?.active) return null;
    if (visit.visibility === "friends" && edge?.state !== "accepted") return null;
  }
  const profile = await activeProfile(ctx, publication.profileId);
  if (
    !profile
    || visit.localId !== publication.visitLocalId
    || !sameOwner(visit.owner, {
      kind: "account",
      accountId: profile.accountId,
    })
  ) {
    return null;
  }
  return { publication, profile, visit };
}
export async function requireSharedVisit(ctx: ReadCtx, postId: string, viewerId?: Id<"profiles">) {
  const publication = await ctx.db
    .query("sharedVisits")
    .withIndex("by_postId", (q) => q.eq("postId", postId))
    .unique();
  const access = publication && (await readablePublication(ctx, publication, viewerId));
  if (!access) throw new ConvexError({ code: "not_found" });
  return access;
}
export async function requireSharedVisitItem(
  ctx: ReadCtx,
  postId: string,
  itemId: Id<"sharedVisitItems">,
  viewerId?: Id<"profiles">,
) {
  const { publication, visit } = await requireSharedVisit(ctx, postId, viewerId);
  const item = await ctx.db.get("sharedVisitItems", itemId);
  const save = item ? await ctx.db.get("collections", item.saveId) : null;
  if (
    !item
    || item.publicationId !== publication._id
    || item.saveLocalId !== save?.localId
    || !save
    || save.deletedAt !== undefined
  ) {
    throw new ConvexError({ code: "not_found" });
  }
  await requireMembership(ctx, save, visit);
  return { publication, item, save };
}

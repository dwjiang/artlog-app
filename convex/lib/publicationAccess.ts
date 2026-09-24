import { ConvexError } from "convex/values";
import { sameOwner } from "../../shared/journal/contracts";
import { LIMITS } from "../../shared/journal/limits";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { deleteUnreferencedCollectionPhotos, deleteUnreferencedPhoto } from "./collectionPhotos";
import { activeProfile, nextChangeVersion, requireMembership } from "./ownership";
import { relationshipSnapshot } from "./friendships";
import { revokeSaveMedia } from "./displayMedia";

type ReadCtx = QueryCtx | MutationCtx;
export async function clearEmptyNoteVisibility(ctx: MutationCtx, saveId: Id<"collections">): Promise<void> {
  const save = await ctx.db.get(saveId);
  if (!save || save.note?.trim()) return;
  const items = await ctx.db
    .query("wallItems")
    .withIndex("by_save_active", (q) => q.eq("saveId", saveId).eq("active", true))
    .take(LIMITS.wallItems + 1);
  for (const item of items) {
    if (item.noteResetVersion !== save.changeVersion) {
      await ctx.db.patch(item._id, {
        noteVisible: false,
        noteRevision: item.noteRevision + 1,
        noteResetVersion: save.changeVersion,
      });
    }
  }
}
export async function invalidateWallSave(ctx: MutationCtx, saveId: Id<"collections">): Promise<void> {
  const items = await ctx.db
    .query("wallItems")
    .withIndex("by_save_active", (q) => q.eq("saveId", saveId).eq("active", true))
    .take(LIMITS.wallItems + 1);
  for (const item of items) {
    if (!item.active && !item.noteVisible) continue;
    await ctx.db.patch(item._id, {
      active: false,
      noteVisible: false,
      noteRevision: item.noteRevision + 1,
    });
    const wall = await ctx.db.get(item.wallId);
    if (wall) {
      await ctx.db.patch(wall._id, { layoutRevision: wall.layoutRevision + 1 });
    }
    const profile = await ctx.db.get(item.profileId);
    if (profile && item.active) {
      await ctx.db.patch(profile._id, {
        publishedWallCount: Math.max(0, profile.publishedWallCount - 1),
      });
    }
  }
}
export async function invalidateDeletedSave(ctx: MutationCtx, save: Doc<"collections">): Promise<void> {
  await invalidateWallSave(ctx, save._id);
  const photos = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
    .take(101);
  const encounters = await ctx.db
    .query("artworkEncounters")
    .withIndex("by_save_deletedAt", (q) => q.eq("saveId", save._id).eq("deletedAt", undefined))
    .take(101);
  for (const child of [...photos, ...encounters]) {
    await ctx.db.patch(child._id, {
      deletedAt: save.deletedAt ?? Date.now(),
      updatedAt: Date.now(),
      changeVersion: await nextChangeVersion(ctx, save.owner),
    });
  }
  for (const photo of photos) {
    if (photo.storageId) await deleteUnreferencedPhoto(ctx, photo.storageId);
  }
  const selections = await ctx.db
    .query("sharedVisitItems")
    .withIndex("by_saveId", (q) => q.eq("saveId", save._id))
    .take(101);
  for (const item of selections) {
    await ctx.db.delete(item._id);
    const publication = await ctx.db.get(item.publicationId);
    if (publication) {
      await ctx.db.patch(publication._id, {
        publicationRevision: publication.publicationRevision + 1,
        updatedAt: Date.now(),
      });
    }
  }
  await revokeSaveMedia(ctx, save._id);
  await deleteUnreferencedCollectionPhotos(ctx, save);
}
export async function requirePublicWallItem(ctx: ReadCtx, itemId: Id<"wallItems">) {
  const item = await ctx.db.get(itemId);
  const profile = item ? await activeProfile(ctx, item.profileId) : null;
  const save = item ? await ctx.db.get(item.saveId) : null;
  const wall = item ? await ctx.db.get(item.wallId) : null;
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
  if (viewerId && viewerId !== publication.profileId) {
    const { block, reverseBlock } = await relationshipSnapshot(ctx, publication.profileId, viewerId);
    if (block?.active || reverseBlock?.active) return null;
  }
  const profile = await activeProfile(ctx, publication.profileId);
  const visit = await ctx.db.get(publication.visitId);
  if (
    !profile
    || !visit
    || visit.visibility !== "public"
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
  const item = await ctx.db.get(itemId);
  const save = item ? await ctx.db.get(item.saveId) : null;
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

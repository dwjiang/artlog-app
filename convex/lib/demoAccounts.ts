import { ConvexError, type Infer, v } from "convex/values";

import { validateAlbumPhoto } from "../../shared/collection/album";
import { randomWallStyle } from "../../shared/wall/defaults";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { upsertJournalSave } from "./journal";
import { resolveMentions } from "./mentions";
import { activeProfile, nextChangeVersion } from "./ownership";
import { readablePublication } from "./publicationAccess";

type DemoOwner = { kind: "account"; accountId: Id<"accounts"> };

// Demo people are ordinary accounts that no sign-in can reach: real Apple subjects never start with this prefix.
const DEMO_PREFIX = "demo:";
export const demoProviderUserId = (username: string) => `${DEMO_PREFIX}${username}`;
export const demoAccountRange = (ctx: QueryCtx) =>
  ctx.db
    .query("accounts")
    .withIndex("by_provider_userId", (q) =>
      q.eq("provider", "apple").gte("providerUserId", DEMO_PREFIX).lt("providerUserId", "demo;"),
    );
const isDemoAccount = (account: Doc<"accounts"> | null) =>
  account?.provider === "apple" && account.providerUserId.startsWith(DEMO_PREFIX);

/** The active profile of a demo account, or null for anyone else. */
export async function demoPerson(ctx: QueryCtx, profileId: Id<"profiles">) {
  const profile = await activeProfile(ctx, profileId);
  return profile && isDemoAccount(await ctx.db.get("accounts", profile.accountId)) ? profile : null;
}
export async function demoProfile(ctx: QueryCtx, username: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
  const person = profile && (await demoPerson(ctx, profile._id));
  if (!person) throw new ConvexError({ code: "not_found", username });
  return person;
}
export async function readableBy(ctx: QueryCtx, username: string, postId: string) {
  const profile = await demoProfile(ctx, username);
  const publication = await ctx.db
    .query("sharedVisits")
    .withIndex("by_postId", (q) => q.eq("postId", postId))
    .unique();
  const access = publication && (await readablePublication(ctx, publication, profile._id));
  if (!access) throw new ConvexError({ code: "not_found", username, postId });
  return { profile, publication: access.publication, author: access.profile };
}

export const isUsableObject = (object: Doc<"objects">) =>
  !object.reverted && !object.mergedInto && object.identityStatus === "established";
export async function usableObject(ctx: QueryCtx, key: string) {
  const object = await ctx.db
    .query("objects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return object && isUsableObject(object) ? object : null;
}
export function venueByKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("museums")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export const demoPhoto = v.object({
  localId: v.string(),
  storageId: v.id("files"),
  width: v.number(),
  height: v.number(),
  capturedAt: v.number(),
});
export const demoSave = v.object({
  localId: v.string(),
  objectKey: v.string(),
  savedAt: v.number(),
  photos: v.array(demoPhoto),
  // A crop of the first photo, as the scan flow stores it.
  crop: v.optional(v.object({ storageId: v.id("files"), width: v.number(), height: v.number() })),
});

/** Saves a work the venue owns on a demo visit, with the catalog snapshot and photos the scan flow would record. */
export async function addDemoSave(
  ctx: MutationCtx,
  owner: DemoOwner,
  deviceId: Id<"devices">,
  visit: Doc<"visits">,
  venue: Doc<"museums">,
  save: Infer<typeof demoSave>,
) {
  const object = await usableObject(ctx, save.objectKey);
  const artwork = object && (await ctx.db.get("artworks", object.artworkId));
  if (!object || !artwork || object.ownerId !== venue._id) {
    throw new ConvexError({ code: "invalid_object", objectKey: save.objectKey });
  }
  const details = object.detailsId ? await ctx.db.get("objectDetails", object.detailsId) : null;
  const placement = (
    await ctx.db
      .query("placements")
      .withIndex("by_objectId", (q) => q.eq("objectId", object._id))
      .take(20)
  ).find((row) => row.venueId === venue._id && row.closedAt === undefined);
  const row = await upsertJournalSave(ctx, owner, deviceId, {
    localId: save.localId,
    visitLocalId: visit.localId,
    venueId: venue._id,
    venueName: venue.name,
    gallery: placement?.gallery,
    savedAt: save.savedAt,
    snapshot: {
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      medium: details?.medium,
      institution: venue.name,
    },
    objectId: object._id,
    artworkId: artwork._id,
  });
  await ctx.db.patch("collections", row._id, { confirmationRecorded: true });
  for (const photo of save.photos) {
    const fields = {
      localId: photo.localId,
      savedLocalId: row.localId,
      kind: "full" as const,
      capturedAt: photo.capturedAt,
      visitLocalId: visit.localId,
    };
    validateAlbumPhoto(fields);
    await ctx.db.insert("artworkPhotos", {
      ...fields,
      owner,
      saveId: row._id,
      storageId: photo.storageId,
      width: photo.width,
      height: photo.height,
      updatedAt: photo.capturedAt,
      changeVersion: await nextChangeVersion(ctx, owner),
    });
  }
  if (save.crop && save.photos[0]) {
    await ctx.db.patch("collections", row._id, {
      cropStorageId: save.crop.storageId,
      cropPhotoLocalId: save.photos[0].localId,
      cropWidth: save.crop.width,
      cropHeight: save.crop.height,
      photoUpdatedAt: save.savedAt,
      changeVersion: await nextChangeVersion(ctx, owner),
    });
  }
  return { row, photoLocalIds: save.photos.map((photo) => photo.localId) };
}

/** Shares a demo visit with every save on it, in order, as the share flow publishes a visit. Never names companions. */
export async function insertDemoPost(
  ctx: MutationCtx,
  post: {
    profileId: Id<"profiles">;
    visit: Doc<"visits">;
    saves: Awaited<ReturnType<typeof addDemoSave>>[];
    postId: string;
    publishedAt: number;
  },
) {
  const { visit } = post;
  if (visit.visibility === "private") throw new ConvexError({ code: "invalid_post" });
  const reflection = visit.reflection ?? "";
  const mentions = await resolveMentions(ctx, reflection, post.profileId);
  const publicationId = await ctx.db.insert("sharedVisits", {
    postId: post.postId,
    profileId: post.profileId,
    visitId: visit._id,
    visitLocalId: visit.localId,
    visitedOn: visit.visitedOn,
    status: "active",
    audience: visit.visibility,
    reflection,
    ...(mentions.length > 0 ? { mentions } : {}),
    publishedAt: post.publishedAt,
    updatedAt: post.publishedAt,
    publicationRevision: 1,
    ...randomWallStyle(),
  });
  for (const [position, { row, photoLocalIds }] of post.saves.entries()) {
    await ctx.db.insert("sharedVisitItems", {
      publicationId,
      saveId: row._id,
      saveLocalId: row.localId,
      position,
      ...(photoLocalIds.length > 0 ? { photoLocalIds } : {}),
      highlighted: position < 3,
    });
  }
}

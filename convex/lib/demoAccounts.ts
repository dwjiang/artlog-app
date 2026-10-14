import { ConvexError, type Infer, type ObjectType, v } from "convex/values";

import { validateAlbumPhoto } from "../../shared/collection/album";
import { journalVisit } from "../../shared/journal/contracts";
import { isUuid, normalizeSearch } from "../../shared/journal/limits";
import { avatarId } from "../../shared/social/avatars";
import { validateProfile, validateWallItems, wallLayout, wallPattern } from "../../shared/social/contracts";
import type { leaderboardVisibility } from "../../shared/social/leaderboard";
import { randomWallStyle } from "../../shared/wall/defaults";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { upsertJournalSave, upsertJournalVisit } from "./journal";
import { resolveMentions } from "./mentions";
import { activeProfile, findOwnedSave, nextChangeVersion } from "./ownership";
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

/** Shares a demo visit with every save on it, in order, as the share flow publishes a visit. Uses the normal companion and mention projections. */
export async function insertDemoPost(
  ctx: MutationCtx,
  post: {
    profileId: Id<"profiles">;
    visit: Doc<"visits">;
    saves: Awaited<ReturnType<typeof addDemoSave>>[];
    postId: string;
    publishedAt: number;
    companionSelections?: Doc<"sharedVisits">["companionSelections"];
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
    ...(post.companionSelections?.length ? { companionSelections: post.companionSelections } : {}),
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

const { venueId: _venueId, ...visitFields } = journalVisit.fields;
const demoVisit = v.object({
  ...visitFields,
  venueKey: v.string(),
  saves: v.array(demoSave),
  post: v.optional(v.object({ postId: v.string(), publishedAt: v.number() })),
});
const demoWall = v.object({
  color: v.string(),
  pattern: v.optional(wallPattern),
  items: v.array(
    v.object({
      placementId: v.string(),
      saveLocalId: v.string(),
      photoLocalId: v.optional(v.string()),
      layout: wallLayout,
    }),
  ),
});
export const demoPersonArgs = {
  username: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  avatar: avatarId,
  visits: v.array(demoVisit),
  wall: v.optional(demoWall),
};
type DemoPersonInput = ObjectType<typeof demoPersonArgs> & {
  leaderboardVisibility: Infer<typeof leaderboardVisibility>;
  joinedAt: number;
};

/** Inserts an account no sign-in can reach, with its profile, visits, posts and wall, as the app would have made them. */
export async function insertDemoPerson(ctx: MutationCtx, providerUserId: string, input: DemoPersonInput) {
  const fields = validateProfile(input);
  if (
    await ctx.db
      .query("accounts")
      .withIndex("by_provider_userId", (q) => q.eq("provider", "apple").eq("providerUserId", providerUserId))
      .unique()
  ) {
    throw new ConvexError({ code: "account_exists", username: input.username });
  }
  if (
    await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", input.username))
      .unique()
  ) {
    throw new ConvexError({ code: "username_taken", username: input.username });
  }
  const accountId = await ctx.db.insert("accounts", { provider: "apple", providerUserId });
  const deviceId = await ctx.db.insert("devices", {
    accountId,
    firstSeenAt: input.joinedAt,
    trustWeight: 0.5,
    banned: false,
    platform: "ios",
    attestCounter: 0,
    scopeRevision: 0,
  });
  const profileId = await ctx.db.insert("profiles", {
    accountId,
    username: input.username,
    ...fields,
    avatar: input.avatar,
    searchText: normalizeSearch(`${input.username} ${fields.name}`),
    active: true,
    publishedWallCount: 0,
    leaderboardVisibility: input.leaderboardVisibility,
    updatedAt: Date.now(),
  });
  const owner = { kind: "account" as const, accountId };
  for (const { venueKey, saves, post, ...visit } of input.visits) {
    const venue = await venueByKey(ctx, venueKey);
    if (!venue) throw new ConvexError({ code: "invalid_venue", venueKey });
    const visitRow = await upsertJournalVisit(ctx, owner, deviceId, { ...visit, venueId: venue._id });
    const saveRows = [];
    for (const save of saves) {
      saveRows.push(await addDemoSave(ctx, owner, deviceId, visitRow, venue, save));
    }
    if (post && visit.visibility !== "private") {
      if (!isUuid(post.postId)) throw new ConvexError({ code: "invalid_post" });
      const existing = await ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", post.postId))
        .unique();
      if (existing) throw new ConvexError({ code: "invalid_post" });
      await insertDemoPost(ctx, { profileId, visit: visitRow, saves: saveRows, ...post });
    }
  }
  if (input.wall) await insertDemoWall(ctx, owner, profileId, input.wall);
  return profileId;
}

async function insertDemoWall(
  ctx: MutationCtx,
  owner: DemoOwner,
  profileId: Id<"profiles">,
  wall: Infer<typeof demoWall>,
) {
  validateWallItems(wall.items, 0);
  if (!/^#[0-9a-f]{6}$/i.test(wall.color)) throw new ConvexError({ code: "invalid_wall" });
  const wallId = await ctx.db.insert("walls", {
    profileId,
    color: wall.color.toUpperCase(),
    pattern: wall.pattern,
    layoutRevision: 1,
  });
  for (const item of wall.items) {
    const save = await findOwnedSave(ctx, owner, item.saveLocalId);
    if (!save) throw new ConvexError({ code: "invalid_wall", saveLocalId: item.saveLocalId });
    await ctx.db.insert("wallItems", {
      wallId,
      profileId,
      saveId: save._id,
      saveLocalId: save.localId,
      placementId: item.placementId,
      photoLocalId: item.photoLocalId,
      layout: item.layout,
      active: true,
    });
  }
  await ctx.db.patch("profiles", profileId, { publishedWallCount: wall.items.length });
}

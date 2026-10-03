import { ConvexError, type Infer, v } from "convex/values";

import { validateAlbumPhoto } from "../shared/collection/album";
import { journalVisit } from "../shared/journal/contracts";
import { isUuid, normalizeSearch } from "../shared/journal/limits";
import { avatarId } from "../shared/social/avatars";
import { validateProfile, validateWallItems, wallLayout, wallPattern } from "../shared/social/contracts";
import { leaderboardVisibility } from "../shared/social/leaderboard";
import { MAX_COMMENT_LENGTH } from "../shared/social/visit-reactions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { fileStorage } from "./lib/fileStorage";
import { canonicalPair } from "./lib/friendships";
import { upsertJournalSave, upsertJournalVisit } from "./lib/journal";
import { findOwnedSave, nextChangeVersion } from "./lib/ownership";
import { readablePublication } from "./lib/publicationAccess";
import { changeEngagement } from "./lib/visitReactions";

// Demo people are ordinary accounts that no sign-in can reach: real Apple subjects never start with this prefix.
const DEMO_PREFIX = "demo:";
const demoAccountRange = (ctx: QueryCtx) =>
  ctx.db
    .query("accounts")
    .withIndex("by_provider_userId", (q) =>
      q.eq("provider", "apple").gte("providerUserId", DEMO_PREFIX).lt("providerUserId", "demo;"),
    );

export const storeImages = internalAction({
  args: { images: v.array(v.bytes()) },
  returns: v.array(v.id("files")),
  handler: async (ctx, { images }) => {
    const ids: Id<"files">[] = [];
    for (const bytes of images) {
      const header = new Uint8Array(bytes.slice(0, 3));
      if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
        throw new ConvexError({ code: "invalid_photo" });
      }
      ids.push(await fileStorage.store(ctx, new Blob([bytes], { type: "image/jpeg" })));
    }
    return ids;
  },
});

export const inspect = internalQuery({
  args: { objectKeys: v.array(v.string()), venueKeys: v.array(v.string()) },
  returns: v.object({
    missingObjects: v.array(v.string()),
    missingVenues: v.array(v.string()),
    demoAccounts: v.number(),
  }),
  handler: async (ctx, { objectKeys, venueKeys }) => {
    const missingObjects = [];
    for (const key of objectKeys) {
      if (!(await usableObject(ctx, key))) missingObjects.push(key);
    }
    const missingVenues = [];
    for (const key of venueKeys) {
      if (!(await venueByKey(ctx, key))) missingVenues.push(key);
    }
    return { missingObjects, missingVenues, demoAccounts: (await demoAccountRange(ctx).take(1000)).length };
  },
});

const demoPhoto = v.object({
  localId: v.string(),
  storageId: v.id("files"),
  width: v.number(),
  height: v.number(),
  capturedAt: v.number(),
});
const demoSave = v.object({
  localId: v.string(),
  objectKey: v.string(),
  savedAt: v.number(),
  note: v.optional(v.string()),
  photos: v.array(demoPhoto),
  // A crop of the first photo, as the scan flow stores it.
  crop: v.optional(v.object({ storageId: v.id("files"), width: v.number(), height: v.number() })),
});
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

export const seedPerson = internalMutation({
  args: {
    username: v.string(),
    name: v.string(),
    bio: v.optional(v.string()),
    avatar: avatarId,
    leaderboardVisibility,
    joinedAt: v.number(),
    visits: v.array(demoVisit),
    wall: v.optional(demoWall),
  },
  returns: v.id("profiles"),
  handler: async (ctx, input) => {
    const fields = validateProfile(input);
    const providerUserId = `${DEMO_PREFIX}${input.username}`;
    if (
      await ctx.db
        .query("accounts")
        .withIndex("by_provider_userId", (q) => q.eq("provider", "apple").eq("providerUserId", providerUserId))
        .unique()
    ) {
      throw new ConvexError({ code: "demo_exists", username: input.username });
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
        saveRows.push(await seedSave(ctx, owner, deviceId, visitRow, venue, save));
      }
      if (post && visit.visibility !== "private") {
        if (!isUuid(post.postId)) throw new ConvexError({ code: "invalid_post" });
        const existing = await ctx.db
          .query("sharedVisits")
          .withIndex("by_postId", (q) => q.eq("postId", post.postId))
          .unique();
        if (existing) throw new ConvexError({ code: "invalid_post" });
        const publicationId = await ctx.db.insert("sharedVisits", {
          postId: post.postId,
          profileId,
          visitId: visitRow._id,
          visitLocalId: visitRow.localId,
          visitedOn: visitRow.visitedOn,
          status: "active",
          audience: visit.visibility,
          reflection: visitRow.reflection ?? "",
          publishedAt: post.publishedAt,
          updatedAt: post.publishedAt,
          publicationRevision: 1,
        });
        for (const [position, { row, photoLocalIds }] of saveRows.entries()) {
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
    }
    if (input.wall) await seedWall(ctx, owner, profileId, input.wall);
    return profileId;
  },
});

async function seedSave(
  ctx: MutationCtx,
  owner: { kind: "account"; accountId: Id<"accounts"> },
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
    note: save.note,
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

async function seedWall(
  ctx: MutationCtx,
  owner: { kind: "account"; accountId: Id<"accounts"> },
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
      noteVisible: false,
      noteRevision: 0,
    });
  }
  await ctx.db.patch("profiles", profileId, { publishedWallCount: wall.items.length });
}

export const seedSocial = internalMutation({
  args: {
    friendships: v.array(
      v.object({
        from: v.string(),
        to: v.string(),
        state: v.union(v.literal("pending"), v.literal("accepted")),
        at: v.number(),
      }),
    ),
    likes: v.array(v.object({ username: v.string(), postId: v.string() })),
    comments: v.array(v.object({ username: v.string(), postId: v.string(), body: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, input) => {
    for (const edge of input.friendships) {
      const from = await demoProfile(ctx, edge.from);
      const to = await demoProfile(ctx, edge.to);
      const [firstProfileId, secondProfileId] = canonicalPair(from._id, to._id);
      if (
        await ctx.db
          .query("friendships")
          .withIndex("by_pair", (q) => q.eq("firstProfileId", firstProfileId).eq("secondProfileId", secondProfileId))
          .unique()
      ) {
        throw new ConvexError({ code: "invalid_relationship", from: edge.from, to: edge.to });
      }
      await ctx.db.insert("friendships", {
        firstProfileId,
        secondProfileId,
        requesterId: from._id,
        state: edge.state,
        // A request is one transition and its acceptance another.
        revision: edge.state === "accepted" ? 2 : 1,
        updatedAt: edge.at,
      });
    }
    for (const like of input.likes) {
      const { profile, publication } = await readableBy(ctx, like.username, like.postId);
      const existing = await ctx.db
        .query("visitLikes")
        .withIndex("by_publication_profile", (q) => q.eq("publicationId", publication._id).eq("profileId", profile._id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("visitLikes", { publicationId: publication._id, profileId: profile._id });
      await changeEngagement(ctx, publication._id, "likeCount", 1);
    }
    for (const comment of input.comments) {
      const body = comment.body.trim();
      if (!body || body.length > MAX_COMMENT_LENGTH) throw new ConvexError({ code: "invalid_comment" });
      const { profile, publication } = await readableBy(ctx, comment.username, comment.postId);
      await ctx.db.insert("visitComments", {
        publicationId: publication._id,
        profileId: profile._id,
        body,
        requestId: crypto.randomUUID(),
      });
      await changeEngagement(ctx, publication._id, "commentCount", 1);
    }
    return null;
  },
});

// Moves demo people from uploaded photos onto preset paintings.
export const setAvatars = internalMutation({
  args: { avatars: v.array(v.object({ username: v.string(), avatar: avatarId })) },
  returns: v.null(),
  handler: async (ctx, { avatars }) => {
    for (const { username, avatar } of avatars) {
      const profile = await demoProfile(ctx, username);
      await ctx.db.patch("profiles", profile._id, { avatar, photoStorageId: undefined, updatedAt: Date.now() });
      if (profile.photoStorageId) await fileStorage.delete(ctx, profile.photoStorageId);
    }
    return null;
  },
});

// Removes every demo person through the account-deletion purge, which also clears their reactions on real posts.
export const clear = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const accounts = await demoAccountRange(ctx).take(200);
    for (const account of accounts) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
        .unique();
      if (profile) await ctx.db.patch("profiles", profile._id, { active: false, publishedWallCount: 0 });
      for (const device of await ctx.db
        .query("devices")
        .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
        .take(10)) {
        await ctx.db.delete("devices", device._id);
      }
      await ctx.db.delete("accounts", account._id);
      await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, { accountId: account._id });
    }
    return accounts.length;
  },
});

async function usableObject(ctx: QueryCtx, key: string) {
  const object = await ctx.db
    .query("objects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return object && !object.reverted && !object.mergedInto && object.identityStatus === "established" ? object : null;
}
function venueByKey(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("museums")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
async function demoProfile(ctx: QueryCtx, username: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
  const account = profile && (await ctx.db.get("accounts", profile.accountId));
  if (!profile || !account?.providerUserId.startsWith(DEMO_PREFIX)) {
    throw new ConvexError({ code: "not_found", username });
  }
  return profile;
}
async function readableBy(ctx: QueryCtx, username: string, postId: string) {
  const profile = await demoProfile(ctx, username);
  const publication = await ctx.db
    .query("sharedVisits")
    .withIndex("by_postId", (q) => q.eq("postId", postId))
    .unique();
  if (!publication || !(await readablePublication(ctx, publication, profile._id))) {
    throw new ConvexError({ code: "not_found", username, postId });
  }
  return { profile, publication };
}

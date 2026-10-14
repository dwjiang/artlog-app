import { ConvexError, v } from "convex/values";

import { avatarId } from "../shared/social/avatars";
import { leaderboardVisibility } from "../shared/social/leaderboard";
import { MAX_COMMENT_LENGTH } from "../shared/social/visit-reactions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  demoAccountRange,
  demoPersonArgs,
  demoProfile,
  demoProviderUserId,
  insertDemoPerson,
  readableBy,
  usableObject,
  venueByKey,
} from "./lib/demoAccounts";
import { fileStorage } from "./lib/fileStorage";
import { canonicalPair } from "./lib/friendships";
import { insertVisitComment, insertVisitLike } from "./lib/visitReactions";

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

export const seedPerson = internalMutation({
  args: { ...demoPersonArgs, leaderboardVisibility, joinedAt: v.number() },
  returns: v.id("profiles"),
  handler: (ctx, input) => insertDemoPerson(ctx, demoProviderUserId(input.username), input),
});

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
      await insertVisitLike(ctx, publication._id, profile._id);
    }
    for (const comment of input.comments) {
      const body = comment.body.trim();
      if (!body || body.length > MAX_COMMENT_LENGTH) throw new ConvexError({ code: "invalid_comment" });
      const { profile, publication } = await readableBy(ctx, comment.username, comment.postId);
      await insertVisitComment(ctx, {
        publicationId: publication._id,
        profileId: profile._id,
        body,
        requestId: crypto.randomUUID(),
        mentions: [],
      });
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

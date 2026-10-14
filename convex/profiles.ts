import { ConvexError, v, type Infer } from "convex/values";

import { pageArgs, pagination } from "../shared/journal/contracts";
import { LIMITS, normalizeSearch } from "../shared/journal/limits";
import { isAvatarId } from "../shared/social/avatars";
import {
  browsedProfile,
  profilePage,
  publicProfile,
  validateProfile,
  validateSearch,
} from "../shared/social/contracts";
import { usernameCandidates } from "../shared/social/username";
import { randomWallStyle } from "../shared/wall/defaults";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { acceptedRelationships, blockedEitherWay, findBlock } from "./lib/friendships";
import { linkedMentions, resolveMentions } from "./lib/mentions";
import { requireAllowedBio, safetyChecksOn } from "./lib/moderation";
import { withErrorReporting } from "./lib/observability";
import { activeProfile, optionalProfile, requireAccount, requireProfile } from "./lib/ownership";
import { projectBrowsedProfile, projectProfile } from "./lib/projections";
import { isReviewFriend } from "./lib/reviewFriend";
import { findDismissal } from "./lib/suggestionDismissals";

// `avatar` carries over the painting someone already had as a guest.
const createArgs = {
  username: v.string(),
  name: v.string(),
  bio: v.optional(v.string()),
  avatar: v.optional(v.string()),
};
export const create = action({
  args: createArgs,
  returns: publicProfile,
  handler: (ctx, input): Promise<Infer<typeof publicProfile>> =>
    withErrorReporting("profiles.create", async () => {
      validateProfile(input);
      const { safetyChecks } = await ctx.runQuery(internal.profiles.requireSignedIn, {});
      await requireAllowedBio(input.bio, safetyChecks);
      return ctx.runMutation(internal.profiles.insert, input);
    }),
});
export const requireSignedIn = internalQuery({
  args: {},
  returns: v.object({ safetyChecks: v.boolean() }),
  handler: async (ctx) => {
    const { accountId } = await requireAccount(ctx);
    return { safetyChecks: await safetyChecksOn(ctx, accountId) };
  },
});
export const insert = internalMutation({
  args: createArgs,
  returns: publicProfile,
  handler: async (ctx, input) => {
    const { accountId } = await requireAccount(ctx);
    const fields = validateProfile(input);
    if (input.avatar !== undefined && !isAvatarId(input.avatar)) {
      throw new ConvexError({ code: "invalid_profile" });
    }
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .unique();
    if (existing) {
      if (!existing.active || existing.removal) {
        throw new ConvexError({ code: "profile_required" });
      }
      return projectProfile(ctx, existing);
    }
    if (
      await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", input.username))
        .unique()
    ) {
      throw new ConvexError({ code: "username_taken" });
    }
    const profileId = await ctx.db.insert("profiles", {
      accountId,
      username: input.username,
      ...fields,
      avatar: input.avatar,
      searchText: normalizeSearch(`${input.username} ${fields.name}`),
      active: true,
      publishedWallCount: 0,
      leaderboardVisibility: "global",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("walls", {
      profileId,
      ...randomWallStyle(),
      layoutRevision: 0,
    });
    const bioMentions = await resolveMentions(ctx, fields.bio ?? "", profileId);
    if (bioMentions.length > 0) await ctx.db.patch("profiles", profileId, { bioMentions });
    return projectProfile(ctx, (await ctx.db.get("profiles", profileId))!);
  },
});
/** Browse lists leave out removed profiles and anyone blocked in either direction. */
async function browsable(ctx: QueryCtx, viewer: Doc<"profiles"> | null, profile: Doc<"profiles">) {
  return (
    !profile.removal
    && !!(await ctx.db.get("accounts", profile.accountId))
    && !(viewer && (await blockedEitherWay(ctx, viewer._id, profile._id)))
  );
}
async function projectProfilePage(ctx: QueryCtx, profile: Doc<"profiles">, viewer: Doc<"profiles"> | null) {
  return {
    ...(await projectProfile(ctx, profile)),
    bioMentions: await linkedMentions(ctx, profile.bioMentions, { viewerId: viewer?._id, writerId: profile._id }),
  };
}
export const getPublic = query({
  args: { profileId: v.id("profiles") },
  returns: v.union(profilePage, v.null()),
  handler: async (ctx, { profileId }) => {
    const profile = await activeProfile(ctx, profileId);
    if (!profile) return null;
    // A blocker can still open the profile they blocked to unblock it; the blocked person cannot.
    const viewer = await optionalProfile(ctx);
    if (viewer && (await findBlock(ctx, profileId, viewer._id))?.active) return null;
    return projectProfilePage(ctx, profile, viewer);
  },
});
export const search = query({
  args: { query: v.string(), ...pageArgs },
  returns: v.object({
    page: v.array(browsedProfile),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, input) => {
    const search = validateSearch(input.query);
    const viewer = await optionalProfile(ctx);
    const result = await ctx.db
      .query("profiles")
      .withSearchIndex("search_text", (q) => q.search("searchText", search).eq("active", true))
      .paginate(pagination(input));
    const username = search.replace(/^@/, "");
    const page = [];
    for (const profile of result.page) {
      if (profile.username !== username && (await isReviewFriend(ctx, profile))) continue;
      if (await browsable(ctx, viewer, profile)) page.push(await projectBrowsedProfile(ctx, viewer, profile));
    }
    return {
      page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const mine = query({
  args: {},
  returns: profilePage,
  handler: async (ctx) => {
    const { profile } = await requireProfile(ctx);
    return projectProfilePage(ctx, profile, profile);
  },
});
/** A profile's friends as the viewer may see them, each carrying the viewer's relationship to mark mutual friends. */
export const friends = query({
  args: { profileId: v.id("profiles") },
  returns: v.union(v.array(browsedProfile), v.null()),
  handler: async (ctx, { profileId }) => {
    const { profile: viewer } = await requireProfile(ctx);
    const person = await activeProfile(ctx, profileId);
    if (!person || (await blockedEitherWay(ctx, viewer._id, profileId))) return null;
    const edges = (await acceptedRelationships(ctx, profileId)).slice(0, LIMITS.friends);
    // Everyone who added the review friend is a stranger to everyone else who did.
    const hidden = await isReviewFriend(ctx, person);
    const people = [];
    for (const edge of edges) {
      const id = edge.firstProfileId === profileId ? edge.secondProfileId : edge.firstProfileId;
      if (hidden && id !== viewer._id) continue;
      const friend = await activeProfile(ctx, id);
      if (friend && !(await blockedEitherWay(ctx, viewer._id, id))) {
        people.push(await projectBrowsedProfile(ctx, viewer, friend));
      }
    }
    return people.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const discover = query({
  args: { ...pageArgs, excludeDismissed: v.optional(v.boolean()) },
  returns: v.object({
    page: v.array(browsedProfile),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, input) => {
    const viewer = await optionalProfile(ctx);
    const result = await ctx.db
      .query("profiles")
      .withIndex("by_active", (q) => q.eq("active", true))
      .order("desc")
      .paginate(pagination(input));
    const page = [];
    for (const profile of result.page) {
      if (input.excludeDismissed && viewer && (await findDismissal(ctx, viewer._id, profile._id))) continue;
      if (await isReviewFriend(ctx, profile)) continue;
      if (await browsable(ctx, viewer, profile)) page.push(await projectBrowsedProfile(ctx, viewer, profile));
    }
    return {
      page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const usernameAvailable = query({
  args: { username: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { username }) => {
    await requireAccount(ctx);
    validateProfile({ name: "Availability", username });
    return !(await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique());
  },
});

export const suggestUsername = query({
  args: { name: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { name }) => {
    await requireAccount(ctx);
    if (name.length > LIMITS.name) return null;
    for (const username of usernameCandidates(name)) {
      const taken = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      if (!taken) return username;
    }
    return null;
  },
});

export const requests = query({
  args: {},
  returns: v.array(browsedProfile),
  handler: async (ctx) => {
    const { profile } = await requireProfile(ctx);
    const edges = (
      await Promise.all([
        ctx.db
          .query("friendships")
          .withIndex("by_first_state", (q) => q.eq("firstProfileId", profile._id).eq("state", "pending"))
          .take(LIMITS.friends + 1),
        ctx.db
          .query("friendships")
          .withIndex("by_second_state", (q) => q.eq("secondProfileId", profile._id).eq("state", "pending"))
          .take(LIMITS.friends + 1),
      ])
    ).flat();
    const requests = [];
    for (const edge of edges) {
      if (edge.requesterId === profile._id) continue;
      const person = await activeProfile(ctx, edge.requesterId);
      if (person && !(await blockedEitherWay(ctx, profile._id, person._id))) {
        requests.push(await projectBrowsedProfile(ctx, profile, person));
      }
    }
    return requests.sort((a, b) => a.name.localeCompare(b.name));
  },
});

import { ConvexError, v } from "convex/values";

import { normalizeSearch } from "../shared/journal/limits";
import { isAvatarId } from "../shared/social/avatars";
import { publicProfile, validateProfile } from "../shared/social/contracts";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { resolveMentions } from "./lib/mentions";
import { safetyChecksOn } from "./lib/moderation";
import { requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";

export const authorize = internalQuery({
  args: {},
  returns: v.object({ profileId: v.id("profiles"), bio: v.optional(v.string()), safetyChecks: v.boolean() }),
  handler: async (ctx) => {
    const { profile, accountId } = await requireProfile(ctx);
    return { profileId: profile._id, bio: profile.bio, safetyChecks: await safetyChecksOn(ctx, accountId) };
  },
});

export const save = internalMutation({
  args: {
    profileId: v.id("profiles"),
    name: v.string(),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    photo: v.optional(v.union(v.id("files"), v.null())),
    avatar: v.optional(v.string()),
  },
  returns: publicProfile,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    if (profile._id !== input.profileId) {
      throw new ConvexError({ code: "sync_scope_changed" });
    }
    const fields = validateProfile(input);
    if (input.avatar !== undefined && !isAvatarId(input.avatar)) {
      throw new ConvexError({ code: "invalid_profile" });
    }
    const avatar = input.avatar ?? profile.avatar;
    const username = input.username ?? profile.username;
    if (
      username !== profile.username
      && (await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique())
    ) {
      throw new ConvexError({ code: "username_taken" });
    }
    const photoStorageId = input.photo === undefined ? profile.photoStorageId : (input.photo ?? undefined);
    if (photoStorageId) await retainFile(ctx, photoStorageId, true);
    // An omitted bio keeps the current one, which someone with safety checks off can't resubmit.
    const bio = input.bio === undefined ? profile.bio : fields.bio;
    const bioMentions = await resolveMentions(ctx, bio ?? "", profile._id, profile.bioMentions);
    await ctx.db.patch("profiles", profile._id, {
      ...fields,
      bio,
      bioMentions: bioMentions.length > 0 ? bioMentions : undefined,
      username,
      photoStorageId,
      avatar,
      searchText: normalizeSearch(`${username} ${fields.name}`),
      updatedAt: Date.now(),
    });
    if (profile.photoStorageId && profile.photoStorageId !== photoStorageId) {
      await fileStorage.delete(ctx, profile.photoStorageId);
    }
    return projectProfile(ctx, { ...profile, ...fields, bio, username, photoStorageId, avatar });
  },
});

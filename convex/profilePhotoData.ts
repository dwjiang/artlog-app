import { ConvexError, v } from "convex/values";

import { normalizeSearch } from "../shared/journal/limits";
import { publicProfile, validateProfile } from "../shared/social/contracts";
import { internalMutation, internalQuery } from "./_generated/server";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";

export const authorize = internalQuery({
  args: {},
  returns: v.id("profiles"),
  handler: async (ctx) => (await requireProfile(ctx)).profile._id,
});

export const save = internalMutation({
  args: {
    profileId: v.id("profiles"),
    name: v.string(),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    photo: v.optional(v.union(v.string(), v.null())),
  },
  returns: publicProfile,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    if (profile._id !== input.profileId) {
      throw new ConvexError({ code: "sync_scope_changed" });
    }
    const fields = validateProfile(input);
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
    await ctx.db.patch("profiles", profile._id, {
      ...fields,
      username,
      photoStorageId,
      searchText: normalizeSearch(`${username} ${fields.name}`),
      updatedAt: Date.now(),
    });
    if (profile.photoStorageId && profile.photoStorageId !== photoStorageId) {
      await fileStorage.delete(ctx, profile.photoStorageId);
    }
    return projectProfile(ctx, { ...profile, ...fields, username, photoStorageId });
  },
});

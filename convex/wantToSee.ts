import { ConvexError, v } from "convex/values";

import { LIMITS } from "../shared/journal/limits";
import { avatarId } from "../shared/social/avatars";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { findExhibitionSave, newestExhibitionSaves } from "./lib/exhibitionSaves";
import { acceptedRelationships, blockedEitherWay } from "./lib/friendships";
import { findMuseumSaves, newestMuseumSaves } from "./lib/museumSaves";
import { activeProfile, optionalProfile, requireClaimComplete, resolveOwner } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { limitDevice } from "./lib/rateLimits";

// Per friend, so a full friends list stays within one query's reads; older saves are mostly for closed shows.
const FRIEND_SAVES = 50;

const friendSave = v.object({
  exhibitionId: v.id("exhibitions"),
  friend: v.object({
    profileId: v.id("profiles"),
    name: v.string(),
    avatar: avatarId,
    photoUrl: v.optional(v.string()),
  }),
  savedAt: v.number(),
});

/** The caller's saved shows, newest first. Guests save on their device; signing in moves the saves to the account. */
export const mine = query({
  args: {},
  returns: v.array(v.id("exhibitions")),
  handler: async (ctx) => {
    const { owner } = await resolveOwner(ctx);
    return (await newestExhibitionSaves(ctx, owner)).map((save) => save.exhibitionId);
  },
});

export const set = mutation({
  args: { exhibitionId: v.id("exhibitions"), saved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { exhibitionId, saved }) => {
    const { device, owner } = await resolveOwner(ctx);
    await requireClaimComplete(ctx, device._id);
    const current = await findExhibitionSave(ctx, owner, exhibitionId);
    if (!!current === saved) return null;
    await limitDevice(ctx, "wantToSee", device._id);
    if (current) {
      await ctx.db.delete("exhibitionSaves", current._id);
      return null;
    }
    if (!(await ctx.db.get("exhibitions", exhibitionId))) throw new ConvexError({ code: "not_found" });
    await ctx.db.insert("exhibitionSaves", { owner, exhibitionId, savedAt: Date.now() });
    return null;
  },
});

/**
 * The caller's saved museums, newest first. A save of a duplicate the museum audit merged away counts for the museum it
 * merged into.
 */
export const museums = query({
  args: {},
  returns: v.array(v.id("museums")),
  handler: async (ctx) => {
    const { owner } = await resolveOwner(ctx);
    const ids = new Set<Id<"museums">>();
    for (const { museumId } of await newestMuseumSaves(ctx, owner)) {
      const museum = await ctx.db.get("museums", museumId);
      if (museum) ids.add(museum.mergedInto ?? museumId);
    }
    return [...ids];
  },
});

export const setMuseum = mutation({
  args: { museumId: v.id("museums"), saved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { museumId, saved }) => {
    const { device, owner } = await resolveOwner(ctx);
    await requireClaimComplete(ctx, device._id);
    const current = await findMuseumSaves(ctx, owner, museumId);
    if (current.length > 0 === saved) return null;
    await limitDevice(ctx, "wantToSee", device._id);
    if (!saved) {
      for (const save of current) await ctx.db.delete("museumSaves", save._id);
      return null;
    }
    if (!(await ctx.db.get("museums", museumId))) throw new ConvexError({ code: "not_found" });
    await ctx.db.insert("museumSaves", { owner, museumId, savedAt: Date.now() });
    return null;
  },
});

/** Shows the caller's friends want to see, newest first; empty for anyone without a profile. */
export const friends = query({
  args: {},
  returns: v.array(friendSave),
  handler: async (ctx) => {
    const viewer = await optionalProfile(ctx);
    if (!viewer) return [];
    const saves = [];
    for (const edge of (await acceptedRelationships(ctx, viewer._id)).slice(0, LIMITS.friends)) {
      const id = edge.firstProfileId === viewer._id ? edge.secondProfileId : edge.firstProfileId;
      const person = await activeProfile(ctx, id);
      if (!person || (await blockedEitherWay(ctx, viewer._id, id))) continue;
      const theirs = await newestExhibitionSaves(ctx, { kind: "account", accountId: person.accountId }, FRIEND_SAVES);
      if (theirs.length === 0) continue;
      const { profileId, name, avatar, photoUrl } = await projectProfile(ctx, person);
      const friend = { profileId, name, avatar, ...(photoUrl ? { photoUrl } : {}) };
      for (const { exhibitionId, savedAt } of theirs) saves.push({ exhibitionId, friend, savedAt });
    }
    return saves.sort((a, b) => b.savedAt - a.savedAt);
  },
});

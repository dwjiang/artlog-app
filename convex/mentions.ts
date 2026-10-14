import { v } from "convex/values";

import { isUuid, LIMITS, normalizeSearch } from "../shared/journal/limits";
import { mentionPlace, mentionSuggestion } from "../shared/social/contracts";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { acceptedRelationships, blockedEitherWay } from "./lib/friendships";
import { canSeePost } from "./lib/mentions";
import { activeProfile, optionalProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { readablePublication } from "./lib/publicationAccess";
import { isReviewFriend } from "./lib/reviewFriend";

const SHOWN = 5;
// Recent commenters lead a comment's suggestions; older ones are found by name like anyone else.
const COMMENT_SCAN = 50;
const SEARCH_SCAN = 20;

type Role = "author" | "companion";

/**
 * People to offer for the handle being typed, only among those who could read the text. The people around the
 * text lead: a visit's author and recent commenters, or the friends picked for Went with. Friends come next, then
 * anyone Search finds. A bare `@` (empty query) offers the leading people and friends.
 */
export const suggest = query({
  args: { query: v.string(), place: mentionPlace },
  returns: v.array(mentionSuggestion),
  handler: async (ctx, { query: typed, place }) => {
    const viewer = await optionalProfile(ctx);
    const prefix = typed.toLowerCase();
    if (!viewer || !/^[a-z0-9_]{0,30}$/.test(prefix)) return [];

    let post: Doc<"sharedVisits"> | null = null;
    const leading: { id: Id<"profiles">; role?: Role }[] = [];
    if (place.kind === "comment") {
      if (!isUuid(place.postId)) return [];
      const publication = await ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", place.postId))
        .unique();
      const access = publication && (await readablePublication(ctx, publication, viewer._id));
      if (!access) return [];
      post = access.publication;
      leading.push({ id: post.profileId, role: "author" });
      const comments = await ctx.db
        .query("visitComments")
        .withIndex("by_publication", (q) => q.eq("publicationId", access.publication._id))
        .order("desc")
        .take(COMMENT_SCAN);
      for (const comment of comments) leading.push({ id: comment.profileId });
    } else if (place.kind === "visit") {
      for (const id of place.companionIds.slice(0, LIMITS.companions)) leading.push({ id, role: "companion" });
    }

    const friendIds = new Set(
      (await acceptedRelationships(ctx, viewer._id)).map((edge) =>
        edge.firstProfileId === viewer._id ? edge.secondProfileId : edge.firstProfileId,
      ),
    );
    const matches = (profile: Doc<"profiles">) =>
      !prefix
      || profile.username.startsWith(prefix)
      || normalizeSearch(profile.name)
        .split(" ")
        .some((word) => word.startsWith(prefix));
    const allowed = async (profile: Doc<"profiles">) => {
      if (!(await activeProfile(ctx, profile._id)) || (await blockedEitherWay(ctx, viewer._id, profile._id))) {
        return false;
      }
      if (post) return canSeePost(ctx, post, profile._id);
      return place.kind !== "visit" || place.audience === "public" || friendIds.has(profile._id);
    };

    const seen = new Set<Id<"profiles">>([viewer._id]);
    const picked: { profile: Doc<"profiles">; role?: Role }[] = [];
    const consider = async (profile: Doc<"profiles"> | null, role?: Role) => {
      if (!profile || picked.length === SHOWN || seen.has(profile._id)) return;
      seen.add(profile._id);
      if (matches(profile) && (await allowed(profile))) picked.push({ profile, ...(role ? { role } : {}) });
    };
    for (const { id, role } of leading) await consider(await ctx.db.get("profiles", id), role);
    const friends: Doc<"profiles">[] = [];
    for (const id of friendIds) {
      const friend = picked.length < SHOWN && !seen.has(id) ? await ctx.db.get("profiles", id) : null;
      if (friend && matches(friend)) friends.push(friend);
    }
    for (const friend of friends.sort((a, b) => a.name.localeCompare(b.name))) await consider(friend);
    if (prefix && picked.length < SHOWN) {
      const found = await ctx.db
        .query("profiles")
        .withSearchIndex("search_text", (q) => q.search("searchText", prefix).eq("active", true))
        .take(SEARCH_SCAN);
      // The review friend is offered only to its friends, who met it above.
      for (const profile of found) if (!(await isReviewFriend(ctx, profile))) await consider(profile);
    }
    return Promise.all(
      picked.map(async ({ profile, role }) => ({
        profile: await projectProfile(ctx, profile),
        ...(role ? { role } : {}),
      })),
    );
  },
});

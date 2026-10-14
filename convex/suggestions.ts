import { ConvexError, type Infer, v } from "convex/values";

import { inCommon, suggestion, type suggestionReason } from "../shared/social/contracts";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { acceptedRelationships, relationshipSnapshot } from "./lib/friendships";
import { activeProfile, requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { readablePublication, requirePublicWallItem } from "./lib/publicationAccess";
import { activeWallItems, publicWallProjection } from "./lib/publicWall";
import { limitKey } from "./lib/rateLimits";
import { isReviewFriend } from "./lib/reviewFriend";
import { findDismissal } from "./lib/suggestionDismissals";

// Every signal reads a bounded sample, so one read stays near a few thousand documents however large the graph grows.
const SAMPLE = {
  friends: 25,
  friendEdges: 50,
  saves: 30,
  saversPerArtwork: 10,
  visits: 20,
  visitorsPerVenue: 10,
  posts: 10,
  likesPerPost: 20,
  candidates: 200,
};
const SHOWN = { suggestions: 20, mutualFriends: 2, commonArtworks: 6, commonMuseums: 3 };

type Evidence = {
  mutual: Id<"profiles">[];
  artworks: Doc<"wallItems">[];
  museums: Map<Id<"museums">, string>;
  liked?: string;
};
const otherSide = (edge: Doc<"friendships">, id: Id<"profiles">) =>
  edge.firstProfileId === id ? edge.secondProfileId : edge.firstProfileId;
// Mutual friends outrank shared artworks, then shared museums, then a like; within a kind, more evidence ranks higher.
function rank({ mutual, artworks, museums }: Evidence): [number, number] {
  if (mutual.length > 0) return [0, mutual.length];
  if (artworks.length > 0) return [1, artworks.length];
  if (museums.size > 0) return [2, museums.size];
  return [3, 1];
}

async function gatherEvidence(
  ctx: QueryCtx,
  viewer: Doc<"profiles">,
  accountId: Id<"accounts">,
  accepted: Doc<"friendships">[],
) {
  const evidence = new Map<Id<"profiles">, Evidence>();
  const about = (id: Id<"profiles">) => {
    let entry = evidence.get(id);
    if (!entry) {
      entry = { mutual: [], artworks: [], museums: new Map() };
      evidence.set(id, entry);
    }
    return entry;
  };
  for (const edge of accepted.slice(0, SAMPLE.friends)) {
    const friend = otherSide(edge, viewer._id);
    const profile = await ctx.db.get("profiles", friend);
    if (!profile || (await isReviewFriend(ctx, profile))) continue;
    const [first, second] = await Promise.all([
      ctx.db
        .query("friendships")
        .withIndex("by_first_state", (q) => q.eq("firstProfileId", friend).eq("state", "accepted"))
        .take(SAMPLE.friendEdges),
      ctx.db
        .query("friendships")
        .withIndex("by_second_state", (q) => q.eq("secondProfileId", friend).eq("state", "accepted"))
        .take(SAMPLE.friendEdges),
    ]);
    for (const theirs of [...first, ...second]) about(otherSide(theirs, friend)).mutual.push(friend);
  }

  const owner = { kind: "account" as const, accountId };
  const saves = await ctx.db
    .query("collections")
    .withIndex("by_owner_savedAt", (q) => q.eq("owner", owner).eq("deletedAt", undefined))
    .order("desc")
    .take(SAMPLE.saves);
  for (const artworkId of new Set(saves.flatMap((save) => (save.artworkId ? [save.artworkId] : [])))) {
    const savers = await ctx.db
      .query("collections")
      .withIndex("by_artwork_deletedAt", (q) => q.eq("artworkId", artworkId).eq("deletedAt", undefined))
      .take(SAMPLE.saversPerArtwork);
    for (const save of savers) {
      if (save.owner.kind !== "account" || save.owner.accountId === accountId) continue;
      const item = await ctx.db
        .query("wallItems")
        .withIndex("by_save_active", (q) => q.eq("saveId", save._id).eq("active", true))
        .first();
      if (item && (await publicItem(ctx, item))) about(item.profileId).artworks.push(item);
    }
  }

  const visits = await ctx.db
    .query("visits")
    .withIndex("by_owner_history", (q) => q.eq("owner", owner))
    .order("desc")
    .take(SAMPLE.visits);
  const venues = new Map(visits.map((visit) => [visit.venueId, visit.venueName]));
  for (const [venueId, venueName] of venues) {
    const others = await ctx.db
      .query("visits")
      .withIndex("by_venue_history", (q) => q.eq("venueId", venueId))
      .order("desc")
      .take(SAMPLE.visitorsPerVenue);
    for (const visit of others) {
      if (visit.owner.kind !== "account" || visit.owner.accountId === accountId) continue;
      const publication = await ctx.db
        .query("sharedVisits")
        .withIndex("by_visitId", (q) => q.eq("visitId", visit._id))
        .first();
      const access = publication && (await readablePublication(ctx, publication, viewer._id));
      if (access) about(access.profile._id).museums.set(venueId, venueName);
    }
  }

  const posts = await ctx.db
    .query("sharedVisits")
    .withIndex("by_profile_status_history", (q) => q.eq("profileId", viewer._id).eq("status", "active"))
    .order("desc")
    .take(SAMPLE.posts);
  for (const post of posts) {
    const likes = await ctx.db
      .query("visitLikes")
      .withIndex("by_publication", (q) => q.eq("publicationId", post._id))
      .take(SAMPLE.likesPerPost);
    const visit = likes.length > 0 ? await ctx.db.get("visits", post.visitId) : null;
    if (!visit) continue;
    for (const like of likes) about(like.profileId).liked ??= visit.venueName;
  }
  return evidence;
}

async function publicItem(ctx: QueryCtx, item: Doc<"wallItems">) {
  try {
    await requirePublicWallItem(ctx, item._id);
    return true;
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "not_found") return false;
    throw error;
  }
}

async function describe(ctx: QueryCtx, evidence: Evidence): Promise<Infer<typeof suggestionReason> | null> {
  if (evidence.mutual.length > 0) {
    const friends = [];
    for (const id of evidence.mutual) {
      if (friends.length === SHOWN.mutualFriends) break;
      const friend = await activeProfile(ctx, id);
      if (friend) friends.push(await projectProfile(ctx, friend));
    }
    if (friends.length > 0) return { kind: "mutual", count: evidence.mutual.length, friends };
  }
  for (const item of evidence.artworks) {
    const current = await publicWallProjection(ctx, item);
    if (current) return { kind: "artwork", artwork: { itemId: item._id, artwork: current.projection.artwork } };
  }
  const [venueName] = evidence.museums.values();
  if (venueName) return { kind: "museum", venueName };
  if (evidence.liked) return { kind: "liked", venueName: evidence.liked };
  return null;
}

export const list = query({
  args: {},
  returns: v.object({ friendCount: v.number(), people: v.array(suggestion) }),
  handler: async (ctx) => {
    const { profile: viewer, accountId } = await requireProfile(ctx);
    const accepted = await acceptedRelationships(ctx, viewer._id);
    const excluded = new Set([viewer._id, ...accepted.map((edge) => otherSide(edge, viewer._id))]);
    const evidence = await gatherEvidence(ctx, viewer, accountId, accepted);
    const ranked = [...evidence]
      .filter(([id]) => !excluded.has(id))
      .map(([id, entry]) => ({ id, entry, rank: rank(entry) }))
      .sort((a, b) => a.rank[0] - b.rank[0] || b.rank[1] - a.rank[1])
      .slice(0, SAMPLE.candidates);
    const people = [];
    for (const { id, entry } of ranked) {
      if (people.length === SHOWN.suggestions) break;
      if (await findDismissal(ctx, viewer._id, id)) continue;
      const [person, snapshot] = await Promise.all([activeProfile(ctx, id), relationshipSnapshot(ctx, viewer._id, id)]);
      const { edge, block, reverseBlock, state } = snapshot;
      if (
        !person
        || (await isReviewFriend(ctx, person))
        || block?.active
        || reverseBlock?.active
        || edge?.state === "accepted"
        || (edge?.state === "pending" && (edge.requesterId !== viewer._id || edge.suggestionExpiresAt === undefined))
      ) {
        continue;
      }
      const reason = await describe(ctx, entry);
      if (reason) people.push({ profile: { ...(await projectProfile(ctx, person)), relationship: state }, reason });
    }
    return { friendCount: accepted.length, people };
  },
});

export const inCommonWith = query({
  args: { profileId: v.id("profiles") },
  returns: inCommon,
  handler: async (ctx, { profileId }) => {
    const { profile: viewer, accountId } = await requireProfile(ctx);
    const none = { artworks: [], museums: [] };
    if (profileId === viewer._id || !(await activeProfile(ctx, profileId))) return none;
    const { block, reverseBlock } = await relationshipSnapshot(ctx, viewer._id, profileId);
    if (block?.active || reverseBlock?.active) return none;
    const owner = { kind: "account" as const, accountId };

    const wall = await ctx.db
      .query("walls")
      .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
      .unique();
    const artworks = [];
    const seenArtworks = new Set<Id<"artworks">>();
    for (const item of await activeWallItems(ctx, wall)) {
      if (artworks.length === SHOWN.commonArtworks) break;
      const artworkId = (await ctx.db.get("collections", item.saveId))?.artworkId;
      if (!artworkId || seenArtworks.has(artworkId)) continue;
      seenArtworks.add(artworkId);
      const mine = await ctx.db
        .query("collections")
        .withIndex("by_owner_artwork_savedAt", (q) =>
          q.eq("owner", owner).eq("artworkId", artworkId).eq("deletedAt", undefined),
        )
        .first();
      const current = mine && (await publicWallProjection(ctx, item));
      if (current) artworks.push({ itemId: item._id, artwork: current.projection.artwork });
    }

    const posts = await ctx.db
      .query("sharedVisits")
      .withIndex("by_profile_status_history", (q) => q.eq("profileId", profileId).eq("status", "active"))
      .order("desc")
      .take(SAMPLE.visits);
    const museums = [];
    const seenVenues = new Set<Id<"museums">>();
    for (const post of posts) {
      if (museums.length === SHOWN.commonMuseums) break;
      const access = await readablePublication(ctx, post, viewer._id);
      const venueId = access?.visit.venueId;
      if (!access || !venueId || seenVenues.has(venueId)) continue;
      seenVenues.add(venueId);
      const mine = await ctx.db
        .query("visits")
        .withIndex("by_owner_venue_history", (q) => q.eq("owner", owner).eq("venueId", venueId))
        .first();
      if (!mine) continue;
      const city = (await ctx.db.get("museums", venueId))?.city;
      museums.push({ venueId, name: access.visit.venueName, ...(city ? { city } : {}) });
    }
    return { artworks, museums };
  },
});

export const dismiss = mutation({
  args: { profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    const { profile, accountId } = await requireProfile(ctx);
    if (profileId === profile._id) throw new ConvexError({ code: "invalid_relationship" });
    if (await findDismissal(ctx, profile._id, profileId)) return null;
    await limitKey(ctx, "relationshipChange", accountId);
    await ctx.db.insert("suggestionDismissals", { profileId: profile._id, dismissedId: profileId });
    return null;
  },
});

export const restore = mutation({
  args: { profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    const { profile } = await requireProfile(ctx);
    const row = await findDismissal(ctx, profile._id, profileId);
    if (row) await ctx.db.delete("suggestionDismissals", row._id);
    return null;
  },
});

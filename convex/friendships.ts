import { ConvexError, v } from "convex/values";
import { isRevision, LIMITS } from "../shared/journal/limits";
import { relationship as state } from "../shared/social/contracts";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { activeProfile, requireProfile } from "./lib/ownership";
import {
  acceptedRelationships,
  canonicalPair,
  checkRevision,
  relationshipSnapshot,
} from "./lib/friendships";
import { limitKey } from "./lib/rateLimits";

const args = { profileId: v.id("profiles"), revision: v.number() };
// Revocations stay available after the counterpart is removed so a stale edge cannot hold a friend slot.
async function participants(ctx: QueryCtx, profileId: Id<"profiles">, revocation = false) {
  const actor = await requireProfile(ctx);
  if (actor.profile._id === profileId) throw new ConvexError({ code: "invalid_relationship" });
  const other = revocation ? await ctx.db.get(profileId) : await activeProfile(ctx, profileId);
  if (!other) throw new ConvexError({ code: "not_found" });
  return actor;
}
export const getState = query({
  args: { profileId: v.id("profiles") },
  returns: state,
  handler: async (ctx, { profileId }) => {
    const { profile } = await participants(ctx, profileId);
    return (await relationshipSnapshot(ctx, profile._id, profileId)).state;
  },
});

function transition(operation: "request" | "accept" | "decline" | "cancel" | "remove") {
  return mutation({
    args,
    returns: state,
    handler: async (ctx, { profileId, revision }) => {
      const { profile, accountId } = await participants(
        ctx,
        profileId,
        operation !== "request" && operation !== "accept",
      );
      const snapshot = await relationshipSnapshot(ctx, profile._id, profileId);
      const { edge, block, reverseBlock } = snapshot;
      if (!isRevision(revision)) throw new ConvexError({ code: "invalid_relationship" });
      // Repeating a completed revocation cannot restore access or consume a quota.
      if (["decline", "cancel", "remove"].includes(operation) && edge?.state === "none")
        return snapshot.state;
      checkRevision(revision, edge?.revision ?? 0);
      if (block?.active || reverseBlock?.active) throw new ConvexError({ code: "not_found" });
      let next: "pending" | "accepted" | "none";
      if (operation === "request") {
        if (edge?.state === "pending" && edge.requesterId === profile._id) return snapshot.state;
        if (edge && edge.state !== "none") throw new ConvexError({ code: "invalid_relationship" });
        next = "pending";
      } else if (operation === "remove") {
        if (edge?.state !== "accepted") throw new ConvexError({ code: "invalid_relationship" });
        next = "none";
      } else {
        if (
          edge?.state !== "pending" ||
          (operation === "cancel") !== (edge.requesterId === profile._id)
        ) {
          throw new ConvexError({ code: "invalid_relationship" });
        }
        next = operation === "accept" ? "accepted" : "none";
      }
      if (next === "accepted") {
        for (const id of [profile._id, profileId]) {
          if ((await acceptedRelationships(ctx, id)).length >= LIMITS.friends)
            throw new ConvexError({ code: "friend_limit" });
        }
      }
      await limitKey(
        ctx,
        operation === "request" ? "friendRequest" : "relationshipChange",
        accountId,
      );
      const [firstProfileId, secondProfileId] = canonicalPair(profile._id, profileId);
      const fields = {
        firstProfileId,
        secondProfileId,
        requesterId: operation === "request" ? profile._id : edge!.requesterId,
        state: next,
        revision: (edge?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      };
      if (edge) await ctx.db.patch(edge._id, fields);
      else await ctx.db.insert("friendships", fields);
      return (await relationshipSnapshot(ctx, profile._id, profileId)).state;
    },
  });
}
export const request = transition("request");
export const accept = transition("accept");
export const decline = transition("decline");
export const cancel = transition("cancel");
export const remove = transition("remove");

export const block = mutation({
  args: { ...args, blockRevision: v.number() },
  returns: state,
  handler: async (ctx, { profileId, revision, blockRevision }) => {
    const { profile, accountId } = await participants(ctx, profileId, true);
    const snapshot = await relationshipSnapshot(ctx, profile._id, profileId);
    checkRevision(blockRevision, snapshot.block?.revision ?? 0);
    checkRevision(revision, snapshot.edge?.revision ?? 0);
    if (snapshot.block?.active) return snapshot.state;
    await limitKey(ctx, "relationshipChange", accountId);
    const fields = {
      blockerId: profile._id,
      blockedId: profileId,
      active: true,
      revision: blockRevision + 1,
    };
    if (snapshot.block) await ctx.db.patch(snapshot.block._id, fields);
    else await ctx.db.insert("blocks", fields);
    const [firstProfileId, secondProfileId] = canonicalPair(profile._id, profileId);
    const edge = {
      firstProfileId,
      secondProfileId,
      requesterId: snapshot.edge?.requesterId ?? profile._id,
      state: "none" as const,
      revision: revision + 1,
      updatedAt: Date.now(),
    };
    if (snapshot.edge) await ctx.db.patch(snapshot.edge._id, edge);
    else await ctx.db.insert("friendships", edge);
    return (await relationshipSnapshot(ctx, profile._id, profileId)).state;
  },
});
export const unblock = mutation({
  args: { profileId: v.id("profiles"), blockRevision: v.number() },
  returns: state,
  handler: async (ctx, { profileId, blockRevision }) => {
    const { profile, accountId } = await participants(ctx, profileId, true);
    const snapshot = await relationshipSnapshot(ctx, profile._id, profileId);
    if (!isRevision(blockRevision)) throw new ConvexError({ code: "invalid_relationship" });
    if (!snapshot.block?.active) return snapshot.state;
    checkRevision(blockRevision, snapshot.block.revision);
    await limitKey(ctx, "relationshipChange", accountId);
    await ctx.db.patch(snapshot.block._id, { active: false, revision: blockRevision + 1 });
    return (await relationshipSnapshot(ctx, profile._id, profileId)).state;
  },
});

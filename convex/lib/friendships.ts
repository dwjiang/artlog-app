import { ConvexError } from "convex/values";

import { isRevision, LIMITS } from "../../shared/journal/limits";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const canonicalPair = (a: Id<"profiles">, b: Id<"profiles">) => (a < b ? ([a, b] as const) : ([b, a] as const));
export function checkRevision(observed: number, current: number) {
  if (!isRevision(observed)) {
    throw new ConvexError({ code: "invalid_relationship" });
  }
  if (observed !== current) throw new ConvexError({ code: "conflict" });
}
export function findRelationship(ctx: QueryCtx, a: Id<"profiles">, b: Id<"profiles">) {
  const [first, second] = canonicalPair(a, b);
  return ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("firstProfileId", first).eq("secondProfileId", second))
    .unique();
}
export function findBlock(ctx: QueryCtx, blockerId: Id<"profiles">, blockedId: Id<"profiles">) {
  return ctx.db
    .query("blocks")
    .withIndex("by_pair", (q) => q.eq("blockerId", blockerId).eq("blockedId", blockedId))
    .unique();
}
export async function relationshipSnapshot(ctx: QueryCtx, actor: Id<"profiles">, other: Id<"profiles">) {
  const [edge, block, reverseBlock] = await Promise.all([
    findRelationship(ctx, actor, other),
    findBlock(ctx, actor, other),
    findBlock(ctx, other, actor),
  ]);
  return {
    edge,
    block,
    reverseBlock,
    state: {
      state: edge?.state ?? "none",
      revision: edge?.revision ?? 0,
      requesterId: edge?.state === "pending" ? edge.requesterId : null,
      blocked: block?.active ?? false,
      blockRevision: block?.revision ?? 0,
    },
  };
}
export async function acceptedRelationships(ctx: QueryCtx, profileId: Id<"profiles">) {
  const [first, second] = await Promise.all([
    ctx.db
      .query("friendships")
      .withIndex("by_first_state", (q) => q.eq("firstProfileId", profileId).eq("state", "accepted"))
      .take(LIMITS.friends + 1),
    ctx.db
      .query("friendships")
      .withIndex("by_second_state", (q) => q.eq("secondProfileId", profileId).eq("state", "accepted"))
      .take(LIMITS.friends + 1),
  ]);
  return [...first, ...second];
}

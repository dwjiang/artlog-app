import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { findBlock } from "./friendships";
import { activeProfile } from "./ownership";

export function engagement(ctx: QueryCtx, publicationId: Id<"sharedVisits">) {
  return ctx.db
    .query("visitEngagement")
    .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
    .unique();
}

export async function changeEngagement(
  ctx: MutationCtx,
  publicationId: Id<"sharedVisits">,
  field: "likeCount" | "commentCount",
  delta: number,
) {
  const current = await engagement(ctx, publicationId);
  if (current) {
    await ctx.db.patch(current._id, {
      [field]: Math.max(0, current[field] + delta),
    });
  } else if (delta > 0) {
    await ctx.db.insert("visitEngagement", {
      publicationId,
      likeCount: 0,
      commentCount: 0,
      [field]: delta,
    });
  }
}

// The visit's author is checked alongside the viewer so a block also hides the participant from everyone else reading that visit.
export async function visibleParticipant(
  ctx: QueryCtx,
  profileId: Id<"profiles">,
  others: (Id<"profiles"> | undefined)[],
) {
  const profile = await activeProfile(ctx, profileId);
  if (!profile) return null;
  for (const other of new Set(others)) {
    if (!other || other === profileId) continue;
    if (
      (await findBlock(ctx, profileId, other))?.active
      || (await findBlock(ctx, other, profileId))?.active
    ) {
      return null;
    }
  }
  return profile;
}

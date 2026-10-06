import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function findDismissal(ctx: QueryCtx, profileId: Id<"profiles">, dismissedId: Id<"profiles">) {
  return ctx.db
    .query("suggestionDismissals")
    .withIndex("by_profile_dismissed", (q) => q.eq("profileId", profileId).eq("dismissedId", dismissedId))
    .unique();
}

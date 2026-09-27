import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export function readContributionState(ctx: QueryCtx, objectId: Id<"objects">) {
  return ctx.db
    .query("objectContributionState")
    .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
    .unique();
}

export async function patchContributionState(
  ctx: MutationCtx,
  objectId: Id<"objects">,
  patch: Partial<Pick<Doc<"objectContributionState">, "groupKey" | "flaggedForReview" | "userCreated">>,
) {
  const existing = await readContributionState(ctx, objectId);
  if (existing) {
    await ctx.db.patch("objectContributionState", existing._id, patch);
  } else {
    const object = await ctx.db.get("objects", objectId);
    if (!object) throw new Error("Object not found");
    await ctx.db.insert("objectContributionState", {
      objectId,
      userCreated: object.source === "user",
      flaggedForReview: false,
      ...patch,
    });
  }
}

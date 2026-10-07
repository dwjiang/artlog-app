import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deactivateWallItem(
  ctx: MutationCtx,
  item: Doc<"wallItems">,
  removal?: NonNullable<Doc<"wallItems">["removal"]>,
): Promise<void> {
  await ctx.db.patch("wallItems", item._id, {
    active: false,
    ...(removal ? { removal } : {}),
  });
  const wall = await ctx.db.get("walls", item.wallId);
  if (wall) {
    await ctx.db.patch("walls", wall._id, { layoutRevision: wall.layoutRevision + 1 });
  }
  if (item.active) {
    const profile = await ctx.db.get("profiles", item.profileId);
    if (profile) {
      await ctx.db.patch("profiles", profile._id, {
        publishedWallCount: Math.max(0, profile.publishedWallCount - 1),
      });
    }
  }
}

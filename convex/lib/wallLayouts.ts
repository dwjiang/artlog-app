import { ConvexError, type Infer, v } from "convex/values";

import type { JournalOwner } from "../../shared/journal/contracts";
import { isWallColor, validateWallItems, wallLayout, wallPattern } from "../../shared/social/contracts";
import { DEFAULT_WALL_COLOR } from "../../shared/wall/defaults";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ownedAlbumPhoto } from "./albumMedia";
import { contributionSource, resolveDisplayAsset } from "./displayMedia";
import { requireOwnedSave } from "./ownership";
import { activeWallItems } from "./publicWall";

export const wallSelection = v.object({
  placementId: v.string(),
  photoLocalId: v.optional(v.string()),
  saveLocalId: v.string(),
  layout: wallLayout,
});
export const wallEdit = v.object({
  revision: v.number(),
  color: v.string(),
  pattern: v.optional(wallPattern),
  items: v.array(wallSelection),
});

const sameLayout = (a: Infer<typeof wallLayout>, b: Infer<typeof wallLayout>) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.layer === b.layer && a.frame === b.frame;

/** Both the owner editor and demo publishing use the same ownership, revision and layout rules. */
export async function setWallLayout(
  ctx: MutationCtx,
  { profile, owner }: { profile: Doc<"profiles">; owner: JournalOwner },
  input: Infer<typeof wallEdit>,
) {
  validateWallItems(input.items, input.revision);
  if (!isWallColor(input.color)) {
    throw new ConvexError({ code: "invalid_wall" });
  }
  const color = input.color.toUpperCase();
  const selected = await Promise.all(
    input.items.map(async (item) => {
      const save = await requireOwnedSave(ctx, owner, item.saveLocalId);
      if (item.photoLocalId) {
        await ownedAlbumPhoto(ctx, save, item.photoLocalId);
      }
      return { ...item, save };
    }),
  );
  const wall = await ctx.db
    .query("walls")
    .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
    .unique();
  const previous = await activeWallItems(ctx, wall);
  const unchanged =
    color === (wall?.color ?? DEFAULT_WALL_COLOR)
    && input.pattern === wall?.pattern
    && previous.length === selected.length
    && selected.every((item) =>
      previous.some(
        (old) =>
          old.placementId === item.placementId
          && old.saveId === item.save._id
          && old.photoLocalId === item.photoLocalId
          && sameLayout(old.layout, item.layout),
      ),
    );
  if (!unchanged && input.revision !== (wall?.layoutRevision ?? 0)) {
    throw new ConvexError({ code: "conflict" });
  }
  const wallId =
    wall?._id
    ?? (await ctx.db.insert("walls", {
      profileId: profile._id,
      color,
      pattern: input.pattern,
      layoutRevision: 0,
    }));
  if (unchanged) return "unchanged" as const;
  const selectedIds = new Set(selected.map((item) => item.placementId));
  for (const item of previous) {
    if (!selectedIds.has(item.placementId)) {
      await ctx.db.patch("wallItems", item._id, { active: false });
    }
  }
  for (const item of selected) {
    const existing = await ctx.db
      .query("wallItems")
      .withIndex("by_wall_placement", (q) => q.eq("wallId", wallId).eq("placementId", item.placementId))
      .unique();
    if (existing && existing.saveId !== item.save._id) {
      throw new ConvexError({ code: "invalid_wall" });
    }
    if (existing) {
      await ctx.db.patch("wallItems", existing._id, {
        photoLocalId: item.photoLocalId,
        layout: item.layout,
        active: true,
      });
    } else {
      await ctx.db.insert("wallItems", {
        wallId,
        profileId: profile._id,
        saveId: item.save._id,
        saveLocalId: item.saveLocalId,
        placementId: item.placementId,
        photoLocalId: item.photoLocalId,
        layout: item.layout,
        active: true,
      });
    }
    if (!(await resolveDisplayAsset(ctx, item.save)) && (await contributionSource(ctx, item.save))) {
      await ctx.scheduler.runAfter(0, internal.displayMediaPrepare.prepare, {
        saveId: item.save._id,
      });
    }
  }
  await ctx.db.patch("walls", wallId, {
    color,
    pattern: input.pattern,
    layoutRevision: (wall?.layoutRevision ?? 0) + 1,
  });
  await ctx.db.patch("profiles", profile._id, { publishedWallCount: selected.length });
  return "updated" as const;
}

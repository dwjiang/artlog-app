import { ConvexError, type Infer, v } from "convex/values";

import { sameOwner } from "../../shared/journal/contracts";
import { LIMITS } from "../../shared/journal/limits";
import { wallPattern } from "../../shared/social/contracts";
import { DEFAULT_WALL_COLOR, WALL_COLORS } from "../../shared/wall/defaults";
import { FULL_FRAME_WIDTH, WALL_FRAMES } from "../../shared/wall/frames";
import { REFERENCE_WALL_WIDTH, WALL_LABEL_GAP, WALL_SIDE_GAP } from "../../shared/wall/spacing";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ownedAlbumPhoto } from "./albumMedia";
import { readablePublication } from "./publicationAccess";
import { activeWallItems, publicWallProjection } from "./publicWall";
import { setWallLayout, type wallEdit } from "./wallLayouts";

// Style identifiers come from the current catalog, so adding a style does not change the bot API's types.
const layout = v.object({ x: v.number(), y: v.number(), width: v.number(), layer: v.number(), frame: v.string() });
export const demoWallPlan = v.object({
  revision: v.number(),
  color: v.string(),
  pattern: v.string(),
  items: v.array(v.object({ key: v.string(), layout })),
});
export const demoWallStatus = v.union(
  v.literal("updated"),
  v.literal("unchanged"),
  v.literal("stale"),
  v.literal("unavailable"),
);
export const demoWallContext = v.object({
  revision: v.number(),
  color: v.string(),
  pattern: v.string(),
  catalog: v.object({
    colors: v.array(v.string()),
    patterns: v.array(v.string()),
    // `border` is the frame's full border width in points.
    frames: v.array(v.object({ value: v.string(), border: v.number() })),
    maxItems: v.number(),
  }),
  // How the owner editor measures a layout, so the bot can keep artworks and their labels apart.
  geometry: v.object({
    wallWidth: v.number(),
    fullFrameWidth: v.number(),
    sideGap: v.number(),
    labelGap: v.number(),
  }),
  items: v.array(
    v.object({
      key: v.string(),
      title: v.string(),
      artist: v.string(),
      aspectRatio: v.number(),
      layout: v.optional(layout),
    }),
  ),
});
const catalog = () => ({
  colors: WALL_COLORS.map((item) => item.value),
  patterns: ["plain", ...wallPattern.members.map((item) => item.value)],
  frames: WALL_FRAMES.map((item) => ({ value: item.value, border: item.width })),
  maxItems: LIMITS.wallItems,
});
const geometry = {
  wallWidth: REFERENCE_WALL_WIDTH,
  fullFrameWidth: FULL_FRAME_WIDTH,
  sideGap: WALL_SIDE_GAP,
  labelGap: WALL_LABEL_GAP,
};
type Candidate = Infer<typeof demoWallContext>["items"][number] & {
  saveLocalId: string;
  photoLocalId?: string;
  placementId?: string;
};

async function wallSources(ctx: QueryCtx, profile: Doc<"profiles">) {
  const owner = { kind: "account" as const, accountId: profile.accountId };
  const wall = await ctx.db
    .query("walls")
    .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
    .unique();
  const items = new Map<string, Candidate>();
  const shown = new Set<string>();
  for (const item of await activeWallItems(ctx, wall)) {
    const current = await publicWallProjection(ctx, item);
    if (!current) continue;
    const { media } = current.projection.artwork;
    const key = `wall:${item.placementId}`;
    items.set(key, {
      key,
      title: current.save.snapshot.title,
      artist: current.save.snapshot.artist,
      aspectRatio: media.width / media.height,
      layout: item.layout,
      placementId: item.placementId,
      saveLocalId: item.saveLocalId,
      photoLocalId: item.photoLocalId,
    });
    shown.add(item.saveLocalId);
  }
  // Only already-public visit photos are offered for additions to the public profile wall.
  const posts = await ctx.db
    .query("sharedVisits")
    .withIndex("by_profile_publishedAt", (q) => q.eq("profileId", profile._id))
    .order("desc")
    .take(10);
  for (const post of posts) {
    if (post.audience !== "public" || !(await readablePublication(ctx, post))) continue;
    for (const item of await ctx.db
      .query("sharedVisitItems")
      .withIndex("by_publication_position", (q) => q.eq("publicationId", post._id))
      .take(LIMITS.selectedSaves)) {
      if (shown.has(item.saveLocalId)) continue;
      const save = await ctx.db.get("collections", item.saveId);
      if (!save || save.deletedAt !== undefined || !sameOwner(save.owner, owner)) continue;
      const photoLocalId = item.photoLocalIds?.[0];
      if (!photoLocalId) continue;
      let photo;
      try {
        photo = await ownedAlbumPhoto(ctx, save, photoLocalId);
      } catch (error) {
        if (error instanceof ConvexError && error.data.code === "not_found") continue;
        throw error;
      }
      if (!photo.storageId) continue;
      const key = `save:${save.localId}`;
      items.set(key, {
        key,
        title: save.snapshot.title,
        artist: save.snapshot.artist,
        aspectRatio: (photo.width ?? 1) / (photo.height ?? 1),
        saveLocalId: save.localId,
        photoLocalId,
      });
      shown.add(save.localId);
    }
  }
  return { wall, items };
}

export async function readDemoWall(ctx: QueryCtx, profile: Doc<"profiles">): Promise<Infer<typeof demoWallContext>> {
  const { wall, items } = await wallSources(ctx, profile);
  return {
    revision: wall?.layoutRevision ?? 0,
    color: wall?.color ?? DEFAULT_WALL_COLOR,
    pattern: wall?.pattern ?? "plain",
    catalog: catalog(),
    geometry,
    items: [...items.values()].map(({ saveLocalId: _, photoLocalId: __, placementId: ___, ...item }) => item),
  };
}

/** A stale draft may publish its visit, but cannot replace a more recent wall or restore a retired style. */
export async function applyDemoWall(
  ctx: MutationCtx,
  profile: Doc<"profiles">,
  plan: Infer<typeof demoWallPlan>,
  additions: { objectKey: string; saveLocalId: string; photoLocalId: string }[],
): Promise<Infer<typeof demoWallStatus>> {
  if (
    !Number.isSafeInteger(plan.revision)
    || plan.revision < 0
    || plan.items.length === 0
    || plan.items.length > LIMITS.wallItems
    || new Set(plan.items.map((item) => item.key)).size !== plan.items.length
  ) {
    throw new ConvexError({ code: "invalid_wall" });
  }
  const { wall, items } = await wallSources(ctx, profile);
  if (plan.revision !== (wall?.layoutRevision ?? 0)) return "stale";
  const choices = catalog();
  const pattern = wallPattern.members.find((item) => item.value === plan.pattern)?.value;
  if (
    !choices.colors.some((value) => value === plan.color.toUpperCase())
    || (plan.pattern !== "plain" && !pattern)
    || plan.items.some((item) => !choices.frames.some((frame) => frame.value === item.layout.frame))
  ) {
    return "unavailable";
  }
  const selected: Infer<typeof wallEdit>["items"] = [];
  for (const item of plan.items) {
    const existing = items.get(item.key);
    const addition = additions.find((save) => item.key === `post:${save.objectKey}`);
    const source = existing ?? addition;
    if (!source) throw new ConvexError({ code: "invalid_wall" });
    const frame = WALL_FRAMES.find((finish) => finish.value === item.layout.frame)!;
    selected.push({
      placementId: existing?.placementId ?? crypto.randomUUID(),
      saveLocalId: source.saveLocalId,
      photoLocalId: source.photoLocalId,
      layout: { ...item.layout, frame: frame.value },
    });
  }
  return setWallLayout(
    ctx,
    { profile, owner: { kind: "account", accountId: profile.accountId } },
    {
      revision: plan.revision,
      color: plan.color,
      pattern,
      items: selected,
    },
  );
}

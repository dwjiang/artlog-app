import { v } from "convex/values";

import { catalogMedia } from "../shared/social/contracts";
import { normalizeHashtag, normalizeTagPrefix } from "../shared/social/hashtags";
import { isOffensive } from "../shared/social/offensive-text";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { resolveDisplayAsset } from "./lib/displayMedia";
import { withErrorReporting } from "./lib/observability";
import { tagStats } from "./lib/postTags";
import { projectArtwork } from "./lib/projections";
import { readablePublication } from "./lib/publicationAccess";
import { publicationItems, readHeadroom } from "./lib/sharedPublications";
import { engagement } from "./lib/visitReactions";

const tagSummary = v.object({ tag: v.string(), postCount: v.number() });
const popularTag = v.object({ ...tagSummary.fields, cover: v.optional(catalogMedia) });
const SUGGESTIONS = 8;
// Prefix matches come back alphabetically; the busiest of the first few dozen lead.
const PREFIX_SCAN = 50;
const POPULAR = 6;
// Cover scans also share the transaction's read budget; optional images must not prevent the weekly tag pick.
const COVER_SCAN = 100;

const publicCount = async (ctx: Parameters<typeof tagStats>[0], tag: string) =>
  (await tagStats(ctx, tag))?.publicCount ?? 0;
const byCount = (a: { tag: string; count: number }, b: { tag: string; count: number }) =>
  b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);

/** A tag page's heading; null for text that can't be a tag or a tag that never gets a page. */
export const get = query({
  args: { tag: v.string() },
  returns: v.union(tagSummary, v.null()),
  handler: async (ctx, { tag }) => {
    const normalized = normalizeHashtag(tag);
    if (!normalized || isOffensive(normalized)) return null;
    return { tag: normalized, postCount: await publicCount(ctx, normalized) };
  },
});

/** Tags in public posts that start with `prefix`, busiest first, for search and the composer's suggestions. */
export const search = query({
  args: { prefix: v.string() },
  returns: v.array(tagSummary),
  handler: async (ctx, { prefix }) => {
    const start = normalizeTagPrefix(prefix.replace(/^#/, ""));
    if (!start) return [];
    const stats = await ctx.db
      .query("tagStats")
      .withIndex("by_tag", (q) => q.gte("tag", start).lt("tag", `${start}￿`))
      .take(PREFIX_SCAN);
    return stats
      .map((row) => ({ tag: row.tag, count: row.publicCount }))
      .sort(byCount)
      .slice(0, SUGGESTIONS)
      .map(({ tag, count }) => ({ tag, postCount: count }));
  },
});

/** Search's popular tags as of the last weekly pick, with live public counts and their catalog cover images. */
export const popular = query({
  args: {},
  returns: v.array(popularTag),
  handler: async (ctx) => {
    const picks = await ctx.db.query("popularTags").withIndex("by_rank").take(POPULAR);
    const tags = [];
    for (const { tag, coverSaveId } of picks) {
      const postCount = await publicCount(ctx, tag);
      // Every public post may have been withdrawn since the pick, and its page would be empty.
      if (postCount === 0) continue;
      // Resolved on read, so a takedown or a deleted save drops the image before the next pick.
      const cover = coverSaveId && (await catalogImage(ctx, coverSaveId));
      tags.push({ tag, postCount, ...(cover ? { cover } : {}) });
    }
    return tags;
  },
});

export const refreshPopular = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx): Promise<null> =>
    withErrorReporting("tags.refreshPopular", () => ctx.runMutation(internal.tags.pickPopular, {})),
});

/** Replaces the popular tags with the busiest public tags of all time, each covered from its most-liked public post. */
export const pickPopular = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const busiest = await ctx.db
      .query("tagStats")
      .withIndex("by_public_count", (q) => q.gt("publicCount", 0))
      .order("desc")
      .take(POPULAR * 3);
    const top = busiest
      .map((row) => ({ tag: row.tag, count: row.publicCount }))
      .sort(byCount)
      .slice(0, POPULAR);
    for (const row of await ctx.db.query("popularTags").take(POPULAR * 3)) {
      await ctx.db.delete("popularTags", row._id);
    }
    // In rank order, so a busier tag keeps its first choice when two tags share a post.
    const taken = new Set<string>();
    for (const [rank, { tag }] of top.entries()) {
      const cover = await mostLikedCover(ctx, tag, taken);
      if (cover) taken.add(cover.url);
      await ctx.db.insert("popularTags", { tag, rank, ...(cover ? { coverSaveId: cover.saveId } : {}) });
    }
    return null;
  },
});

// Covers are museum catalog images only: a personal photo is authorized per viewer, which a weekly pick can't do.
async function catalogImage(ctx: QueryCtx, saveId: Id<"collections">) {
  const save = await ctx.db.get("collections", saveId);
  if (!save) return undefined;
  const { media } = projectArtwork(save, await resolveDisplayAsset(ctx, save));
  return media.kind === "catalog" ? media : undefined;
}

/** A catalog image from the tag's most-liked public post, preferring one a busier tag doesn't already show. */
async function mostLikedCover(ctx: QueryCtx, tag: string, taken: Set<string>) {
  if (!(await readHeadroom(ctx))) return undefined;
  const rows = await ctx.db
    .query("postTags")
    .withIndex("by_tag_history", (q) => q.eq("tag", tag))
    .order("desc")
    .take(COVER_SCAN);
  const posts = [];
  for (const row of rows) {
    if (!(await readHeadroom(ctx))) break;
    const publication = row.public ? await ctx.db.get("sharedVisits", row.publicationId) : null;
    if (publication && (await readablePublication(ctx, publication))) {
      posts.push({ publication, likes: (await engagement(ctx, publication._id))?.likeCount ?? 0 });
    }
  }
  // Rows arrive newest visit first and the sort is stable, so the newer post wins a tie.
  posts.sort((a, b) => b.likes - a.likes);
  let repeat;
  for (const { publication } of posts) {
    if (!(await readHeadroom(ctx))) break;
    for (const item of await publicationItems(ctx, publication._id)) {
      if (!item.highlighted) continue;
      if (!(await readHeadroom(ctx))) return repeat;
      const cover = { saveId: item.saveId, url: (await catalogImage(ctx, item.saveId))?.url };
      if (!cover.url) continue;
      if (!taken.has(cover.url)) return { saveId: cover.saveId, url: cover.url };
      repeat ??= { saveId: cover.saveId, url: cover.url };
    }
  }
  return repeat;
}

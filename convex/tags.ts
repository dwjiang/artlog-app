import { v } from "convex/values";

import { normalizeHashtag, normalizeTagPrefix } from "../shared/social/hashtags";
import { isOffensive } from "../shared/social/offensive-text";
import { query } from "./_generated/server";
import { tagStats } from "./lib/postTags";

const tagSummary = v.object({ tag: v.string(), postCount: v.number() });
const SUGGESTIONS = 8;
// Prefix matches come back alphabetically; the busiest of the first few dozen lead.
const PREFIX_SCAN = 50;
const POPULAR = 10;
const POPULAR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const POPULAR_SCAN = 1000;

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

/** The tags most used in public posts published over the past week, with their all-time public counts. */
export const popular = query({
  args: { asOf: v.number() },
  returns: v.array(tagSummary),
  handler: async (ctx, { asOf }) => {
    const rows = await ctx.db
      .query("postTags")
      .withIndex("by_public_published", (q) => q.eq("public", true).gte("publishedAt", asOf - POPULAR_WINDOW_MS))
      .order("desc")
      .take(POPULAR_SCAN);
    const weekly = new Map<string, number>();
    for (const row of rows) weekly.set(row.tag, (weekly.get(row.tag) ?? 0) + 1);
    const top = [...weekly]
      .map(([tag, count]) => ({ tag, count }))
      .sort(byCount)
      .slice(0, POPULAR);
    return Promise.all(top.map(async ({ tag }) => ({ tag, postCount: await publicCount(ctx, tag) })));
  },
});

import { v } from "convex/values";

import { catalogSearchText } from "../shared/catalog/text";
import { pageArgs, pagination } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, query, type QueryCtx } from "./_generated/server";
import { catalogArtworkPage, projectCatalogArtwork } from "./artworks";
import { internalMutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { withErrorReporting } from "./lib/observability";

const SEARCH_RESULTS = 3;
// Most of an artist's first works have a picture; an artist whose first dozen don't gets the person glyph.
const COVER_SCAN = 12;
const COVER_PAGE = 200;
// Each artist can resolve 12 works × 8 objects plus proposal evidence; keep the batch below 4,096 reads.
const ASSIGN_PAGE = 2;
// Every distinct saved work can resolve eight objects and their proposal evidence in the same transaction.
const SAVES_PAGE = 20;
// One cover can resolve eight objects with proposal evidence; leave room for that and the remaining artists.
const COVER_READ_RESERVE = 256;

export const artistSummary = v.object({
  artistId: v.id("artists"),
  name: v.string(),
  workCount: v.number(),
  coverUrl: v.optional(v.string()),
});

async function pictureOf(
  ctx: QueryCtx,
  artworkId: Id<"artworks">,
  artistKey: string,
  bounded = false,
): Promise<string | undefined> {
  if (bounded && (await ctx.meta.getTransactionMetrics()).databaseQueries.remaining < COVER_READ_RESERVE) {
    return undefined;
  }
  const artwork = await ctx.db.get("artworks", artworkId);
  if (artwork?.rightsStatus !== "public_domain" || artwork.artistKey !== artistKey) return undefined;
  return (await projectCatalogArtwork(ctx, artwork))?.thumbnailUrl;
}

/** The artist's avatar: the monthly most-saved pick, else their first catalog work with a public-domain picture. */
async function findCover(
  ctx: QueryCtx,
  key: string,
  bounded = false,
): Promise<{ artworkId: Id<"artworks">; url: string } | null> {
  const pick = await ctx.db
    .query("artistCovers")
    .withIndex("by_artistKey", (q) => q.eq("artistKey", key))
    .first();
  const picked = pick && (await pictureOf(ctx, pick.artworkId, key, bounded));
  if (picked) return { artworkId: pick.artworkId, url: picked };
  const works = await ctx.db
    .query("artworks")
    .withIndex("by_artistKey", (q) => q.eq("artistKey", key))
    .take(COVER_SCAN);
  for (const artwork of works) {
    const url = await pictureOf(ctx, artwork._id, key, bounded);
    if (url) return { artworkId: artwork._id, url };
  }
  return null;
}

// The stored cover still resolves on read, so takedowns and rights changes apply at once.
async function coverUrl(ctx: QueryCtx, artist: Doc<"artists">): Promise<string | undefined> {
  if (artist.coverArtworkId === null) return undefined;
  const stored = artist.coverArtworkId && (await pictureOf(ctx, artist.coverArtworkId, artist.key, true));
  return stored || (await findCover(ctx, artist.key, true))?.url;
}

async function summarize(ctx: QueryCtx, artist: Doc<"artists">) {
  const cover = await coverUrl(ctx, artist);
  return {
    artistId: artist._id,
    name: artist.name,
    workCount: artist.workCount,
    ...(cover ? { coverUrl: cover } : {}),
  };
}

/** Artists whose name has every word of the query, best match first. */
export async function searchArtists(ctx: QueryCtx, query: string) {
  const text = catalogSearchText(query);
  if (!text) return [];
  const matches = await ctx.db
    .query("artists")
    .withSearchIndex("search_key", (q) => q.search("key", text))
    .take(SEARCH_RESULTS);
  const artists = [];
  for (const artist of matches) artists.push(await summarize(ctx, artist));
  return artists;
}

// Installed builds that read artists apart from catalog.search still call this.
export const search = query({
  args: { query: v.string() },
  returns: v.array(artistSummary),
  handler: async (ctx, input) => {
    await requireDevice(ctx);
    return searchArtists(ctx, input.query);
  },
});

export const get = query({
  args: { artistId: v.id("artists") },
  returns: v.union(v.null(), artistSummary.extend({ key: v.string() })),
  handler: async (ctx, { artistId }) => {
    await requireDevice(ctx);
    const artist = await ctx.db.get("artists", artistId);
    return artist && { ...(await summarize(ctx, artist)), key: artist.key };
  },
});

/** The artist's catalog works in the order the catalog gained them. */
export const works = query({
  args: { artistId: v.id("artists"), ...pageArgs },
  returns: catalogArtworkPage,
  handler: async (ctx, input) => {
    await requireDevice(ctx);
    const options = pagination(input);
    const artist = await ctx.db.get("artists", input.artistId);
    if (!artist) return { page: [], cursor: null, isDone: true };
    const result = await ctx.db
      .query("artworks")
      .withIndex("by_artistKey", (q) => q.eq("artistKey", artist.key))
      .paginate(options);
    const page = [];
    for (const artwork of result.page) {
      const shown = await projectCatalogArtwork(ctx, artwork);
      if (shown) page.push(shown);
    }
    return { page, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
  },
});

const savedWork = v.object({ artworkId: v.id("artworks"), saves: v.number() });

/**
 * Monthly: picks each artist's most-saved work that has a public-domain picture, then stores the avatars search reads.
 */
export const refreshCovers = internalAction({
  args: {
    phase: v.optional(v.union(v.literal("clear"), v.literal("tally"), v.literal("assign"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    // The artwork the previous page of saves ended inside, with its saves so far.
    open: v.optional(savedWork),
  },
  returns: v.null(),
  handler: (ctx, { phase = "clear", cursor = null, open }) =>
    withErrorReporting("artists.refreshCovers", async () => {
      if (phase === "clear") {
        const done = await ctx.runMutation(internal.artists.clearCovers, {});
        await ctx.scheduler.runAfter(0, internal.artists.refreshCovers, { phase: done ? "tally" : "clear" });
        return null;
      }
      if (phase === "assign") {
        const page = await ctx.runMutation(internal.artists.assignCovers, { cursor });
        if (!page.isDone) {
          await ctx.scheduler.runAfter(0, internal.artists.refreshCovers, { phase, cursor: page.cursor });
        }
        return null;
      }
      const page = await ctx.runMutation(internal.artists.tallyCovers, { cursor, open });
      await ctx.scheduler.runAfter(
        0,
        internal.artists.refreshCovers,
        page.isDone ? { phase: "assign" } : { phase, cursor: page.cursor, open: page.open ?? undefined },
      );
      return null;
    }),
});

export const clearCovers = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("artistCovers").take(COVER_PAGE);
    for (const row of rows) await ctx.db.delete("artistCovers", row._id);
    return rows.length < COVER_PAGE;
  },
});

// Saves arrive grouped by artwork (the index orders them so), so a page's last artwork may continue on the next.
export const tallyCovers = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), open: v.optional(savedWork) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean(), open: v.union(savedWork, v.null()) }),
  handler: async (ctx, { cursor, open }) => {
    const page = await ctx.db
      .query("collections")
      .withIndex("by_artwork_deletedAt")
      .paginate({ cursor, numItems: SAVES_PAGE });
    let current = open ?? null;
    const finished: { artworkId: Id<"artworks">; saves: number }[] = [];
    for (const save of page.page) {
      if (!save.artworkId || save.deletedAt !== undefined) continue;
      if (current?.artworkId === save.artworkId) {
        current.saves++;
        continue;
      }
      if (current) finished.push(current);
      current = { artworkId: save.artworkId, saves: 1 };
    }
    if (page.isDone && current) finished.push(current);
    for (const { artworkId, saves } of finished) {
      const artwork = await ctx.db.get("artworks", artworkId);
      if (!artwork?.artistKey) continue;
      const { artistKey } = artwork;
      const pick = await ctx.db
        .query("artistCovers")
        .withIndex("by_artistKey", (q) => q.eq("artistKey", artistKey))
        .first();
      // A tie keeps the work that comes first in the index, so unchanged saves pick the same avatar every month.
      if (pick && saves <= pick.saves) continue;
      if (!(await pictureOf(ctx, artworkId, artistKey))) continue;
      if (!pick) await ctx.db.insert("artistCovers", { artistKey, artworkId, saves });
      else await ctx.db.patch("artistCovers", pick._id, { artworkId, saves });
    }
    return { cursor: page.continueCursor, isDone: page.isDone, open: page.isDone ? null : current };
  },
});

// Existing avatars stay until works or picks change; misses are retried for images and rights updated in place.
export const assignCovers = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("artists").paginate({ cursor, numItems: ASSIGN_PAGE });
    for (const artist of page.page) {
      if (artist.coverArtworkId) {
        const pick = await ctx.db
          .query("artistCovers")
          .withIndex("by_artistKey", (q) => q.eq("artistKey", artist.key))
          .first();
        if (!pick || pick.artworkId === artist.coverArtworkId) continue;
      }
      const coverArtworkId = (await findCover(ctx, artist.key))?.artworkId ?? null;
      if (coverArtworkId !== artist.coverArtworkId) await ctx.db.patch("artists", artist._id, { coverArtworkId });
    }
    return { cursor: page.continueCursor, isDone: page.isDone };
  },
});

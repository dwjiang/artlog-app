import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { findMuseumPhoto, findMuseumPhotos, type MuseumPhoto } from "./lib/museumPhotos";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { isVenueOptedOut } from "./lib/venueOptOut";

// A lookup still pending after this long is taken to have failed, so the next view asks again.
const LOOKUP_TIMEOUT_MS = 10 * 60 * 1000;
// One of Commons' standard thumbnail widths, as the catalog's page-wide pictures use.
const PHOTO_WIDTH = 1280;
const BACKFILL_PAGE = 50;
const BACKFILL_ATTEMPTS = 3;
const BACKFILL_RETRY_MS = 60 * 1000;

const photoView = v.object({
  imageUrl: v.string(),
  pageUrl: v.string(),
  author: v.optional(v.string()),
  license: v.optional(v.string()),
});
const checkedPhoto = v.object({
  venueId: v.id("museums"),
  file: v.optional(v.string()),
  author: v.optional(v.string()),
  license: v.optional(v.string()),
});
const backfillProgress = v.object({ scanned: v.number(), photos: v.number() });

async function venueRow(ctx: Pick<QueryCtx, "db">, venueId: Id<"museums">) {
  return ctx.db
    .query("museumPhotos")
    .withIndex("by_venue", (q) => q.eq("venueId", venueId))
    .unique();
}

/** The Wikidata item to look the museum's photo up in; none for a museum without one or that opted out. */
async function lookupId(ctx: QueryCtx, venue: Doc<"museums">): Promise<string | undefined> {
  return (await isVenueOptedOut(ctx, venue)) ? undefined : venue.wikidataId;
}

/** The museum's photo and its credit. `checked` is false until a lookup has finished; then `request` is a no-op. */
export const forVenue = query({
  args: { venueId: v.string() },
  returns: v.object({ photo: v.union(photoView, v.null()), checked: v.boolean() }),
  handler: async (ctx, { venueId: rawVenueId }) => {
    await requireDevice(ctx);
    const venueId = ctx.db.normalizeId("museums", rawVenueId);
    const venue = venueId && (await ctx.db.get("museums", venueId));
    if (!venue) return { photo: null, checked: true };
    const row = await venueRow(ctx, venue._id);
    const checked = row?.checkedAt !== undefined;
    if (!row?.file || (await isVenueOptedOut(ctx, venue))) return { photo: null, checked };
    const file = encodeURIComponent(row.file);
    return {
      photo: {
        imageUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${PHOTO_WIDTH}`,
        pageUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
        author: row.author,
        license: row.license,
      },
      checked,
    };
  },
});

/** Starts the museum's photo lookup unless one has finished or is under way. */
export const request = mutation({
  args: { venueId: v.string() },
  returns: v.null(),
  handler: async (ctx, { venueId: rawVenueId }) => {
    await requireDevice(ctx);
    const venueId = ctx.db.normalizeId("museums", rawVenueId);
    const venue = venueId && (await ctx.db.get("museums", venueId));
    if (!venue) return null;
    const row = await venueRow(ctx, venue._id);
    const now = Date.now();
    if (row && (row.checkedAt !== undefined || now - row.requestedAt < LOOKUP_TIMEOUT_MS)) return null;
    const wikidataId = await lookupId(ctx, venue);
    const fields = { requestedAt: now, checkedAt: wikidataId ? undefined : now };
    if (row) await ctx.db.patch("museumPhotos", row._id, fields);
    else await ctx.db.insert("museumPhotos", { venueId: venue._id, ...fields });
    if (wikidataId) await ctx.scheduler.runAfter(0, internal.museumPhotos.lookUp, { venueId: venue._id, wikidataId });
    return null;
  },
});

export const lookUp = internalAction({
  args: { venueId: v.id("museums"), wikidataId: v.string() },
  returns: v.null(),
  handler: async (ctx, { venueId, wikidataId }) => {
    // A failed lookup stays pending, so a view after the timeout asks again.
    const photo = await withErrorReporting("museumPhotos.lookUp", () => findMuseumPhoto(wikidataId));
    await ctx.runMutation(internal.museumPhotos.record, { photos: [{ venueId, ...photo }] });
    return null;
  },
});

export const record = internalMutation({
  args: { photos: v.array(checkedPhoto) },
  returns: v.null(),
  handler: async (ctx, { photos }) => {
    const now = Date.now();
    for (const { venueId, file, author, license } of photos) {
      const row = await venueRow(ctx, venueId);
      const fields = { checkedAt: now, file, author, license };
      if (row) await ctx.db.patch("museumPhotos", row._id, fields);
      else await ctx.db.insert("museumPhotos", { venueId, requestedAt: now, ...fields });
    }
    return null;
  },
});

/** One page of museums in ID order, as the unchecked ones to look up and those with nothing to look up. */
export const backfillPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({
    lookups: v.array(v.object({ venueId: v.id("museums"), wikidataId: v.string() })),
    nothingToLookUp: v.array(v.id("museums")),
    scanned: v.number(),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db.query("museums").paginate({ cursor, numItems });
    const lookups = [];
    const nothingToLookUp = [];
    for (const venue of page.page) {
      if ((await venueRow(ctx, venue._id))?.checkedAt !== undefined) continue;
      const wikidataId = await lookupId(ctx, venue);
      if (wikidataId) lookups.push({ venueId: venue._id, wikidataId });
      else nothingToLookUp.push(venue._id);
    }
    return { lookups, nothingToLookUp, scanned: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Looks up the photo of every museum not yet checked, a page at a time, so no one waits on a first-view lookup.
 * Reruns skip checked museums. `limit` caps how many museums a pilot run scans. A page whose lookups fail three times
 * is skipped; its museums are looked up when first viewed.
 */
export const backfill = internalAction({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
    attempt: v.optional(v.number()),
    progress: v.optional(backfillProgress),
  },
  returns: v.null(),
  handler: async (ctx, { cursor, limit, attempt = 1, progress = { scanned: 0, photos: 0 } }) => {
    const page = await ctx.runQuery(internal.museumPhotos.backfillPage, {
      cursor,
      numItems: Math.min(BACKFILL_PAGE, limit ?? BACKFILL_PAGE),
    });
    let found: Map<string, MuseumPhoto | null> | undefined;
    try {
      found = await findMuseumPhotos(page.lookups.map((lookup) => lookup.wikidataId));
    } catch (error) {
      if (attempt < BACKFILL_ATTEMPTS) {
        await ctx.scheduler.runAfter(BACKFILL_RETRY_MS, internal.museumPhotos.backfill, {
          cursor,
          limit,
          attempt: attempt + 1,
          progress,
        });
        return null;
      }
      await reportBackendError(error, "museumPhotos.backfill");
    }
    const photos = [
      ...(found ? page.lookups.map(({ venueId, wikidataId }) => ({ venueId, ...found.get(wikidataId) })) : []),
      ...page.nothingToLookUp.map((venueId) => ({ venueId })),
    ];
    await ctx.runMutation(internal.museumPhotos.record, { photos });
    const next = {
      scanned: progress.scanned + page.scanned,
      photos: progress.photos + page.lookups.filter(({ wikidataId }) => found?.get(wikidataId)).length,
    };
    const remaining = limit === undefined ? undefined : limit - page.scanned;
    if (page.isDone || remaining === 0) {
      console.log("Museum photo backfill finished", next);
      return null;
    }
    console.log("Museum photo backfill page", next);
    await ctx.scheduler.runAfter(0, internal.museumPhotos.backfill, {
      cursor: page.cursor,
      limit: remaining,
      progress: next,
    });
    return null;
  },
});

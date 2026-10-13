import tzLookup from "@photostructure/tz-lookup";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";
import moment from "moment-timezone";

import { stableStringify } from "../shared/attestation/stable-stringify";
import { isCalendarDate, isTimeZone, isTimestamp, utf8Bytes } from "../shared/journal/limits";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { titleKey } from "./lib/exhibitionListings";
import {
  exhibitionBatchResult,
  exhibitionExport,
  exhibitionImport,
  exploreRegion,
  exploreRegionCatalog,
} from "./lib/exhibitionValidators";
import { withErrorReporting } from "./lib/observability";
import { isVenueOptedOut } from "./lib/venueOptOut";

const batchArgs = { records: v.array(exhibitionImport) };
const venueArgs = { venueKeys: v.array(v.string()) };
const MAX_BATCH_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 1000;
// Explore loads a region's current shows in one read; a busier region needs a narrower one.
const MAX_REGION_EXHIBITIONS = 1000;

function invalidMetadata(): never {
  throw new ConvexError({ code: "invalid_import_file", reason: "exhibition_metadata" });
}

function httpsUrl(value: string): URL {
  if (value.length > 4096 || value.trim() !== value) invalidMetadata();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidMetadata();
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) invalidMetadata();
  return url;
}

function venueHost(venue: Doc<"museums">): string {
  if (!venue.website) invalidMetadata();
  try {
    const url = new URL(venue.website);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
      invalidMetadata();
    }
    return url.hostname.replace(/^www\./, "");
  } catch {
    invalidMetadata();
  }
}

type VerifiedRecord = Omit<Infer<typeof exhibitionImport>, "venueKey">;

function checkRecord(record: VerifiedRecord, venue: Doc<"museums">): number {
  if (
    !titleKey(record.title)
    || record.title.trim() !== record.title
    || record.title.length > 1000
    || !/^[0-9a-f]{64}$/.test(record.sourceSha256)
    || !isTimestamp(record.checkedAt)
    || record.checkedAt > Date.now() + 60000
    || (record.imageCheckedAt !== undefined
      && (!isTimestamp(record.imageCheckedAt) || record.imageCheckedAt > Date.now() + 60000))
    || !isTimeZone(record.timeZone)
    || record.timeZone !== tzLookup(venue.lat, venue.lng)
    || record.viewingPeriods.length === 0
    || record.viewingPeriods.length > 20
  ) {
    invalidMetadata();
  }
  const host = venueHost(venue);
  const sourceHost = httpsUrl(record.sourceUrl).hostname.replace(/^www\./, "");
  // Preview images often live on a CDN, so only the scheme and form are checked.
  if (record.imageUrl !== undefined) httpsUrl(record.imageUrl);
  if (sourceHost !== host && !sourceHost.endsWith(`.${host}`)) invalidMetadata();
  let previousEnd: string | undefined;
  for (const period of record.viewingPeriods) {
    if (
      !isCalendarDate(period.endDate)
      || (period.startDate !== null && (!isCalendarDate(period.startDate) || period.startDate > period.endDate))
      || (previousEnd !== undefined && (period.startDate === null || period.startDate <= previousEnd))
    ) {
      invalidMetadata();
    }
    previousEnd = period.endDate;
  }
  const end = moment.tz(previousEnd!, "YYYY-MM-DD", true, record.timeZone);
  if (!end.isValid()) invalidMetadata();
  return end.endOf("day").valueOf();
}

function checkVenueKeys(venueKeys: string[]) {
  if (venueKeys.length > MAX_BATCH_SIZE) throw new ConvexError({ code: "batch_too_large" });
  if (venueKeys.some((key) => !key.trim() || key.length > 300)) invalidMetadata();
  if (new Set(venueKeys).size !== venueKeys.length) throw new ConvexError({ code: "duplicate_entry" });
}

async function requireVenue(ctx: QueryCtx, venueKey: string) {
  const venue = await ctx.db
    .query("museums")
    .withIndex("by_key", (q) => q.eq("key", venueKey))
    .unique();
  if (!venue) throw new ConvexError({ code: "not_found" });
  return venue;
}

function exportRow(row: Doc<"exhibitions">, venueKey: string): Infer<typeof exhibitionExport> {
  const { _id, _creationTime, titleKey: _titleKey, ...fields } = row;
  return { exhibitionId: _id, venueKey, ...fields };
}

function pagination(options: { numItems: number; cursor: string | null }) {
  if (!Number.isSafeInteger(options.numItems) || options.numItems < 1) invalidMetadata();
  return { ...options, numItems: Math.min(options.numItems, MAX_PAGE_SIZE) };
}

export const commitBatch = internalMutation({
  args: batchArgs,
  returns: exhibitionBatchResult,
  handler: async (ctx, { records }) => {
    if (records.length > MAX_BATCH_SIZE || utf8Bytes(records) > 250000) {
      throw new ConvexError({ code: "batch_too_large" });
    }
    if (new Set(records.map((record) => `${record.venueKey}\n${titleKey(record.title)}`)).size !== records.length) {
      throw new ConvexError({ code: "duplicate_entry", reason: "exhibition_title" });
    }
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    for (const { venueKey, ...record } of records) {
      if (!venueKey.trim() || venueKey.length > 300) invalidMetadata();
      const museum = await requireVenue(ctx, venueKey);
      if (await isVenueOptedOut(ctx, museum)) throw new ConvexError({ code: "venue_opted_out" });
      result[await saveExhibition(ctx, museum, record)] += 1;
    }
    return result;
  },
});

/** Stores one verified show, keyed by its museum and title. Every check runs before anything is written. */
export async function saveExhibition(
  ctx: MutationCtx,
  museum: Doc<"museums">,
  record: VerifiedRecord,
): Promise<"inserted" | "updated" | "unchanged"> {
  const finalEndAt = checkRecord(record, museum);
  const saved = {
    ...record,
    museumId: museum._id,
    region: museum.region,
    titleKey: titleKey(record.title),
    finalEndAt,
  };
  const existing = await ctx.db
    .query("exhibitions")
    .withIndex("by_museum_title", (q) => q.eq("museumId", museum._id).eq("titleKey", saved.titleKey))
    .unique();
  if (!existing) {
    await ctx.db.insert("exhibitions", saved);
    return "inserted";
  }
  const { _id, _creationTime, ...prior } = existing;
  const { imageUrl: priorImage, imageCheckedAt: priorImageAt, ...priorEvidence } = prior;
  const { imageUrl, imageCheckedAt, ...evidence } = saved;
  if (existing.checkedAt > record.checkedAt) {
    throw new ConvexError({ code: "conflict", reason: "stale_exhibition" });
  }
  if (existing.checkedAt === record.checkedAt && stableStringify(priorEvidence) !== stableStringify(evidence)) {
    throw new ConvexError({ code: "conflict", reason: "timestamp_collision" });
  }
  if (imageUrl === undefined && imageCheckedAt === undefined) {
    // A metadata-only import must not erase a separately checked image.
    if (priorImage !== undefined) saved.imageUrl = priorImage;
    if (priorImageAt !== undefined) saved.imageCheckedAt = priorImageAt;
  } else if (imageUrl !== priorImage || imageCheckedAt !== priorImageAt) {
    const nextAt = imageCheckedAt ?? record.checkedAt;
    const previousAt = priorImageAt ?? (priorImage === undefined ? -1 : existing.checkedAt);
    if (nextAt < previousAt) throw new ConvexError({ code: "conflict", reason: "stale_image" });
    if (nextAt === previousAt) throw new ConvexError({ code: "conflict", reason: "image_timestamp_collision" });
  }
  if (stableStringify(prior) === stableStringify(saved)) return "unchanged";
  await ctx.db.replace("exhibitions", _id, saved);
  return "updated";
}

export const upsertBatch = internalAction({
  args: batchArgs,
  returns: exhibitionBatchResult,
  handler: (ctx, args): Promise<Infer<typeof exhibitionBatchResult>> =>
    withErrorReporting("exhibitions.upsertBatch", () => ctx.runMutation(internal.exhibitions.commitBatch, args)),
});

function currentInRegion(ctx: QueryCtx, region: string, asOf: number) {
  return ctx.db
    .query("exhibitions")
    .withIndex("by_region_finalEndAt", (q) => q.eq("region", region).gte("finalEndAt", asOf));
}

/** Museums available for discovery, cached by identity. */
async function visibleMuseum(ctx: QueryCtx, cache: Map<Id<"museums">, Doc<"museums"> | null>, id: Id<"museums">) {
  if (!cache.has(id)) {
    const museum = await ctx.db.get("museums", id);
    cache.set(id, museum && !museum.excludedFromDiscovery && !(await isVenueOptedOut(ctx, museum)) ? museum : null);
  }
  return cache.get(id)!;
}

async function buildCatalog(ctx: QueryCtx, rows: Doc<"exhibitions">[], museumIds: Id<"museums">[] = []) {
  const cache = new Map<Id<"museums">, Doc<"museums"> | null>();
  const catalog: Infer<typeof exploreRegionCatalog> = { museums: [], exhibitions: [] };
  async function addMuseum(id: Id<"museums">) {
    const fresh = !cache.has(id);
    const museum = await visibleMuseum(ctx, cache, id);
    if (museum && fresh) {
      catalog.museums.push({
        museumId: museum._id,
        name: museum.name,
        city: museum.city ?? null,
        lat: museum.lat,
        lng: museum.lng,
      });
    }
    return museum;
  }
  for (const id of museumIds) await addMuseum(id);
  for (const row of rows) {
    if (!(await addMuseum(row.museumId))) continue;
    catalog.exhibitions.push({
      exhibitionId: row._id,
      museumId: row.museumId,
      title: row.title,
      sourceUrl: row.sourceUrl,
      ...(row.imageUrl === undefined ? {} : { imageUrl: row.imageUrl }),
      viewingPeriods: row.viewingPeriods,
    });
  }
  return catalog;
}

/** Regions with live shows or validated listings, each placed at a visible museum so Explore can reopen empty cities. */
export const regions = query({
  args: { asOf: v.number() },
  returns: v.array(exploreRegion),
  handler: async (ctx, { asOf }) => {
    if (!isTimestamp(asOf)) invalidMetadata();
    const museums = new Map<Id<"museums">, Doc<"museums"> | null>();
    const result: Infer<typeof exploreRegion>[] = [];
    // Skips from one region to the next along the index instead of reading every show.
    let next = await ctx.db.query("exhibitions").withIndex("by_region_finalEndAt").first();
    while (next) {
      const { region } = next;
      for await (const row of currentInRegion(ctx, region, asOf)) {
        const museum = await visibleMuseum(ctx, museums, row.museumId);
        if (museum) {
          result.push({ region, lat: museum.lat, lng: museum.lng });
          break;
        }
      }
      next = await ctx.db
        .query("exhibitions")
        .withIndex("by_region_finalEndAt", (q) => q.gt("region", region))
        .first();
    }
    const included = new Set(result.map(({ region }) => region));
    let refresh = await ctx.db.query("exhibitionRefreshes").withIndex("by_region_dueAt").first();
    while (refresh) {
      const { region } = refresh;
      if (!included.has(region)) {
        const rows = ctx.db.query("exhibitionRefreshes").withIndex("by_region_dueAt", (q) => q.eq("region", region));
        for await (const row of rows) {
          const museum = await visibleMuseum(ctx, museums, row.museumId);
          if (museum) {
            result.push({ region, lat: museum.lat, lng: museum.lng });
            break;
          }
        }
      }
      refresh = await ctx.db
        .query("exhibitionRefreshes")
        .withIndex("by_region_dueAt", (q) => q.gt("region", region))
        .first();
    }
    return result;
  },
});

/** A region's shows that have not closed, with their museums. */
export const inRegion = query({
  args: { region: v.string(), asOf: v.number() },
  returns: exploreRegionCatalog,
  handler: async (ctx, { region, asOf }) => {
    if (!isTimestamp(asOf) || !region || region.length > 100) invalidMetadata();
    const rows = await currentInRegion(ctx, region, asOf).take(MAX_REGION_EXHIBITIONS);
    return buildCatalog(ctx, rows);
  },
});

export const byIds = query({
  args: { exhibitionIds: v.array(v.id("exhibitions")), asOf: v.number() },
  returns: exploreRegionCatalog,
  handler: async (ctx, { exhibitionIds, asOf }) => {
    if (!isTimestamp(asOf)) invalidMetadata();
    if (exhibitionIds.length > MAX_BATCH_SIZE) throw new ConvexError({ code: "batch_too_large" });
    const rows = await Promise.all([...new Set(exhibitionIds)].map((id) => ctx.db.get("exhibitions", id)));
    return buildCatalog(
      ctx,
      rows.filter((row): row is Doc<"exhibitions"> => row !== null && row.finalEndAt >= asOf),
    );
  },
});

export const atMuseum = query({
  args: { museumId: v.id("museums"), asOf: v.number() },
  returns: exploreRegionCatalog,
  handler: async (ctx, { museumId, asOf }) => {
    if (!isTimestamp(asOf)) invalidMetadata();
    const rows = await ctx.db
      .query("exhibitions")
      .withIndex("by_museum_finalEndAt", (q) => q.eq("museumId", museumId).gte("finalEndAt", asOf))
      .take(MAX_REGION_EXHIBITIONS);
    return buildCatalog(ctx, rows, [museumId]);
  },
});

export const venuesForImport = internalQuery({
  args: venueArgs,
  returns: v.array(
    v.object({
      venueKey: v.string(),
      museumId: v.id("museums"),
      name: v.string(),
      timeZone: v.string(),
      optOut: v.boolean(),
    }),
  ),
  handler: async (ctx, { venueKeys }) => {
    checkVenueKeys(venueKeys);
    const venues = [];
    for (const venueKey of venueKeys) {
      const venue = await requireVenue(ctx, venueKey);
      venues.push({
        venueKey,
        museumId: venue._id,
        name: venue.name,
        timeZone: tzLookup(venue.lat, venue.lng),
        optOut: await isVenueOptedOut(ctx, venue),
      });
    }
    return venues;
  },
});

export const exportByVenueKeys = internalQuery({
  args: venueArgs,
  returns: v.array(exhibitionExport),
  handler: async (ctx, { venueKeys }) => {
    checkVenueKeys(venueKeys);
    const result = [];
    for (const venueKey of venueKeys) {
      const venue = await requireVenue(ctx, venueKey);
      const rows = await ctx.db
        .query("exhibitions")
        .withIndex("by_museum_title", (q) => q.eq("museumId", venue._id))
        .take(MAX_EXPORT_ROWS + 1);
      if (result.length + rows.length > MAX_EXPORT_ROWS) throw new ConvexError({ code: "batch_too_large" });
      result.push(...rows.map((row) => exportRow(row, venueKey)));
    }
    return result;
  },
});

export const exportPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(exhibitionExport), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { paginationOpts }) => {
    const {
      page: rows,
      isDone,
      continueCursor,
    } = await ctx.db.query("exhibitions").withIndex("by_museum_title").paginate(pagination(paginationOpts));
    const page = [];
    for (const row of rows) {
      const museum = await ctx.db.get("museums", row.museumId);
      if (!museum) throw new ConvexError({ code: "not_found" });
      page.push(exportRow(row, museum.key));
    }
    return { page, isDone, continueCursor };
  },
});

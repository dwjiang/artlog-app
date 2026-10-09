import { paginationOptsValidator } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";

import { stableStringify } from "../shared/attestation/stable-stringify";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { exhibitionSource, exhibitionSourceBatchResult } from "./lib/exhibitionSourceValidators";
import { withErrorReporting } from "./lib/observability";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

const batchArgs = { records: v.array(exhibitionSource) };
const MAX_BATCH_SIZE = 100;
const MAX_PAGE_SIZE = 250;

function invalidMetadata(): never {
  throw new ConvexError({ code: "invalid_venue", reason: "exhibition_source_metadata" });
}

function checkTimestamp(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) invalidMetadata();
}

function checkRecord(record: Infer<typeof exhibitionSource>) {
  checkTimestamp(record.checkedAt);
  if (
    record.checkedAt > Date.now() + 60000
    || (record.status === "validated") !== record.urls.length > 0
    || record.urls.length > 8
    || !record.outcomeReason.trim()
    || record.outcomeReason.length > 2000
    || (record.status === "missing_website" && record.websiteSnapshot?.trim())
  ) {
    invalidMetadata();
  }
  const seen = new Set<string>();
  for (const listing of record.urls) {
    checkTimestamp(listing.validatedAt);
    if (
      listing.validatedAt > record.checkedAt
      || !listing.evidence.trim()
      || listing.evidence.length > 2000
      || listing.url.length > 4096
      || listing.url.trim() !== listing.url
    ) {
      invalidMetadata();
    }
    let url: URL;
    try {
      url = new URL(listing.url);
    } catch {
      invalidMetadata();
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      invalidMetadata();
    }
    const key = `${listing.purpose}:${url.href}`;
    if (seen.has(key)) throw new ConvexError({ code: "duplicate_entry", reason: "exhibition_source_url" });
    seen.add(key);
  }
}

export const commitBatch = internalMutation({
  args: batchArgs,
  returns: exhibitionSourceBatchResult,
  handler: async (ctx, { records }) => {
    if (records.length > MAX_BATCH_SIZE || JSON.stringify(records).length > 250000) {
      throw new ConvexError({ code: "batch_too_large" });
    }
    if (new Set(records.map((record) => record.museumId)).size !== records.length) {
      throw new ConvexError({ code: "duplicate_entry", reason: "exhibition_source_museum" });
    }
    const result = { inserted: 0, updated: 0, unchanged: 0 };
    for (const record of records) {
      checkRecord(record);
      const museum = await ctx.db.get("museums", record.museumId);
      if (!museum) throw new ConvexError({ code: "not_found" });
      if ((museum.website ?? null) !== record.websiteSnapshot) {
        throw new ConvexError({ code: "conflict", reason: "website_changed" });
      }
      if (record.status === "validated" && (await isVenueOptedOut(ctx, museum))) {
        throw new ConvexError({ code: "venue_opted_out" });
      }
      const existing = await ctx.db
        .query("exhibitionSources")
        .withIndex("by_museumId", (q) => q.eq("museumId", record.museumId))
        .unique();
      if (!existing) {
        await ctx.db.insert("exhibitionSources", record);
        result.inserted += 1;
        continue;
      }
      const { _id, _creationTime, ...saved } = existing;
      if (stableStringify(saved) === stableStringify(record)) {
        result.unchanged += 1;
        continue;
      }
      if (existing.checkedAt > record.checkedAt) {
        throw new ConvexError({ code: "conflict", reason: "stale_discovery" });
      }
      if (existing.checkedAt === record.checkedAt) {
        throw new ConvexError({ code: "conflict", reason: "timestamp_collision" });
      }
      await ctx.db.replace("exhibitionSources", _id, record);
      result.updated += 1;
    }
    return result;
  },
});

export const upsertBatch = internalAction({
  args: batchArgs,
  returns: exhibitionSourceBatchResult,
  handler: (ctx, args): Promise<Infer<typeof exhibitionSourceBatchResult>> =>
    withErrorReporting("exhibitionSources.upsertBatch", () =>
      ctx.runMutation(internal.exhibitionSources.commitBatch, args),
    ),
});

export const list = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(schema.doc("exhibitionSources")),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("exhibitionSources")
      .withIndex("by_museumId")
      .paginate({ cursor: paginationOpts.cursor, numItems: Math.min(paginationOpts.numItems, MAX_PAGE_SIZE) });
    return { page, isDone, continueCursor };
  },
});

export const exportMuseumPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        museumId: v.id("museums"),
        key: v.string(),
        name: v.string(),
        website: v.union(v.string(), v.null()),
        country: v.union(v.string(), v.null()),
        city: v.union(v.string(), v.null()),
        region: v.string(),
        optOut: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const {
      page: museums,
      isDone,
      continueCursor,
    } = await ctx.db
      .query("museums")
      .withIndex("by_key")
      .paginate({ cursor: paginationOpts.cursor, numItems: Math.min(paginationOpts.numItems, MAX_PAGE_SIZE) });
    const page = [];
    for (const museum of museums) {
      page.push({
        museumId: museum._id,
        key: museum.key,
        name: museum.name,
        website: museum.website ?? null,
        country: museum.country ?? null,
        city: museum.city ?? null,
        region: museum.region,
        optOut: await isVenueOptedOut(ctx, museum),
      });
    }
    return { page, isDone, continueCursor };
  },
});

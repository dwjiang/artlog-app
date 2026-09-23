import tzLookup from "@photostructure/tz-lookup";
import { ConvexError, type Infer, v } from "convex/values";
import moment from "moment-timezone";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { bumpCounter } from "./ingest";
import { checklistExhibition } from "./lib/validators";
import { isVenueOptedOut } from "./lib/venueOptOut";

const MAX_WORKS = 100;
const MAX_MATCHES = 100;
const checklistWork = v.union(
  v.object({ objectKey: v.string() }),
  v.object({
    wikidataId: v.string(),
    ownerKey: v.optional(v.string()),
    accession: v.optional(v.string()),
  }),
  v.object({
    title: v.string(),
    artist: v.string(),
    ownerKey: v.optional(v.string()),
    accession: v.optional(v.string()),
  }),
);
type ChecklistWork = Infer<typeof checklistWork>;
type Resolution = { object: Doc<"objects"> } | { reason: string };

function selectObject(rows: Doc<"objects">[]): Resolution {
  if (rows.length > MAX_MATCHES) return { reason: "too_many_matches" };
  const active = rows.filter((row) => !row.reverted && !row.mergedInto);
  if (active.length === 0) return { reason: "object_not_found" };
  if (active.length !== 1) return { reason: "ambiguous_object" };
  return { object: active[0] };
}

async function resolveWork(ctx: QueryCtx, input: ChecklistWork): Promise<Resolution> {
  if ("objectKey" in input) {
    return selectObject(
      await ctx.db
        .query("objects")
        .withIndex("by_key", (q) => q.eq("key", input.objectKey))
        .take(2),
    );
  }
  const owner = input.ownerKey
    ? await ctx.db
        .query("museums")
        .withIndex("by_key", (q) => q.eq("key", input.ownerKey!))
        .unique()
    : null;
  if (input.ownerKey !== undefined && !owner) return { reason: "owner_not_found" };
  if ("wikidataId" in input) {
    const artworks = await ctx.db
      .query("artworks")
      .withIndex("by_wikidataId", (q) => q.eq("wikidataId", input.wikidataId))
      .take(2);
    if (!artworks.length) return { reason: "artwork_not_found" };
    if (artworks.length !== 1) return { reason: "ambiguous_artwork" };
    const artworkId = artworks[0]._id;
    if (input.accession && owner) {
      const rows = await ctx.db
        .query("objects")
        .withIndex("by_owner_accession", (q) =>
          q.eq("ownerId", owner._id).eq("accession", input.accession!),
        )
        .take(MAX_MATCHES + 1);
      if (rows.length > MAX_MATCHES) return { reason: "too_many_matches" };
      return selectObject(rows.filter((row) => row.artworkId === artworkId));
    }
    if (input.accession && !owner) return { reason: "accession_requires_owner" };
    const rows = await ctx.db
      .query("objects")
      .withIndex("by_artworkId_ownerId", (q) =>
        owner
          ? q.eq("artworkId", artworkId).eq("ownerId", owner._id)
          : q.eq("artworkId", artworkId),
      )
      .take(MAX_MATCHES + 1);
    return selectObject(rows);
  }
  if (owner && input.accession) {
    return selectObject(
      await ctx.db
        .query("objects")
        .withIndex("by_owner_accession", (q) =>
          q.eq("ownerId", owner._id).eq("accession", input.accession!),
        )
        .take(MAX_MATCHES + 1),
    );
  }
  // A title/artist match cannot establish a physical object without an indexed identity.
  return { reason: "title_artist_unindexed" };
}

export const ingestChecklist = internalMutation({
  args: {
    venueKey: v.string(),
    exhibition: checklistExhibition,
    gallery: v.optional(v.string()),
    works: v.array(checklistWork),
  },
  returns: v.object({
    placed: v.number(),
    unresolved: v.array(v.object({ input: checklistWork, reason: v.string() })),
  }),
  handler: async (ctx, args) => {
    if (args.works.length > MAX_WORKS)
      throw new ConvexError({ code: "checklist_too_large", maxWorks: MAX_WORKS });
    const venue = await ctx.db
      .query("museums")
      .withIndex("by_key", (q) => q.eq("key", args.venueKey))
      .unique();
    if (!venue) throw new ConvexError({ code: "venue_not_found" });
    if (await isVenueOptedOut(ctx, venue)) throw new ConvexError({ code: "venue_opted_out" });
    let source: URL;
    try {
      source = new URL(args.exhibition.sourceUrl);
    } catch {
      throw new ConvexError({ code: "invalid_checklist_source" });
    }
    if (!["https:", "http:"].includes(source.protocol) || !args.exhibition.title.trim()) {
      throw new ConvexError({ code: "invalid_checklist_source" });
    }
    // The wire dates are inclusive host-local days, including DST changes.
    const timeZone = tzLookup(venue.lat, venue.lng);
    const start = moment.tz(args.exhibition.from, "YYYY-MM-DD", true, timeZone);
    const end = moment.tz(args.exhibition.to, "YYYY-MM-DD", true, timeZone);
    if (
      !start.isValid() ||
      !end.isValid() ||
      start.format("YYYY-MM-DD") !== args.exhibition.from ||
      end.format("YYYY-MM-DD") !== args.exhibition.to ||
      start.isAfter(end)
    ) {
      throw new ConvexError({ code: "invalid_checklist_window" });
    }
    const from = start.valueOf();
    const to = end.endOf("day").valueOf();
    const exhibition = { ...args.exhibition, timeZone };
    const now = Date.now();
    const placed = new Set<Id<"objects">>();
    const unresolved: { input: ChecklistWork; reason: string }[] = [];
    let inserted = 0;
    for (const input of args.works) {
      const resolved = await resolveWork(ctx, input);
      if ("reason" in resolved) {
        unresolved.push({ input, reason: resolved.reason });
        continue;
      }
      const objectId = resolved.object._id;
      if (placed.has(objectId)) continue;
      const rows = await ctx.db
        .query("placements")
        .withIndex("by_object_venue_source", (q) =>
          q.eq("objectId", objectId).eq("venueId", venue._id).eq("source", "checklist"),
        )
        .take(MAX_MATCHES + 1);
      if (rows.length > MAX_MATCHES)
        throw new ConvexError({ code: "too_many_checklist_placements", objectId });
      const overlapping = rows.filter(
        (row) =>
          row.closedAt === undefined &&
          (row.from ?? -Infinity) <= to &&
          (row.to ?? Infinity) >= from,
      );
      const identical = overlapping.find(
        (row) =>
          row.from === from &&
          row.to === to &&
          row.gallery === args.gallery &&
          row.onView &&
          row.confidence === 0.85 &&
          row.exhibition?.title === exhibition.title &&
          row.exhibition.sourceUrl === exhibition.sourceUrl &&
          row.exhibition.timeZone === timeZone,
      );
      for (const row of overlapping) {
        if (row._id !== identical?._id) await ctx.db.patch(row._id, { closedAt: now });
      }
      if (!identical) {
        await ctx.db.insert("placements", {
          identityStatus: resolved.object.identityStatus,
          objectId,
          venueId: venue._id,
          gallery: args.gallery,
          onView: true,
          from,
          to,
          source: "checklist",
          confidence: 0.85,
          exhibition,
        });
        inserted++;
      }
      placed.add(objectId);
    }
    await bumpCounter(ctx, "placements", inserted);
    return { placed: placed.size, unresolved };
  },
});

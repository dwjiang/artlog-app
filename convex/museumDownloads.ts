import { paginationOptsValidator } from "convex/server";
import { ConvexError, convexToJson, v, type Infer, type Value } from "convex/values";

import model from "../shared/model/model-version.json";
import type { MuseumEntry } from "../shared/offline/types";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { chunk, preview, type museumPackage } from "./lib/museumDownloadValidators";
import { readObjectDetails } from "./lib/objectDetails";
import { loadOrb, orbHash } from "./lib/orbStorage";
import { loadCurrentPlacement } from "./lib/placements";
import { eligibleObject, eligibleVector } from "./lib/recognitionEligibility";
import { readVector } from "./lib/vectorStore";
import { isVenueOptedOut } from "./lib/venueOptOut";
import schema from "./schema";

const summary = v.object({
  id: v.id("museums"),
  key: v.string(),
  name: v.string(),
  city: v.optional(v.string()),
  lat: v.number(),
  lng: v.number(),
  version: v.string(),
  modelVersion: v.string(),
  size: v.number(),
  count: v.number(),
  previews: v.array(preview),
});
const manifest = summary.extend({
  chunks: v.array(v.object({ url: v.string(), size: v.number(), sha256: v.string() })),
});
function describe(museum: Doc<"museums">, pack: Infer<typeof museumPackage>) {
  return {
    id: museum._id,
    key: museum.key,
    name: museum.name,
    city: museum.city,
    lat: museum.lat,
    lng: museum.lng,
    version: pack.version,
    modelVersion: pack.modelVersion,
    size: pack.size,
    count: pack.count,
    previews: pack.previews,
  };
}

export const catalog = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(summary),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    await requireDevice(ctx);
    const result = await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue")
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, 64),
      });
    const page = [];
    for (const row of result.page) {
      const museum = await ctx.db.get("museums", row.venueId);
      if (
        museum
        && row.published?.count
        && row.published.modelVersion === model.modelVersion
        && !(await isVenueOptedOut(ctx, museum))
      ) {
        page.push(describe(museum, row.published));
      }
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const get = query({
  args: { venueId: v.id("museums") },
  returns: v.union(manifest, v.null()),
  handler: async (ctx, { venueId }) => {
    await requireDevice(ctx);
    const museum = await ctx.db.get("museums", venueId);
    const row = await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue", (q) => q.eq("venueId", venueId))
      .unique();
    const pack = row?.published;
    if (!museum || !pack?.count || pack.modelVersion !== model.modelVersion || (await isVenueOptedOut(ctx, museum))) {
      return null;
    }
    const chunks = [];
    for (const part of pack.chunks) {
      const url = await fileStorage.getUrl(ctx, part.storageId);
      if (!url) return null;
      chunks.push({ url, size: part.size, sha256: part.sha256 });
    }
    return { ...describe(museum, pack), chunks };
  },
});

// Corpus publication runs in small scheduled batches; a completed package replaces the old one atomically.
export const build = internalMutation({
  args: { venueId: v.id("museums") },
  returns: v.null(),
  handler: async (ctx, { venueId }) => {
    const museum = await ctx.db.get("museums", venueId);
    if (!museum || (await isVenueOptedOut(ctx, museum))) {
      throw new ConvexError("Museum unavailable");
    }
    const existing = await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue", (q) => q.eq("venueId", venueId))
      .unique();
    // A new generation also recovers builds interrupted by a failed scheduled action.
    for (const part of existing?.building?.chunks ?? []) {
      await fileStorage.delete(ctx, part.storageId);
    }
    const building = {
      version: crypto.randomUUID(),
      modelVersion: model.modelVersion,
      size: 0,
      count: 0,
      chunks: [],
      previews: [],
      cursor: null,
    };
    const id = existing?._id ?? (await ctx.db.insert("museumDownloads", { venueId }));
    await ctx.db.patch("museumDownloads", id, { building });
    await ctx.scheduler.runAfter(0, internal.museumDownloads.buildPage, {
      id,
      version: building.version,
    });
    return null;
  },
});
export const readPage = internalQuery({
  args: { id: v.id("museumDownloads"), version: v.string() },
  returns: v.union(
    v.object({
      museum: schema.doc("museums"),
      page: v.array(
        v.object({
          object: schema.doc("objects"),
          details: v.union(schema.doc("objectDetails"), v.null()),
          artwork: schema.doc("artworks"),
          content: v.union(schema.doc("artworkContent"), v.null()),
          placement: v.union(schema.doc("placements"), v.null()),
          vectors: v.array(v.array(v.number())),
          descriptor: schema.doc("descriptors"),
        }),
      ),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id, version }) => {
    const row = await ctx.db.get("museumDownloads", id);
    if (!row?.building || row.building.version !== version) return null;
    const museum = await ctx.db.get("museums", row.venueId);
    if (!museum || (await isVenueOptedOut(ctx, museum))) return null;
    const result = await ctx.db
      .query("objects")
      .withIndex("by_owner_accession", (q) => q.eq("ownerId", row.venueId))
      .paginate({ numItems: 12, cursor: row.building.cursor });
    const page = [];
    for (const object of result.page) {
      if (object.identityStatus !== "established" || !(await eligibleObject(ctx, object))) {
        continue;
      }
      const artwork = await ctx.db.get("artworks", object.artworkId);
      const descriptor = await ctx.db
        .query("descriptors")
        .withIndex("by_objectId", (q) => q.eq("objectId", object._id))
        .unique();
      if (!artwork || artwork.retiredAt || !descriptor) continue;
      const vectors = [];
      for (const vector of await ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) =>
          q.eq("objectId", object._id).eq("modelVersion", model.modelVersion),
        )
        .take(32)) {
        if (vector.source !== "user_scan" && vector.source !== "user" && (await eligibleVector(ctx, vector))) {
          vectors.push(await readVector(ctx, vector));
        }
      }
      if (vectors.length > 0) {
        page.push({
          object,
          details: await readObjectDetails(ctx, object),
          artwork,
          content: await readArtworkContent(ctx, artwork),
          descriptor,
          vectors,
          placement: await loadCurrentPlacement(ctx, object._id, Date.now()),
        });
      }
    }
    return {
      museum,
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const buildPage = internalAction({
  args: { id: v.id("museumDownloads"), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(internal.museumDownloads.readPage, args);
    if (!result) return null;
    const entries: MuseumEntry[] = [];
    const previews: Infer<typeof preview>[] = [];
    for (const { object, details, artwork, content, descriptor, vectors, placement } of result.page) {
      // Skipping a damaged reference keeps one unreadable ORB file from failing every rebuild of this museum.
      const features = await loadOrb(ctx, descriptor.storageId, descriptor.keypointCount).catch((error: unknown) => {
        console.warn("Museum download skipped an unreadable ORB reference", object._id, error);
      });
      if (!features) continue;
      entries.push({
        vectors,
        candidate: {
          object: {
            _id: object._id,
            identityStatus: object.identityStatus,
            ownerId: object.ownerId,
            medium: details?.medium,
            calibratorPenalty: object.calibratorPenalty,
            rejectionPenalty: object.rejectionPenalty,
          },
          artwork: {
            _id: artwork._id,
            title: artwork.title,
            artist: artwork.artist,
            date: artwork.date,
            rightsStatus: artwork.rightsStatus,
            docent: content?.docent?.en,
            factSheet: content?.factSheet?.map(({ id, sourceUrl, sourceLabel }) => ({
              id,
              sourceUrl,
              sourceLabel,
            })),
          },
          placement: placement && {
            venueId: placement.venueId,
            gallery: placement.gallery,
            onView: placement.onView,
          },
          institution: result.museum.name,
          similarity: 0,
          keypointCount: descriptor.keypointCount,
          inputSize: descriptor.inputSize,
          ...features,
        },
      });
      if (previews.length < 3 && artwork.rightsStatus === "public_domain" && details?.thumbnailUrl) {
        previews.push({ title: artwork.title, url: details.thumbnailUrl });
      }
    }
    let part: Infer<typeof chunk> | undefined;
    if (entries.length > 0) {
      const bytes = new TextEncoder().encode(JSON.stringify(convexToJson(entries as unknown as Value)));
      const storageId = await fileStorage.store(ctx, new Blob([bytes], { type: "application/json" }));
      part = {
        storageId,
        size: bytes.byteLength,
        sha256: await orbHash(bytes),
      };
    }
    await ctx.runMutation(internal.museumDownloads.commitPage, {
      ...args,
      part,
      previews,
      count: entries.length,
      cursor: result.continueCursor,
      isDone: result.isDone,
    });
    return null;
  },
});
export const commitPage = internalMutation({
  args: {
    id: v.id("museumDownloads"),
    version: v.string(),
    part: v.optional(chunk),
    previews: v.array(preview),
    count: v.number(),
    cursor: v.string(),
    isDone: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("museumDownloads", args.id);
    if (!row?.building || row.building.version !== args.version) {
      if (args.part) await fileStorage.delete(ctx, args.part.storageId);
      return null;
    }
    if (args.part) await retainFile(ctx, args.part.storageId, true);
    const { cursor: _cursor, ...previous } = row.building;
    const pack = {
      ...previous,
      size: previous.size + (args.part?.size ?? 0),
      count: previous.count + args.count,
      chunks: [...previous.chunks, ...(args.part ? [args.part] : [])],
      previews: [...previous.previews, ...args.previews].slice(0, 3),
    };
    if (args.isDone) {
      await ctx.db.patch("museumDownloads", args.id, { published: pack, building: undefined });
      for (const old of row.published?.chunks ?? []) {
        await fileStorage.delete(ctx, old.storageId);
      }
    } else {
      await ctx.db.patch("museumDownloads", args.id, {
        building: { ...pack, cursor: args.cursor },
      });
      await ctx.scheduler.runAfter(0, internal.museumDownloads.buildPage, {
        id: args.id,
        version: args.version,
      });
    }
    return null;
  },
});

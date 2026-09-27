import { ConvexError, type Infer, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { DESCRIPTOR_BYTES, KEYPOINT_BYTES, MAX_KEYPOINTS } from "../shared/orb/features";
// The Python ↔ Convex ingest contract. Every function is admin-key only and every
// upsert is idempotent on its natural key; changing a row shape means changing
// scripts/data/pipeline in the same PR.
import { validateGeography } from "../shared/social/contracts";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { registerMuseumObject } from "./lib/museumWorkIdentity";
import { patchContributionState } from "./lib/objectContributionState";
import { patchObjectDetails, readObjectDetails, readObjectOrb } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { deleteOrbIfUnreferenced, loadOrb, orbHash, ORB_CONTENT_TYPE, packOrb } from "./lib/orbStorage";
import { findPlacement } from "./lib/placements";
import { eligibleObject, eligibleVector, recognitionPartition } from "./lib/recognitionEligibility";
import { effectiveObjectPenalty } from "./lib/rejectionPenalty";
import { multiplicity, objectSource, placementSource, rightsStatus, seedSource } from "./lib/validators";
import { insertVector, readVector, replaceVector, vectorHash, withVectorArchives } from "./lib/vectorStore";
import schema from "./schema";
import { recordVenueChanges } from "./venueChanges";

export const MAX_BATCH_ROWS = 500;
export const EXPORT_PAGE_SIZE = 1000;
// Bound vector reads and exported ORB bytes as well as row counts.
const TRAINING_EXPORT_BYTES = 5_000_000;
export const TRAINING_EXPORT_PAGE_SIZE = Math.min(500, Math.floor(TRAINING_EXPORT_BYTES / (model.embeddingDim * 8)));

const museumRow = v.object({
  key: v.string(),
  wikidataId: v.optional(v.string()),
  name: v.string(),
  lat: v.number(),
  lng: v.number(),
  website: v.optional(v.string()),
  city: v.optional(v.string()),
  cityKey: v.optional(v.string()),
  country: v.optional(v.string()),
  region: v.string(),
  seedSource,
});

const artworkRow = v.object({
  key: v.string(),
  wikidataId: v.optional(v.string()),
  title: v.string(),
  artist: v.string(),
  artistId: v.optional(v.string()),
  date: v.optional(v.string()),
  yearStart: v.optional(v.number()),
  yearEnd: v.optional(v.number()),
  rightsStatus,
  multiplicity,
  seriesId: v.optional(v.string()),
});

const objectRow = v.object({
  key: v.string(),
  artworkKey: v.string(),
  ownerKey: v.optional(v.string()),
  accession: v.optional(v.string()),
  medium: v.optional(v.string()),
  dimensions: v.optional(v.string()),
  source: objectSource,
  sourceId: v.string(),
  imageRef: v.optional(v.string()),
  pageUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  mergedIntoKey: v.optional(v.string()),
});

const placementRow = v.object({
  objectKey: v.string(),
  venueKey: v.string(),
  gallery: v.optional(v.string()),
  onView: v.boolean(),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
  source: placementSource,
  confidence: v.number(),
});

const vectorRow = v.object({
  objectKey: v.string(),
  modelVersion: v.string(),
  source: v.literal("corpus"),
  viewKey: v.string(),
  vector: v.array(v.float64()),
});

const descriptorRow = v.object({
  objectKey: v.string(),
  descriptors: v.bytes(),
  keypoints: v.bytes(),
  keypointCount: v.number(),
  inputSize: v.number(),
  extractedFrom: v.string(),
});

const penaltyRow = v.object({
  objectKey: v.string(),
  calibratorPenalty: v.number(),
});

const importTable = v.union(
  v.literal("artworks"),
  v.literal("objects"),
  v.literal("placements"),
  v.literal("vectors"),
  v.literal("descriptors"),
  v.literal("penalties"),
);
const importIdentity = v.object({
  key: v.string(),
  venueKey: v.optional(v.string()),
  modelVersion: v.optional(v.string()),
  source: v.optional(v.string()),
  viewKey: v.optional(v.string()),
});

const countsShape = {
  museums: v.number(),
  artworks: v.number(),
  objects: v.number(),
  placements: v.number(),
  vectors: v.number(),
  descriptors: v.number(),
};
type Counters = { [K in keyof typeof countsShape]: number };
const zeroCounts: Counters = {
  museums: 0,
  artworks: 0,
  objects: 0,
  placements: 0,
  vectors: 0,
  descriptors: 0,
};

type KeyedTable = "artworks" | "objects" | "museums";

function checkBatch(rows: unknown[]) {
  if (rows.length > MAX_BATCH_ROWS) {
    throw new ConvexError({
      code: "batch_too_large",
      max: MAX_BATCH_ROWS,
      size: rows.length,
    });
  }
}

async function findByKey<T extends KeyedTable>(ctx: QueryCtx, table: T, key: string) {
  const doc = await ctx.db
    .query(table as KeyedTable)
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return doc as Doc<T> | null;
}

function fieldsChanged(existing: object, fields: object): boolean {
  return Object.entries(fields).some(([key, value]) => (existing as Record<string, unknown>)[key] !== value);
}

function documentChanged(existing: { _id: unknown; _creationTime: number }, fields: object): boolean {
  const { _id, _creationTime, ...stored } = existing;
  return fieldsChanged(stored, fields) || fieldsChanged(fields, stored);
}

async function requireByKey<T extends KeyedTable>(ctx: QueryCtx, table: T, key: string) {
  const doc = await findByKey(ctx, table, key);
  if (doc === null) throw new ConvexError({ code: "unknown_key", table, key });
  return doc;
}

export async function bumpCounter(ctx: MutationCtx, table: keyof Counters, inserted: number) {
  if (inserted === 0) return;
  const shard = Math.floor(Math.random() * 64);
  const existing = await ctx.db
    .query("ingestCounters")
    .withIndex("by_shard", (q) => q.eq("shard", shard))
    .unique();
  if (existing === null) {
    await ctx.db.insert("ingestCounters", { ...zeroCounts, shard, [table]: inserted });
  } else {
    await ctx.db.patch("ingestCounters", existing._id, { [table]: existing[table] + inserted });
  }
}

export const upsertMuseums = internalMutation({
  args: { rows: v.array(museumRow) },
  returns: v.object({ ids: v.record(v.string(), v.id("museums")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"museums">> = {};
    const changed: Id<"museums">[] = [];
    let inserted = 0;
    for (const row of rows) {
      validateGeography(row);
      if (row.cityKey !== undefined && !/^wikidata:Q[1-9][0-9]*$/.test(row.cityKey)) {
        throw new ConvexError({ code: "invalid_venue" });
      }
      const fields = {
        city: row.city,
        cityKey: row.cityKey,
        country: row.country,
        key: row.key,
        wikidataId: row.wikidataId,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        website: row.website,
        region: row.region,
        seedSource: row.seedSource,
      };
      const existing = await findByKey(ctx, "museums", row.key);
      if (existing) {
        if (fieldsChanged(existing, fields)) {
          await ctx.db.patch("museums", existing._id, fields);
          changed.push(existing._id);
        }
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert("museums", {
          ...fields,
          optOut: false,
        });
        changed.push(ids[row.key]);
        inserted += 1;
      }
    }
    await recordVenueChanges(ctx, changed);
    await bumpCounter(ctx, "museums", inserted);
    return { ids };
  },
});

export const upsertArtworks = internalMutation({
  args: { rows: v.array(artworkRow) },
  returns: v.object({ ids: v.record(v.string(), v.id("artworks")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"artworks">> = {};
    let inserted = 0;
    for (const row of rows) {
      const fields = {
        identityStatus: "established" as const,
        key: row.key,
        wikidataId: row.wikidataId,
        title: row.title,
        artist: row.artist,
        artistId: row.artistId,
        date: row.date,
        yearStart: row.yearStart,
        yearEnd: row.yearEnd,
        rightsStatus: row.rightsStatus,
        multiplicity: row.multiplicity,
        seriesId: row.seriesId,
      };
      const existing = await findByKey(ctx, "artworks", row.key);
      if (existing) {
        if (fieldsChanged(existing, fields)) await ctx.db.patch("artworks", existing._id, fields);
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert("artworks", fields);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, "artworks", inserted);
    return { ids };
  },
});

// Rows that name a `mergedIntoKey` must follow the object they merge into (an earlier batch or
// an earlier row); the counters and provenance of an existing object are never overwritten.
export const upsertObjects = internalMutation({
  args: { rows: v.array(objectRow) },
  returns: v.object({ ids: v.record(v.string(), v.id("objects")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"objects">> = {};
    let inserted = 0;
    const artworks = new Map<string, Doc<"artworks">>();
    const museums = new Map<string, Doc<"museums">>();
    for (const row of rows) {
      const artwork = artworks.get(row.artworkKey) ?? (await requireByKey(ctx, "artworks", row.artworkKey));
      artworks.set(row.artworkKey, artwork);
      if (row.thumbnailUrl !== undefined && artwork.rightsStatus !== "public_domain") {
        throw new ConvexError({ code: "thumbnail_rights", objectKey: row.key });
      }
      const owner = row.ownerKey
        ? (museums.get(row.ownerKey) ?? (await requireByKey(ctx, "museums", row.ownerKey)))
        : null;
      if (row.ownerKey && owner) museums.set(row.ownerKey, owner);
      const mergedInto = row.mergedIntoKey ? await requireByKey(ctx, "objects", row.mergedIntoKey) : null;
      const fields = {
        key: row.key,
        identityStatus: artwork.identityStatus,
        artworkId: artwork._id,
        ownerId: owner?._id,
        accession: row.accession,
        source: row.source,
        sourceId: row.sourceId,
        mergedInto: mergedInto?._id,
      };
      const details = {
        medium: row.medium,
        dimensions: row.dimensions,
        imageRef: row.imageRef,
        pageUrl: row.pageUrl,
        thumbnailUrl: row.thumbnailUrl,
      };
      const existing = await findByKey(ctx, "objects", row.key);
      if (existing) {
        if (fieldsChanged(existing, fields)) await ctx.db.patch("objects", existing._id, fields);
        if (fieldsChanged((await readObjectDetails(ctx, existing)) ?? {}, details)) {
          await patchObjectDetails(ctx, existing, details);
        }
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert("objects", {
          ...fields,
          confirmCount: 0,
          rejectCount: 0,
          calibratorPenalty: 0,
          reverted: false,
        });
        await patchObjectDetails(ctx, { _id: ids[row.key] }, details);
        inserted += 1;
      }
      if (row.source === "user" || existing?.source === "user") {
        await patchContributionState(ctx, ids[row.key], { userCreated: row.source === "user" });
      }
      await registerMuseumObject(ctx, {
        ...fields,
        pageUrl: row.pageUrl,
        artworkId: mergedInto?.artworkId ?? fields.artworkId,
      });
    }
    await bumpCounter(ctx, "objects", inserted);
    return { ids };
  },
});

export const upsertPlacements = internalMutation({
  args: { rows: v.array(placementRow) },
  returns: v.object({ ids: v.record(v.string(), v.id("placements")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"placements">> = {};
    let inserted = 0;
    for (const row of rows) {
      const object = await requireByKey(ctx, "objects", row.objectKey);
      const venue = await requireByKey(ctx, "museums", row.venueKey);
      const doc = {
        identityStatus: object.identityStatus,
        objectId: object._id,
        venueId: venue._id,
        gallery: row.gallery,
        onView: row.onView,
        from: row.from,
        to: row.to,
        source: row.source,
        confidence: row.confidence,
      };
      const existing = await findPlacement(ctx, object._id, venue._id, row.source);
      const naturalKey = `${row.objectKey}|${row.venueKey}|${row.source}`;
      if (existing) {
        if (documentChanged(existing, doc)) await ctx.db.replace("placements", existing._id, doc);
        ids[naturalKey] = existing._id;
      } else {
        ids[naturalKey] = await ctx.db.insert("placements", doc);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, "placements", inserted);
    return { ids };
  },
});

const vectorIds = v.object({ ids: v.record(v.string(), v.id("vectors")) });

export const existingVectors = internalQuery({
  args: { rows: v.array(v.object({ modelVersion: v.string(), viewKey: v.string() })) },
  returns: v.array(v.union(schema.doc("vectors"), v.null())),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    return Promise.all(
      rows.map((row) =>
        ctx.db
          .query("vectors")
          .withIndex("by_modelVersion_source_viewKey", (q) =>
            q.eq("modelVersion", row.modelVersion).eq("source", "corpus").eq("viewKey", row.viewKey),
          )
          .unique(),
      ),
    );
  },
});

export const upsertVectors = internalAction({
  args: { rows: v.array(vectorRow) },
  returns: vectorIds,
  handler: (ctx, { rows }): Promise<Infer<typeof vectorIds>> =>
    withErrorReporting("ingest.upsertVectors", async () => {
      checkBatch(rows);
      for (const row of rows) {
        if (row.vector.length !== model.embeddingDim) {
          throw new ConvexError({
            code: "bad_dimension",
            objectKey: row.objectKey,
            expected: model.embeddingDim,
            actual: row.vector.length,
          });
        }
      }
      const hashes = await Promise.all(rows.map((row) => vectorHash(row.vector)));
      const existing = await ctx.runQuery(internal.ingest.existingVectors, {
        rows: rows.map(({ modelVersion, viewKey }) => ({ modelVersion, viewKey })),
      });
      return withVectorArchives(
        ctx,
        rows.map((row, index) => ({
          vector: row.vector,
          archiveId: existing[index]?.contentHash === hashes[index] ? existing[index]?.archiveId : undefined,
        })),
        async (archiveIds) => {
          const ids: Record<string, Id<"vectors">> = {};
          const archived = rows.map((row, index) => ({ ...row, archiveId: archiveIds[index] }));
          for (let start = 0; start < archived.length; start += 100) {
            const result = await ctx.runMutation(internal.ingest.commitVectors, {
              rows: archived.slice(start, start + 100),
            });
            Object.assign(ids, result.ids);
          }
          return { ids };
        },
      );
    }),
});

export const commitVectors = internalMutation({
  args: { rows: v.array(vectorRow.extend({ archiveId: v.id("files") })) },
  returns: v.object({ ids: v.record(v.string(), v.id("vectors")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"vectors">> = {};
    let inserted = 0;
    for (const row of rows) {
      if (row.vector.length !== model.embeddingDim) {
        throw new ConvexError({
          code: "bad_dimension",
          objectKey: row.objectKey,
          expected: model.embeddingDim,
          actual: row.vector.length,
        });
      }
      const object = await requireByKey(ctx, "objects", row.objectKey);
      const doc = {
        objectId: object._id,
        partition: recognitionPartition(row.modelVersion),
        modelVersion: row.modelVersion,
        source: row.source,
        viewKey: row.viewKey,
        vector: row.vector,
        archiveId: row.archiveId,
      };
      const existing = await ctx.db
        .query("vectors")
        .withIndex("by_modelVersion_source_viewKey", (q) =>
          q.eq("modelVersion", row.modelVersion).eq("source", row.source).eq("viewKey", row.viewKey),
        )
        .unique();
      const naturalKey = `${row.modelVersion}|${row.source}|${row.viewKey}`;
      if (existing) {
        await replaceVector(ctx, existing, doc);
        ids[naturalKey] = existing._id;
      } else {
        ids[naturalKey] = await insertVector(ctx, doc);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, "vectors", inserted);
    if (rows.length > 0) await ctx.scheduler.runAfter(0, internal.vectorSync.drain, {});
    return { ids };
  },
});

const descriptorReference = v.object({
  objectKey: v.string(),
  storageId: v.id("files"),
  sha256: v.string(),
  keypointCount: v.number(),
  inputSize: v.number(),
  extractedFrom: v.string(),
});
const descriptorIds = v.object({
  ids: v.record(v.string(), v.id("objects")),
});

export const existingDescriptors = internalQuery({
  args: { objectKeys: v.array(v.string()) },
  returns: v.array(v.union(descriptorReference, v.null())),
  handler: async (ctx, { objectKeys }) => {
    checkBatch(objectKeys);
    return Promise.all(
      objectKeys.map(async (objectKey) => {
        const object = await requireByKey(ctx, "objects", objectKey);
        const row = await readObjectOrb(ctx, object);
        if (!row || !(await fileStorage.getMetadata(ctx, row.storageId))) {
          return null;
        }
        const { storageId, sha256, keypointCount, inputSize, extractedFrom } = row;
        return {
          objectKey,
          storageId,
          sha256,
          keypointCount,
          inputSize,
          extractedFrom,
        };
      }),
    );
  },
});

export const commitDescriptors = internalMutation({
  args: { rows: v.array(descriptorReference) },
  returns: descriptorIds,
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"objects">> = {};
    const replaced: Id<"files">[] = [];
    let inserted = 0;
    for (const { objectKey, ...reference } of rows) {
      const file = await fileStorage.getMetadata(ctx, reference.storageId);
      if (!file || file.size !== reference.keypointCount * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)) {
        throw new ConvexError({
          code: "bad_orb_file",
          storageId: reference.storageId,
        });
      }
      const object = await requireByKey(ctx, "objects", objectKey);
      const existing = await readObjectOrb(ctx, object);
      await retainFile(ctx, reference.storageId);
      await patchObjectDetails(ctx, object, { orb: reference });
      ids[objectKey] = object._id;
      if (existing) {
        if (existing.storageId !== reference.storageId) replaced.push(existing.storageId);
      } else {
        inserted += 1;
      }
    }
    for (const storageId of replaced) {
      await deleteOrbIfUnreferenced(ctx, storageId);
    }
    await bumpCounter(ctx, "descriptors", inserted);
    return { ids };
  },
});

export const upsertDescriptors = internalAction({
  args: { rows: v.array(descriptorRow) },
  returns: descriptorIds,
  handler: async (ctx, { rows }): Promise<Infer<typeof descriptorIds>> =>
    withErrorReporting("ingest.upsertDescriptors", async () => {
      checkBatch(rows);
      if (new Set(rows.map((row) => row.objectKey)).size !== rows.length) {
        throw new ConvexError({ code: "duplicate_descriptor_keys" });
      }
      // Validate the entire batch before creating files, including the preserved zero-keypoint case.
      const packed = rows.map((row) => {
        if (
          !Number.isInteger(row.keypointCount)
          || row.keypointCount < 0
          || row.keypointCount > MAX_KEYPOINTS
          || row.inputSize !== model.inputSize
          || row.descriptors.byteLength !== row.keypointCount * DESCRIPTOR_BYTES
          || row.keypoints.byteLength !== row.keypointCount * KEYPOINT_BYTES
        ) {
          throw new ConvexError({
            code: "bad_descriptors",
            objectKey: row.objectKey,
          });
        }
        return packOrb(row.descriptors, row.keypoints);
      });
      const existing = await ctx.runQuery(internal.ingest.existingDescriptors, {
        objectKeys: rows.map((row) => row.objectKey),
      });
      const created: Id<"files">[] = [];
      const references: Infer<typeof descriptorReference>[] = [];
      try {
        for (let start = 0; start < rows.length; start += 8) {
          const results = await Promise.allSettled(
            rows.slice(start, start + 8).map(async (row, offset) => {
              const i = start + offset;
              const sha256 = await orbHash(packed[i]);
              let storageId = existing[i]?.sha256 === sha256 ? existing[i]!.storageId : undefined;
              if (!storageId) {
                storageId = await fileStorage.store(ctx, new Blob([packed[i]], { type: ORB_CONTENT_TYPE }));
                created.push(storageId);
              }
              return {
                objectKey: row.objectKey,
                storageId,
                sha256,
                keypointCount: row.keypointCount,
                inputSize: row.inputSize,
                extractedFrom: row.extractedFrom,
              };
            }),
          );
          for (const result of results) {
            if (result.status === "rejected") throw result.reason;
            references.push(result.value);
          }
        }
        return await ctx.runMutation(internal.ingest.commitDescriptors, {
          rows: references,
        });
      } finally {
        if (created.length > 0) {
          await ctx.runMutation(internal.orbFiles.discard, {
            storageIds: created,
          });
        }
      }
    }),
});

export const setObjectPenalty = internalMutation({
  args: { rows: v.array(penaltyRow) },
  returns: v.object({ ids: v.record(v.string(), v.id("objects")) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<"objects">> = {};
    for (const row of rows) {
      const object = await requireByKey(ctx, "objects", row.objectKey);
      if (object.calibratorPenalty !== row.calibratorPenalty) {
        await ctx.db.patch("objects", object._id, { calibratorPenalty: row.calibratorPenalty });
      }
      ids[row.objectKey] = object._id;
    }
    return { ids };
  },
});

export const counts = internalQuery({
  args: {},
  returns: v.object(countsShape),
  handler: async (ctx) => {
    const result = { ...zeroCounts };
    for (const shard of await ctx.db.query("ingestCounters").withIndex("by_shard").take(64)) {
      for (const key of Object.keys(zeroCounts) as (keyof Counters)[]) result[key] += shard[key];
    }
    return result;
  },
});

export const exportVenues = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("museums"),
        key: v.string(),
        wikidataId: v.optional(v.string()),
        name: v.string(),
        lat: v.number(),
        lng: v.number(),
        website: v.optional(v.string()),
        city: v.optional(v.string()),
        cityKey: v.optional(v.string()),
        country: v.optional(v.string()),
        region: v.string(),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query("museums").paginate({ numItems: EXPORT_PAGE_SIZE, cursor: cursor ?? null });
    return {
      page: result.page.map((m) => ({
        _id: m._id,
        key: m.key,
        wikidataId: m.wikidataId,
        name: m.name,
        lat: m.lat,
        lng: m.lng,
        website: m.website,
        region: m.region,
        city: m.city,
        cityKey: m.cityKey,
        country: m.country,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

const trainingObject = v.object({
  objectId: v.id("objects"),
  key: v.string(),
  source: objectSource,
  imageRef: v.optional(v.string()),
  rightsStatus,
  objectPenalty: v.number(),
});

export const exportVectorRows = internalQuery({
  args: { modelVersion: v.string(), cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(
      v.object({
        vectorId: v.id("vectors"),
        vector: schema.doc("vectors"),
        object: trainingObject,
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { modelVersion, cursor }) => {
    const result = await ctx.db
      .query("vectors")
      .withIndex("by_modelVersion_source_viewKey", (q) => q.eq("modelVersion", modelVersion))
      .paginate({
        numItems: TRAINING_EXPORT_PAGE_SIZE,
        cursor: cursor ?? null,
        maximumBytesRead: TRAINING_EXPORT_BYTES,
      });
    const page = [];
    for (const row of result.page) {
      let object = await ctx.db.get("objects", row.objectId);
      if (!object || object.identityStatus !== "established" || !(await eligibleVector(ctx, row))) {
        continue;
      }
      if (object.mergedInto) object = await ctx.db.get("objects", object.mergedInto);
      // Match identify.loadCandidates: only one-hop merges are part of the active index.
      if (!object || object.identityStatus !== "established" || !(await eligibleObject(ctx, object))) {
        continue;
      }
      const artwork = await ctx.db.get("artworks", object.artworkId);
      if (!artwork) continue;
      const details = await readObjectDetails(ctx, object);
      page.push({
        vectorId: row._id,
        vector: row,
        object: {
          objectId: object._id,
          key: object.key,
          source: object.source,
          imageRef: details?.imageRef,
          rightsStatus: artwork.rightsStatus,
          objectPenalty: effectiveObjectPenalty(object),
        },
      });
    }
    return {
      page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const exportVectors = internalAction({
  args: { modelVersion: v.string(), cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(v.object({ vectorId: v.id("vectors"), vector: v.array(v.float64()), object: trainingObject })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: (
    ctx,
    args,
  ): Promise<{
    page: { vectorId: Id<"vectors">; vector: number[]; object: Infer<typeof trainingObject> }[];
    continueCursor: string;
    isDone: boolean;
  }> =>
    withErrorReporting("ingest.exportVectors", async () => {
      const result = await ctx.runQuery(internal.ingest.exportVectorRows, args);
      const page = [];
      for (const row of result.page) page.push({ ...row, vector: await readVector(ctx, row.vector) });
      return { ...result, page };
    }),
});

export const exportDescriptorReferences = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(
      v.object({
        objectId: v.id("objects"),
        storageId: v.id("files"),
        keypointCount: v.number(),
        inputSize: v.number(),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("objects")
      .withIndex("by_creation_time")
      .paginate({
        numItems: Math.floor(TRAINING_EXPORT_BYTES / (MAX_KEYPOINTS * (DESCRIPTOR_BYTES + KEYPOINT_BYTES))),
        cursor: cursor ?? null,
        maximumBytesRead: TRAINING_EXPORT_BYTES,
      });
    const page = [];
    for (const object of result.page) {
      if (object.identityStatus !== "established" || !(await eligibleObject(ctx, object))) continue;
      const row = await readObjectOrb(ctx, object);
      if (!row) continue;
      page.push({
        objectId: object._id,
        storageId: row.storageId,
        keypointCount: row.keypointCount,
        inputSize: row.inputSize,
      });
    }
    return {
      page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

const descriptorExport = v.object({
  page: v.array(
    v.object({
      objectId: v.id("objects"),
      descriptors: v.bytes(),
      keypoints: v.bytes(),
      keypointCount: v.number(),
      inputSize: v.number(),
    }),
  ),
  continueCursor: v.string(),
  isDone: v.boolean(),
});

export const exportDescriptors = internalAction({
  args: { cursor: v.optional(v.string()) },
  returns: descriptorExport,
  handler: async (ctx, args): Promise<Infer<typeof descriptorExport>> =>
    withErrorReporting("ingest.exportDescriptors", async () => {
      const result = await ctx.runQuery(internal.ingest.exportDescriptorReferences, args);
      const page = [];
      for (let start = 0; start < result.page.length; start += 8) {
        page.push(
          ...(await Promise.all(
            result.page.slice(start, start + 8).map(async ({ storageId, ...row }) => ({
              ...row,
              ...(await loadOrb(ctx, storageId, row.keypointCount)),
            })),
          )),
        );
      }
      return { ...result, page };
    }),
});

export const auditThumbnails = internalQuery({
  args: { cursor: v.optional(v.string()), objectKeys: v.optional(v.array(v.string())) },
  returns: v.object({
    checked: v.number(),
    violations: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, objectKeys }) => {
    if (objectKeys) checkBatch(objectKeys);
    const page = objectKeys
      ? {
          page: await Promise.all(objectKeys.map((key) => requireByKey(ctx, "objects", key))),
          isDone: true,
          continueCursor: "",
        }
      : await ctx.db
          .query("objects")
          .withIndex("by_key")
          .paginate({ cursor: cursor ?? null, numItems: 500 });
    let violations = 0;
    for (const object of page.page) {
      const details = await readObjectDetails(ctx, object);
      if (details?.thumbnailUrl !== undefined) {
        const artwork = await ctx.db.get("artworks", object.artworkId);
        if (artwork?.rightsStatus !== "public_domain") violations += 1;
      }
    }
    return {
      checked: page.page.length,
      violations,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const countExisting = internalQuery({
  args: {
    table: v.union(
      v.literal("artworks"),
      v.literal("objects"),
      v.literal("placements"),
      v.literal("vectors"),
      v.literal("descriptors"),
    ),
    rows: v.array(
      v.object({
        key: v.string(),
        venueKey: v.optional(v.string()),
        modelVersion: v.optional(v.string()),
        source: v.optional(v.string()),
        viewKey: v.optional(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { table, rows }) => {
    checkBatch(rows);
    let count = 0;
    for (const row of rows) {
      if (table === "artworks" || table === "objects") {
        if (await findByKey(ctx, table, row.key)) count += 1;
        continue;
      }
      if (table === "vectors") {
        if (!row.modelVersion || !row.source || !row.viewKey) {
          throw new ConvexError({ code: "bad_vector_identity" });
        }
        if (
          await ctx.db
            .query("vectors")
            .withIndex("by_modelVersion_source_viewKey", (q) =>
              q
                .eq("modelVersion", row.modelVersion!)
                .eq("source", row.source as Doc<"vectors">["source"])
                .eq("viewKey", row.viewKey),
            )
            .unique()
        ) {
          count += 1;
        }
        continue;
      }
      const object = await findByKey(ctx, "objects", row.key);
      if (!object) continue;
      if (table === "descriptors") {
        if (await readObjectOrb(ctx, object)) {
          count += 1;
        }
      } else {
        const venue = row.venueKey && (await findByKey(ctx, "museums", row.venueKey));
        if (venue && (await findPlacement(ctx, object._id, venue._id, row.source as Doc<"placements">["source"]))) {
          count += 1;
        }
      }
    }
    return count;
  },
});

function pickFields<T extends object, F extends Record<string, unknown>>(
  row: T,
  fields: F,
): Pick<T, Extract<keyof T, keyof F>> {
  return Object.fromEntries(
    Object.keys(fields)
      .filter((key) => row[key as keyof T] !== undefined)
      .map((key) => [key, row[key as keyof T]]),
  ) as Pick<T, Extract<keyof T, keyof F>>;
}

const sampleArgs = { table: importTable, rows: v.array(importIdentity) };
const storedSample = v.array(
  v.union(
    v.null(),
    artworkRow,
    objectRow,
    placementRow,
    vectorRow.omit("vector").extend({ reference: schema.doc("vectors") }),
    descriptorReference,
    penaltyRow,
  ),
);

// Only the selected natural keys are read; a sample never pages through the corpus.
export const readSampleRows = internalQuery({
  args: sampleArgs,
  returns: storedSample,
  handler: async (ctx, { table, rows }): Promise<Infer<typeof storedSample>> => {
    if (rows.length > 32) throw new ConvexError({ code: "batch_too_large", max: 32 });
    const result: Infer<typeof storedSample> = [];
    for (const row of rows) {
      if (table === "artworks") {
        const artwork = await findByKey(ctx, "artworks", row.key);
        result.push(artwork ? pickFields(artwork, artworkRow.fields) : null);
        continue;
      }
      if (table === "vectors") {
        if (!row.modelVersion || row.source !== "corpus" || !row.viewKey) {
          throw new ConvexError({ code: "bad_vector_identity" });
        }
        const vector = await ctx.db
          .query("vectors")
          .withIndex("by_modelVersion_source_viewKey", (q) =>
            q.eq("modelVersion", row.modelVersion!).eq("source", "corpus").eq("viewKey", row.viewKey),
          )
          .unique();
        const object = vector ? await ctx.db.get("objects", vector.objectId) : null;
        result.push(
          vector && object
            ? {
                objectKey: object.key,
                modelVersion: vector.modelVersion,
                source: "corpus" as const,
                viewKey: vector.viewKey!,
                reference: vector,
              }
            : null,
        );
        continue;
      }
      const object = await findByKey(ctx, "objects", row.key);
      if (!object) {
        result.push(null);
        continue;
      }
      if (table === "objects") {
        const details = await readObjectDetails(ctx, object);
        const artwork = await ctx.db.get("artworks", object.artworkId);
        const owner = object.ownerId ? await ctx.db.get("museums", object.ownerId) : null;
        const mergedInto = object.mergedInto ? await ctx.db.get("objects", object.mergedInto) : null;
        result.push(
          artwork
            ? {
                ...pickFields({ ...object, ...details }, objectRow.fields),
                artworkKey: artwork.key,
                ownerKey: owner?.key,
                mergedIntoKey: mergedInto?.key,
              }
            : null,
        );
      } else if (table === "penalties") {
        result.push({ objectKey: object.key, calibratorPenalty: object.calibratorPenalty });
      } else if (table === "descriptors") {
        const descriptor = await readObjectOrb(ctx, object);
        result.push(
          descriptor ? { ...pickFields(descriptor, descriptorReference.fields), objectKey: object.key } : null,
        );
      } else {
        const venue = row.venueKey ? await findByKey(ctx, "museums", row.venueKey) : null;
        const placement = venue
          ? await findPlacement(ctx, object._id, venue._id, row.source as Doc<"placements">["source"])
          : null;
        result.push(
          placement && venue
            ? { ...pickFields(placement, placementRow.fields), objectKey: object.key, venueKey: venue.key }
            : null,
        );
      }
    }
    return result;
  },
});

const readback = v.array(v.union(v.null(), artworkRow, objectRow, placementRow, vectorRow, descriptorRow, penaltyRow));
export const readSample = internalAction({
  args: sampleArgs,
  returns: readback,
  handler: (ctx, args): Promise<Infer<typeof readback>> =>
    withErrorReporting("ingest.readSample", async () => {
      const rows = await ctx.runQuery(internal.ingest.readSampleRows, args);
      const result = [];
      for (const row of rows) {
        if (row && "reference" in row) {
          const { reference, ...fields } = row;
          result.push({ ...fields, vector: await readVector(ctx, reference) });
        } else if (row && "storageId" in row) {
          const { storageId, sha256: _sha256, ...fields } = row;
          result.push({ ...fields, ...(await loadOrb(ctx, storageId, row.keypointCount)) });
        } else {
          result.push(row);
        }
      }
      return result;
    }),
});

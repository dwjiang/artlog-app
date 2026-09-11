// The Python ↔ Convex ingest contract (plan 02.01). Every function is admin-key only and every
// upsert is idempotent on its natural key; changing a row shape means changing
// jobs/artlog_jobs in the same PR.
import { ConvexError, v } from 'convex/values';

import model from '../shared/model-version.json';
import { registerMuseumObject } from './lib/museumWorkIdentity';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import {
  multiplicity,
  objectSource,
  placementSource,
  rightsStatus,
  seedSource,
  vectorSource,
} from './lib/validators';

export const MAX_BATCH_ROWS = 500;
export const EXPORT_PAGE_SIZE = 1000;
const DESCRIPTOR_BYTES = 32;
const KEYPOINT_BYTES = 16;
const MAX_KEYPOINTS = 1000;

const museumRow = v.object({
  key: v.string(),
  wikidataId: v.optional(v.string()),
  name: v.string(),
  lat: v.number(),
  lng: v.number(),
  website: v.optional(v.string()),
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
  source: vectorSource,
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

const penaltyRow = v.object({ objectKey: v.string(), calibratorPenalty: v.number() });

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

type KeyedTable = 'artworks' | 'objects' | 'museums';

function checkBatch(rows: unknown[]) {
  if (rows.length > MAX_BATCH_ROWS) {
    throw new ConvexError({ code: 'batch_too_large', max: MAX_BATCH_ROWS, size: rows.length });
  }
}

async function findByKey<T extends KeyedTable>(ctx: QueryCtx, table: T, key: string) {
  const doc = await ctx.db
    .query(table as KeyedTable)
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  return doc as Doc<T> | null;
}

async function requireByKey<T extends KeyedTable>(ctx: QueryCtx, table: T, key: string) {
  const doc = await findByKey(ctx, table, key);
  if (doc === null) throw new ConvexError({ code: 'unknown_key', table, key });
  return doc;
}

export async function bumpCounter(ctx: MutationCtx, table: keyof Counters, inserted: number) {
  if (inserted === 0) return;
  const existing = await ctx.db.query('ingestCounters').first();
  if (existing === null) {
    await ctx.db.insert('ingestCounters', { ...zeroCounts, [table]: inserted });
  } else {
    await ctx.db.patch(existing._id, { [table]: existing[table] + inserted });
  }
}

export const upsertMuseums = internalMutation({
  args: { rows: v.array(museumRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('museums')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'museums'>> = {};
    let inserted = 0;
    for (const row of rows) {
      const fields = {
        key: row.key,
        wikidataId: row.wikidataId,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        website: row.website,
        region: row.region,
        seedSource: row.seedSource,
      };
      const existing = await findByKey(ctx, 'museums', row.key);
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert('museums', {
          ...fields,
          optOut: false,
        });
        inserted += 1;
      }
    }
    await bumpCounter(ctx, 'museums', inserted);
    return { ids };
  },
});

export const upsertArtworks = internalMutation({
  args: { rows: v.array(artworkRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('artworks')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'artworks'>> = {};
    let inserted = 0;
    for (const row of rows) {
      const fields = {
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
      const existing = await findByKey(ctx, 'artworks', row.key);
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert('artworks', fields);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, 'artworks', inserted);
    return { ids };
  },
});

// Rows that name a `mergedIntoKey` must follow the object they merge into (an earlier batch or
// an earlier row); the counters and provenance of an existing object are never overwritten.
export const upsertObjects = internalMutation({
  args: { rows: v.array(objectRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('objects')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'objects'>> = {};
    let inserted = 0;
    for (const row of rows) {
      const artwork = await requireByKey(ctx, 'artworks', row.artworkKey);
      if (row.thumbnailUrl !== undefined && artwork.rightsStatus !== 'public_domain') {
        throw new ConvexError({ code: 'thumbnail_rights', objectKey: row.key });
      }
      const owner = row.ownerKey ? await requireByKey(ctx, 'museums', row.ownerKey) : null;
      const mergedInto = row.mergedIntoKey
        ? await requireByKey(ctx, 'objects', row.mergedIntoKey)
        : null;
      const fields = {
        key: row.key,
        artworkId: artwork._id,
        ownerId: owner?._id,
        accession: row.accession,
        medium: row.medium,
        dimensions: row.dimensions,
        source: row.source,
        sourceId: row.sourceId,
        imageRef: row.imageRef,
        pageUrl: row.pageUrl,
        thumbnailUrl: row.thumbnailUrl,
        mergedInto: mergedInto?._id,
      };
      const existing = await findByKey(ctx, 'objects', row.key);
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        ids[row.key] = existing._id;
      } else {
        ids[row.key] = await ctx.db.insert('objects', {
          ...fields,
          confirmCount: 0,
          rejectCount: 0,
          calibratorPenalty: 0,
          reverted: false,
        });
        inserted += 1;
      }
      await registerMuseumObject(ctx, {
        ...fields,
        artworkId: mergedInto?.artworkId ?? fields.artworkId,
      });
    }
    await bumpCounter(ctx, 'objects', inserted);
    return { ids };
  },
});

export const upsertPlacements = internalMutation({
  args: { rows: v.array(placementRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('placements')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'placements'>> = {};
    let inserted = 0;
    for (const row of rows) {
      const object = await requireByKey(ctx, 'objects', row.objectKey);
      const venue = await requireByKey(ctx, 'museums', row.venueKey);
      const doc = {
        objectId: object._id,
        venueId: venue._id,
        gallery: row.gallery,
        onView: row.onView,
        from: row.from,
        to: row.to,
        source: row.source,
        confidence: row.confidence,
      };
      const existing = await ctx.db.query('placements')
        .withIndex('by_objectId_venueId_source', q => q.eq('objectId', object._id).eq('venueId', venue._id).eq('source', row.source)).unique();
      const naturalKey = `${row.objectKey}|${row.venueKey}|${row.source}`;
      if (existing) {
        await ctx.db.replace(existing._id, doc);
        ids[naturalKey] = existing._id;
      } else {
        ids[naturalKey] = await ctx.db.insert('placements', doc);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, 'placements', inserted);
    return { ids };
  },
});

export const upsertVectors = internalMutation({
  args: { rows: v.array(vectorRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('vectors')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'vectors'>> = {};
    let inserted = 0;
    for (const row of rows) {
      if (row.vector.length !== model.embeddingDim) {
        throw new ConvexError({
          code: 'bad_dimension',
          objectKey: row.objectKey,
          expected: model.embeddingDim,
          actual: row.vector.length,
        });
      }
      const object = await requireByKey(ctx, 'objects', row.objectKey);
      const doc = {
        objectId: object._id,
        modelVersion: row.modelVersion,
        source: row.source,
        viewKey: row.viewKey,
        vector: row.vector,
      };
      const existing = await ctx.db
        .query('vectors')
        .withIndex('by_modelVersion_source_viewKey', (q) =>
          q.eq('modelVersion', row.modelVersion).eq('source', row.source).eq('viewKey', row.viewKey)
        )
        .unique();
      const naturalKey = `${row.modelVersion}|${row.source}|${row.viewKey}`;
      if (existing) {
        await ctx.db.replace(existing._id, doc);
        ids[naturalKey] = existing._id;
      } else {
        ids[naturalKey] = await ctx.db.insert('vectors', doc);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, 'vectors', inserted);
    return { ids };
  },
});

export const upsertDescriptors = internalMutation({
  args: { rows: v.array(descriptorRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('descriptors')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'descriptors'>> = {};
    let inserted = 0;
    for (const row of rows) {
      const wellFormed =
        Number.isInteger(row.keypointCount) &&
        row.keypointCount >= 0 &&
        row.keypointCount <= MAX_KEYPOINTS &&
        row.descriptors.byteLength === row.keypointCount * DESCRIPTOR_BYTES &&
        row.keypoints.byteLength === row.keypointCount * KEYPOINT_BYTES;
      if (!wellFormed) {
        throw new ConvexError({
          code: 'bad_descriptors',
          objectKey: row.objectKey,
          keypointCount: row.keypointCount,
          descriptorBytes: row.descriptors.byteLength,
          keypointBytes: row.keypoints.byteLength,
        });
      }
      const object = await requireByKey(ctx, 'objects', row.objectKey);
      const doc = {
        objectId: object._id,
        descriptors: row.descriptors,
        keypoints: row.keypoints,
        keypointCount: row.keypointCount,
        inputSize: row.inputSize,
        extractedFrom: row.extractedFrom,
      };
      const existing = await ctx.db
        .query('descriptors')
        .withIndex('by_objectId', (q) => q.eq('objectId', object._id))
        .first();
      if (existing) {
        await ctx.db.replace(existing._id, doc);
        ids[row.objectKey] = existing._id;
      } else {
        ids[row.objectKey] = await ctx.db.insert('descriptors', doc);
        inserted += 1;
      }
    }
    await bumpCounter(ctx, 'descriptors', inserted);
    return { ids };
  },
});

export const setObjectPenalty = internalMutation({
  args: { rows: v.array(penaltyRow) },
  returns: v.object({ ids: v.record(v.string(), v.id('objects')) }),
  handler: async (ctx, { rows }) => {
    checkBatch(rows);
    const ids: Record<string, Id<'objects'>> = {};
    for (const row of rows) {
      const object = await requireByKey(ctx, 'objects', row.objectKey);
      await ctx.db.patch(object._id, { calibratorPenalty: row.calibratorPenalty });
      ids[row.objectKey] = object._id;
    }
    return { ids };
  },
});

export const counts = internalQuery({
  args: {},
  returns: v.object(countsShape),
  handler: async (ctx) => {
    const counters = await ctx.db.query('ingestCounters').first();
    if (counters === null) return zeroCounts;
    return {
      museums: counters.museums,
      artworks: counters.artworks,
      objects: counters.objects,
      placements: counters.placements,
      vectors: counters.vectors,
      descriptors: counters.descriptors,
    };
  },
});

export const exportVenues = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id('museums'),
        key: v.string(),
        wikidataId: v.optional(v.string()),
        name: v.string(),
        lat: v.number(),
        lng: v.number(),
        website: v.optional(v.string()),
        region: v.string(),
      })
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query('museums')
      .paginate({ numItems: EXPORT_PAGE_SIZE, cursor: cursor ?? null });
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
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const auditThumbnails = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ checked: v.number(), violations: v.number(), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('objects').withIndex('by_key')
      .paginate({ cursor: cursor ?? null, numItems: 500 });
    let violations = 0;
    for (const object of page.page) {
      if (object.thumbnailUrl !== undefined) {
        const artwork = await ctx.db.get(object.artworkId);
        if (artwork?.rightsStatus !== 'public_domain') violations += 1;
      }
    }
    return { checked: page.page.length, violations, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const countExisting = internalQuery({
  args: {
    table: v.union(v.literal('artworks'), v.literal('objects'), v.literal('placements'), v.literal('vectors'), v.literal('descriptors')),
    rows: v.array(v.object({ key: v.string(), venueKey: v.optional(v.string()), modelVersion: v.optional(v.string()), source: v.optional(v.string()), viewKey: v.optional(v.string()) })),
  },
  returns: v.number(),
  handler: async (ctx, { table, rows }) => {
    checkBatch(rows);
    let count = 0;
    for (const row of rows) {
      if (table === 'artworks' || table === 'objects') {
        if (await findByKey(ctx, table, row.key)) count += 1;
        continue;
      }
      if (table === 'vectors') {
        if (!row.modelVersion || !row.source || !row.viewKey) throw new ConvexError({ code: 'bad_vector_identity' });
        if (await ctx.db.query('vectors').withIndex('by_modelVersion_source_viewKey', q =>
          q.eq('modelVersion', row.modelVersion!).eq('source', row.source as Doc<'vectors'>['source']).eq('viewKey', row.viewKey)).unique()) count += 1;
        continue;
      }
      const object = await findByKey(ctx, 'objects', row.key);
      if (!object) continue;
      if (table === 'descriptors') {
        if (await ctx.db.query('descriptors').withIndex('by_objectId', q => q.eq('objectId', object._id)).first()) count += 1;
      } else {
        const venue = row.venueKey && await findByKey(ctx, 'museums', row.venueKey);
        if (venue && await ctx.db.query('placements').withIndex('by_objectId_venueId_source', q => q.eq('objectId', object._id)
          .eq('venueId', venue._id).eq('source', row.source as Doc<'placements'>['source'])).unique()) count += 1;
      }
    }
    return count;
  },
});

/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import model from '../shared/model-version.json';
import { internal } from './_generated/api';
import { EXPORT_PAGE_SIZE, MAX_BATCH_ROWS } from './ingest';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const met = {
  key: 'wikidata:Q160236',
  wikidataId: 'Q160236',
  name: 'The Metropolitan Museum of Art',
  lat: 40.7794,
  lng: -73.9632,
  website: 'https://www.metmuseum.org',
  region: 'us-ny',
  seedSource: 'wikidata' as const,
};

const wheatField = {
  key: 'met:436535',
  wikidataId: 'Q18891167',
  title: 'Wheat Field with Cypresses',
  artist: 'Vincent van Gogh',
  artistId: 'Q5582',
  date: '1889',
  yearStart: 1889,
  yearEnd: 1889,
  rightsStatus: 'public_domain' as const,
  multiplicity: 'multiple' as const,
};

const metObject = {
  key: 'met:436535',
  artworkKey: 'met:436535',
  ownerKey: 'wikidata:Q160236',
  accession: '1993.132',
  medium: 'Oil on canvas',
  source: 'corpus' as const,
  sourceId: '436535',
  imageRef: 'https://images.metmuseum.org/CRDImages/ep/original/DP-42549-001.jpg',
  pageUrl: 'https://www.metmuseum.org/art/collection/search/436535',
  thumbnailUrl: 'https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg',
};

function vector(seed: number) {
  return Array.from({ length: model.embeddingDim }, (_, i) => ((i + seed) % 7) / 7);
}

async function seeded() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
  await t.mutation(internal.ingest.upsertArtworks, { rows: [wheatField] });
  const { ids } = await t.mutation(internal.ingest.upsertObjects, { rows: [metObject] });
  return { t, objectId: ids['met:436535'] };
}

async function errorData(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data;
    throw error;
  }
  throw new Error('expected a ConvexError');
}

describe('upserting museums and artworks', () => {
  it('inserts once, then updates the same row on a second upsert', async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    const second = await t.mutation(internal.ingest.upsertMuseums, {
      rows: [{ ...met, name: 'The Met', website: undefined }],
    });

    expect(second.ids[met.key]).toBe(first.ids[met.key]);
    const museums = await t.run((ctx) => ctx.db.query('museums').collect());
    expect(museums).toHaveLength(1);
    expect(museums[0].name).toBe('The Met');
    expect(museums[0].website).toBeUndefined();
    expect(museums[0].indexStatus.status).toBe('none');
    expect(museums[0].optOut).toBe(false);
  });

  it('keeps artwork enrichment while refreshing the ingested fields', async () => {
    const t = convexTest(schema, modules);
    const { ids } = await t.mutation(internal.ingest.upsertArtworks, { rows: [wheatField] });
    await t.run((ctx) =>
      ctx.db.patch(ids[wheatField.key], {
        factSheet: [{ id: 'f1', text: 'x', sourceUrl: 'u', sourceLabel: 'l', sourceScore: 1 }],
      })
    );
    await t.mutation(internal.ingest.upsertArtworks, {
      rows: [{ ...wheatField, title: 'Wheatfield with Cypresses' }],
    });

    const artwork = await t.run((ctx) => ctx.db.get(ids[wheatField.key]));
    expect(artwork?.title).toBe('Wheatfield with Cypresses');
    expect(artwork?.factSheet).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query('artworks').collect())).toHaveLength(1);
  });

  it('rejects batches over the row limit', async () => {
    const t = convexTest(schema, modules);
    const rows = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => ({
      ...met,
      key: `poi:${i}`,
      wikidataId: undefined,
    }));
    expect(await errorData(t.mutation(internal.ingest.upsertMuseums, { rows }))).toMatchObject({
      code: 'batch_too_large',
    });
  });
});

describe('upserting objects', () => {
  it('resolves artwork and owner keys and initializes counters only on insert', async () => {
    const { t, objectId } = await seeded();
    await t.run((ctx) => ctx.db.patch(objectId, { confirmCount: 3, calibratorPenalty: 0.2 }));

    const again = await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, medium: 'Oil on canvas (relined)' }],
    });

    expect(again.ids['met:436535']).toBe(objectId);
    const object = await t.run((ctx) => ctx.db.get(objectId));
    const artwork = await t.run((ctx) => ctx.db.get(object!.artworkId));
    const owner = await t.run((ctx) => ctx.db.get(object!.ownerId!));
    expect(artwork?.key).toBe('met:436535');
    expect(owner?.key).toBe('wikidata:Q160236');
    expect(object?.medium).toBe('Oil on canvas (relined)');
    expect(object?.confirmCount).toBe(3);
    expect(object?.calibratorPenalty).toBe(0.2);
    expect(object?.reverted).toBe(false);
  });

  it('throws unknown_key for an artwork, owner or merge target that does not exist', async () => {
    const { t } = await seeded();
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: 'met:1', artworkKey: 'met:missing' }],
        })
      )
    ).toEqual({ code: 'unknown_key', table: 'artworks', key: 'met:missing' });
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: 'met:1', ownerKey: 'wikidata:Q0' }],
        })
      )
    ).toMatchObject({ code: 'unknown_key', table: 'museums' });
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: 'met:1', mergedIntoKey: 'met:nope' }],
        })
      )
    ).toMatchObject({ code: 'unknown_key', table: 'objects' });
    expect(await t.run((ctx) => ctx.db.query('objects').collect())).toHaveLength(1);
  });

  it('links mergedIntoKey to an earlier object', async () => {
    const { t, objectId } = await seeded();
    const { ids } = await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, key: 'wikidata:Q18891167', source: 'corpus', mergedIntoKey: 'met:436535' }],
    });
    const merged = await t.run((ctx) => ctx.db.get(ids['wikidata:Q18891167']));
    expect(merged?.mergedInto).toBe(objectId);
  });

  it('sets a calibrator penalty by key', async () => {
    const { t, objectId } = await seeded();
    await t.mutation(internal.ingest.setObjectPenalty, {
      rows: [{ objectKey: 'met:436535', calibratorPenalty: 0.35 }],
    });
    expect((await t.run((ctx) => ctx.db.get(objectId)))?.calibratorPenalty).toBe(0.35);
  });
});

describe('placements, vectors and descriptors', () => {
  it('replaces the placement with the same object, venue and source', async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: 'met:436535',
      venueKey: 'wikidata:Q160236',
      gallery: '822',
      onView: true,
      source: 'feed' as const,
      confidence: 0.9,
    };
    await t.mutation(internal.ingest.upsertPlacements, { rows: [row] });
    await t.mutation(internal.ingest.upsertPlacements, {
      rows: [
        { ...row, gallery: '825' },
        { ...row, source: 'wikidata', confidence: 0.6 },
      ],
    });

    const placements = await t.run((ctx) =>
      ctx.db
        .query('placements')
        .withIndex('by_objectId', (q) => q.eq('objectId', objectId))
        .collect()
    );
    expect(placements).toHaveLength(2);
    expect(placements.find((p) => p.source === 'feed')?.gallery).toBe('825');
    expect(placements.find((p) => p.source === 'wikidata')?.confidence).toBe(0.6);
  });

  it('replaces vectors per model version and source and checks the dimension', async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: 'met:436535',
      modelVersion: model.modelVersion,
      source: 'corpus' as const,
      vector: vector(1),
    };
    await t.mutation(internal.ingest.upsertVectors, { rows: [row] });
    await t.mutation(internal.ingest.upsertVectors, {
      rows: [
        { ...row, vector: vector(2) },
        { ...row, source: 'crawl', vector: vector(3) },
      ],
    });

    const vectors = await t.run((ctx) =>
      ctx.db
        .query('vectors')
        .withIndex('by_objectId_modelVersion_source', (q) =>
          q.eq('objectId', objectId).eq('modelVersion', model.modelVersion)
        )
        .collect()
    );
    expect(vectors).toHaveLength(2);
    expect(vectors.find((vec) => vec.source === 'corpus')?.vector[1]).toBe(vector(2)[1]);

    expect(
      await errorData(
        t.mutation(internal.ingest.upsertVectors, { rows: [{ ...row, vector: [0.1, 0.2] }] })
      )
    ).toMatchObject({ code: 'bad_dimension', expected: model.embeddingDim, actual: 2 });
  });

  it('updates a full vector batch with multiple sources within transaction limits', async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    await t.mutation(internal.ingest.upsertArtworks, { rows: [wheatField] });
    const objectRows = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => ({
      ...metObject,
      key: `met:batch-${i}`,
    }));
    const objects = await t.mutation(internal.ingest.upsertObjects, { rows: objectRows });
    const rows = objectRows.map(({ key }) => ({
      objectKey: key,
      modelVersion: model.modelVersion,
      source: 'corpus' as const,
      vector: vector(1),
    }));
    const original = await t.mutation(internal.ingest.upsertVectors, { rows });
    for (const source of ['crawl', 'user'] as const) {
      await t.mutation(internal.ingest.upsertVectors, {
        rows: rows.map((row) => ({ ...row, source })),
      });
    }

    const updated = await t.mutation(internal.ingest.upsertVectors, {
      rows: rows.map((row) => ({ ...row, vector: vector(2) })),
    });
    expect(updated.ids).toEqual(original.ids);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(MAX_BATCH_ROWS * 3);
    for (const object of [objectRows[0], objectRows[MAX_BATCH_ROWS - 1]]) {
      const vectors = await t.run((ctx) =>
        ctx.db
          .query('vectors')
          .withIndex('by_objectId_modelVersion_source', (q) =>
            q.eq('objectId', objects.ids[object.key]).eq('modelVersion', model.modelVersion)
          )
          .collect()
      );
      expect(vectors).toHaveLength(3);
      expect(vectors.find((row) => row.source === 'corpus')?.vector).toEqual(vector(2));
      expect(vectors.find((row) => row.source === 'crawl')?.vector).toEqual(vector(1));
      expect(vectors.find((row) => row.source === 'user')?.vector).toEqual(vector(1));
    }
  });

  it('stores one descriptor set per object and rejects malformed bytes', async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: 'met:436535',
      descriptors: new Uint8Array(2 * 32).fill(7).buffer,
      keypoints: new Float32Array([1, 2, 31, 90, 3, 4, 31, 180]).buffer,
      keypointCount: 2,
      inputSize: model.inputSize,
      extractedFrom: metObject.imageRef,
    };
    await t.mutation(internal.ingest.upsertDescriptors, { rows: [row] });
    await t.mutation(internal.ingest.upsertDescriptors, {
      rows: [{ ...row, extractedFrom: 'contribution:abc' }],
    });

    const stored = await t.run((ctx) =>
      ctx.db
        .query('descriptors')
        .withIndex('by_objectId', (q) => q.eq('objectId', objectId))
        .collect()
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].extractedFrom).toBe('contribution:abc');
    expect(stored[0].descriptors.byteLength).toBe(64);

    expect(
      await errorData(
        t.mutation(internal.ingest.upsertDescriptors, { rows: [{ ...row, keypointCount: 3 }] })
      )
    ).toMatchObject({ code: 'bad_descriptors' });
  });
});

describe('counts', () => {
  it('counts inserts, not updates', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.ingest.counts, {})).toEqual({
      museums: 0,
      artworks: 0,
      objects: 0,
      placements: 0,
      vectors: 0,
      descriptors: 0,
    });

    const { t: seededT } = await seeded();
    await seededT.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    await seededT.mutation(internal.ingest.upsertArtworks, {
      rows: [wheatField, { ...wheatField, key: 'aic:1', wikidataId: undefined }],
    });
    await seededT.mutation(internal.ingest.upsertPlacements, {
      rows: [
        {
          objectKey: 'met:436535',
          venueKey: 'wikidata:Q160236',
          onView: true,
          source: 'feed',
          confidence: 0.9,
        },
      ],
    });

    expect(await seededT.query(internal.ingest.counts, {})).toEqual({
      museums: 1,
      artworks: 2,
      objects: 1,
      placements: 1,
      vectors: 0,
      descriptors: 0,
    });
  });
});

describe('exportVenues', () => {
  it('pages through every venue with a continue cursor', async () => {
    const t = convexTest(schema, modules);
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 5 }, (_, i) => ({
      ...met,
      key: `poi:${i}`,
      wikidataId: undefined,
      name: `Venue ${i}`,
    }));
    await t.mutation(internal.ingest.upsertMuseums, { rows: rows.slice(0, MAX_BATCH_ROWS) });
    await t.mutation(internal.ingest.upsertMuseums, {
      rows: rows.slice(MAX_BATCH_ROWS, 2 * MAX_BATCH_ROWS),
    });
    await t.mutation(internal.ingest.upsertMuseums, { rows: rows.slice(2 * MAX_BATCH_ROWS) });

    const first = await t.query(internal.ingest.exportVenues, {});
    expect(first.page).toHaveLength(EXPORT_PAGE_SIZE);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({ key: 'poi:0', name: 'Venue 0', region: 'us-ny' });
    expect(Object.keys(first.page[0]).sort()).toEqual([
      '_id',
      'key',
      'lat',
      'lng',
      'name',
      'region',
      'website',
    ]);

    const second = await t.query(internal.ingest.exportVenues, { cursor: first.continueCursor });
    expect(second.page).toHaveLength(5);
    expect(second.isDone).toBe(true);
    const keys = new Set([...first.page, ...second.page].map((m) => m.key));
    expect(keys.size).toBe(EXPORT_PAGE_SIZE + 5);
  });
});

import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import {
  upsertArtworks,
  upsertObjects,
  upsertPlacements,
  setObjectPenalty,
  EXPORT_PAGE_SIZE,
  MAX_BATCH_ROWS,
} from "./ingest";
import { importTestVectors, importTestDescriptors } from "./ingest.test.helpers";
import { patchArtworkContent, readArtworkContent } from "./lib/artworkContent";
import { fileStorage } from "./lib/fileStorage";
import { readObjectDetails } from "./lib/objectDetails";
import { loadOrb } from "./lib/orbStorage";
import { readTestOrb } from "./lib/testFactories";
import { readVector } from "./lib/vectorStore";
import { harness } from "./test.helpers";

const orbRow = {
  objectKey: "met:436535",
  descriptors: new Uint8Array(64).fill(7).buffer,
  keypoints: new Float32Array([1, 2, 31, 90, 3, 4, 31, 180]).buffer,
  keypointCount: 2,
  inputSize: model.inputSize,
  extractedFrom: "test reference",
};

const met = {
  key: "wikidata:Q160236",
  wikidataId: "Q160236",
  name: "The Metropolitan Museum of Art",
  lat: 40.7794,
  lng: -73.9632,
  website: "https://www.metmuseum.org",
  region: "us-ny",
  seedSource: "wikidata" as const,
};

const wheatField = {
  key: "met:436535",
  wikidataId: "Q18891167",
  title: "Wheat Field with Cypresses",
  artist: "Vincent van Gogh",
  artistId: "Q5582",
  date: "1889",
  yearStart: 1889,
  yearEnd: 1889,
  rightsStatus: "public_domain" as const,
  multiplicity: "multiple" as const,
};

const metObject = {
  key: "met:436535",
  artworkKey: "met:436535",
  ownerKey: "wikidata:Q160236",
  accession: "1993.132",
  medium: "Oil on canvas",
  source: "corpus" as const,
  sourceId: "436535",
  imageRef: "https://images.metmuseum.org/CRDImages/ep/original/DP-42549-001.jpg",
  pageUrl: "https://www.metmuseum.org/art/collection/search/436535",
  thumbnailUrl: "https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg",
};

function vector(seed: number) {
  return Array.from({ length: model.embeddingDim }, (_, i) => ((i + seed) % 7) / 7);
}

async function seeded() {
  const t = harness();
  await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
  await t.mutation(internal.ingest.upsertArtworks, { rows: [wheatField] });
  const { ids } = await t.mutation(internal.ingest.upsertObjects, {
    rows: [metObject],
  });
  return { t, objectId: ids["met:436535"] };
}

async function errorData(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConvexError) return error.data;
    throw error;
  }
  throw new Error("expected a ConvexError");
}

it("does not rewrite unchanged artwork, object, placement or zero-penalty rows", async () => {
  const { t } = await seeded();
  const placement = {
    objectKey: metObject.key,
    venueKey: met.key,
    onView: true,
    source: "feed" as const,
    confidence: 1,
  };
  await t.mutation(internal.ingest.upsertPlacements, { rows: [placement] });
  await t.run(async (ctx) => {
    const patch = vi.spyOn(ctx.db, "patch");
    const replace = vi.spyOn(ctx.db, "replace");
    const insert = vi.spyOn(ctx.db, "insert");
    for (const [fn, rows] of [
      [upsertArtworks, [wheatField]],
      [upsertObjects, [metObject]],
      [upsertPlacements, [placement]],
      [setObjectPenalty, [{ objectKey: metObject.key, calibratorPenalty: 0 }]],
    ] as const) {
      const handler = (fn as unknown as { _handler: (ctx: MutationCtx, args: { rows: unknown }) => Promise<unknown> })
        ._handler;
      await handler(ctx, { rows });
    }
    expect(patch).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

it("reads only requested sample identities, including actual vector and ORB bytes", async () => {
  const { t } = await seeded();
  const row = {
    objectKey: metObject.key,
    source: "corpus" as const,
    modelVersion: model.modelVersion,
    viewKey: "met:alternate",
    vector: vector(1),
  };
  await importTestVectors(t, { rows: [row] });
  await importTestDescriptors(t, { rows: [orbRow] });
  expect(
    await t.action(internal.ingest.readSample, {
      table: "artworks",
      rows: [{ key: wheatField.key }, { key: "missing" }],
    }),
  ).toEqual([wheatField, null]);
  expect(await t.action(internal.ingest.readSample, { table: "objects", rows: [{ key: metObject.key }] })).toEqual([
    metObject,
  ]);
  expect(
    await t.action(internal.ingest.readSample, {
      table: "vectors",
      rows: [{ key: row.viewKey, viewKey: row.viewKey, source: row.source, modelVersion: row.modelVersion }],
    }),
  ).toEqual([row]);
  expect(await t.action(internal.ingest.readSample, { table: "descriptors", rows: [{ key: metObject.key }] })).toEqual([
    orbRow,
  ]);
  await expect(
    t.query(internal.ingest.readSampleRows, {
      table: "artworks",
      rows: Array.from({ length: 33 }, () => ({ key: wheatField.key })),
    }),
  ).rejects.toMatchObject({ data: { code: "batch_too_large" } });
});

describe("upserting museums and artworks", () => {
  it("inserts once, then updates the same row on a second upsert", async () => {
    const t = harness();
    const first = await t.mutation(internal.ingest.upsertMuseums, {
      rows: [met],
    });
    const second = await t.mutation(internal.ingest.upsertMuseums, {
      rows: [{ ...met, name: "The Met", website: undefined }],
    });

    expect(second.ids[met.key]).toBe(first.ids[met.key]);
    const museums = await t.run((ctx) => ctx.db.query("museums").collect());
    expect(museums).toHaveLength(1);
    expect(museums[0].name).toBe("The Met");
    expect(museums[0].website).toBeUndefined();
    expect(museums[0].optOut).toBe(false);
  });

  it("inserts missing museums while atomically preserving existing documents when insertOnly is set", async () => {
    const t = harness();
    const { ids } = await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    const museumId = ids[met.key];
    const survivor = await t.run((ctx) =>
      ctx.db.insert("museums", {
        ...met,
        key: "survivor",
        optOut: false,
        contributionRevision: 0,
      }),
    );
    await t.run((ctx) =>
      ctx.db.patch("museums", museumId, {
        optOut: true,
        excludedFromDiscovery: true,
        mergedInto: survivor,
        contributionRevision: 9,
        city: "New York City",
        cityKey: "wikidata:Q60",
        country: "US",
        collectionSiteUrl: "https://www.metmuseum.org/art/collection",
        platform: "emuseum",
        accessionUrlPattern: "https://www.metmuseum.org/art/collection/search/{accession}",
      }),
    );
    const before = await t.run((ctx) => ctx.db.get("museums", museumId));
    const checkpoint = await t.query(internal.venueChanges.latestVersion, {});
    const rows = [
      {
        ...met,
        name: "Replacement name",
        website: undefined,
        lat: 1,
        lng: 2,
        region: "replacement",
        seedSource: "manual" as const,
      },
      { ...met, key: "new-museum", name: "New Museum" },
    ];
    const result = await t.mutation(internal.ingest.upsertMuseums, { rows, insertOnly: true });
    expect(result.ids[met.key]).toBe(museumId);
    expect(await t.run((ctx) => ctx.db.get("museums", museumId))).toEqual(before);
    expect(await t.run((ctx) => ctx.db.get("museums", result.ids["new-museum"]))).toMatchObject({
      key: "new-museum",
      name: "New Museum",
      optOut: false,
      contributionRevision: 0,
    });
    expect((await t.query(internal.ingest.counts, {})).museums).toBe(2);
    const changes = await t.query(internal.venueChanges.latestVersion, {});
    expect(changes).toBe(checkpoint + 1);
    expect(await t.mutation(internal.ingest.upsertMuseums, { rows, insertOnly: true })).toEqual(result);
    expect(await t.query(internal.venueChanges.latestVersion, {})).toBe(changes);
    expect((await t.query(internal.ingest.counts, {})).museums).toBe(2);
    expect(await t.run((ctx) => ctx.db.get("museums", museumId))).toEqual(before);
  });

  it("keeps artwork enrichment while refreshing the ingested fields", async () => {
    const t = harness();
    const { ids } = await t.mutation(internal.ingest.upsertArtworks, {
      rows: [wheatField],
    });
    await t.run((ctx) =>
      patchArtworkContent(
        ctx,
        { _id: ids[wheatField.key] },
        {
          factSheet: [
            {
              id: "f1",
              text: "x",
              sourceUrl: "u",
              sourceLabel: "l",
              sourceScore: 1,
            },
          ],
        },
      ),
    );
    await t.mutation(internal.ingest.upsertArtworks, {
      rows: [{ ...wheatField, title: "Wheatfield with Cypresses" }],
    });

    const artwork = await t.run((ctx) => ctx.db.get("artworks", ids[wheatField.key]));
    expect(artwork?.title).toBe("Wheatfield with Cypresses");
    expect((await t.run((ctx) => readArtworkContent(ctx, artwork!)))?.factSheet).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("artworks").collect())).toHaveLength(1);
  });

  it("rejects batches over the row limit", async () => {
    const t = harness();
    const rows = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => ({
      ...met,
      key: `poi:${i}`,
      wikidataId: undefined,
    }));
    expect(await errorData(t.mutation(internal.ingest.upsertMuseums, { rows }))).toMatchObject({
      code: "batch_too_large",
    });
  });
});

describe("upserting objects", () => {
  it("retains corrected corpus identity mappings for takedown checks", async () => {
    const { t, objectId } = await seeded();
    const corrected = {
      ...wheatField,
      key: "met:corrected",
      title: "Cypresses",
      wikidataId: undefined,
    };
    const { ids } = await t.mutation(internal.ingest.upsertArtworks, {
      rows: [corrected],
    });
    await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, artworkKey: corrected.key }],
    });
    expect((await t.run((ctx) => ctx.db.get("objects", objectId)))?.artworkId).toBe(ids[corrected.key]);
    const bindings = await t.run((ctx) => ctx.db.query("museumWorkIdentities").collect());
    expect(bindings.every((binding) => binding.artworkId === ids[corrected.key])).toBe(true);
  });

  it("resolves artwork and owner keys and initializes counters only on insert", async () => {
    const { t, objectId } = await seeded();
    await t.run((ctx) => ctx.db.patch("objects", objectId, { confirmCount: 3, calibratorPenalty: 0.2 }));

    const again = await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, medium: "Oil on canvas (relined)" }],
    });

    expect(again.ids["met:436535"]).toBe(objectId);
    const object = await t.run((ctx) => ctx.db.get("objects", objectId));
    const artwork = await t.run((ctx) => ctx.db.get("artworks", object!.artworkId));
    const owner = await t.run((ctx) => ctx.db.get("museums", object!.ownerId!));
    expect(artwork?.key).toBe("met:436535");
    expect(owner?.key).toBe("wikidata:Q160236");
    expect((await t.run((ctx) => readObjectDetails(ctx, object!)))?.medium).toBe("Oil on canvas (relined)");
    expect(object?.confirmCount).toBe(3);
    expect(object?.calibratorPenalty).toBe(0.2);
    expect(object?.reverted).toBe(false);
  });

  it("clears omitted imported details and removes the empty row while retaining object identity", async () => {
    const { t, objectId } = await seeded();
    const original = (await t.run((ctx) => ctx.db.get("objects", objectId)))!;
    expect(original.detailsId).toBeDefined();
    const minimal = {
      key: metObject.key,
      artworkKey: metObject.artworkKey,
      ownerKey: metObject.ownerKey,
      accession: metObject.accession,
      source: metObject.source,
      sourceId: metObject.sourceId,
    };
    const again = await t.mutation(internal.ingest.upsertObjects, { rows: [minimal] });
    expect(again.ids[metObject.key]).toBe(objectId);
    const object = (await t.run((ctx) => ctx.db.get("objects", objectId)))!;
    expect(object.detailsId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("objectDetails", original.detailsId!))).toBeNull();
    expect(await t.action(internal.ingest.readSample, { table: "objects", rows: [{ key: metObject.key }] })).toEqual([
      minimal,
    ]);
    await t.mutation(internal.ingest.upsertObjects, { rows: [{ ...minimal, key: "met:no-details" }] });
    expect(await t.run((ctx) => ctx.db.query("objectDetails").collect())).toEqual([]);
    expect((await t.query(internal.ingest.counts, {})).objects).toBe(2);
  });

  it("throws unknown_key for an artwork, owner or merge target that does not exist", async () => {
    const { t } = await seeded();
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: "met:1", artworkKey: "met:missing" }],
        }),
      ),
    ).toEqual({ code: "unknown_key", table: "artworks", key: "met:missing" });
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: "met:1", ownerKey: "wikidata:Q0" }],
        }),
      ),
    ).toMatchObject({ code: "unknown_key", table: "museums" });
    expect(
      await errorData(
        t.mutation(internal.ingest.upsertObjects, {
          rows: [{ ...metObject, key: "met:1", mergedIntoKey: "met:nope" }],
        }),
      ),
    ).toMatchObject({ code: "unknown_key", table: "objects" });
    expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(1);
  });

  it("links mergedIntoKey to an earlier object", async () => {
    const { t, objectId } = await seeded();
    const { ids } = await t.mutation(internal.ingest.upsertObjects, {
      rows: [
        {
          ...metObject,
          key: "wikidata:Q18891167",
          source: "corpus",
          mergedIntoKey: "met:436535",
        },
      ],
    });
    const merged = await t.run((ctx) => ctx.db.get("objects", ids["wikidata:Q18891167"]));
    expect(merged?.mergedInto).toBe(objectId);
  });

  it("sets a calibrator penalty by key", async () => {
    const { t, objectId } = await seeded();
    await t.mutation(internal.ingest.setObjectPenalty, {
      rows: [{ objectKey: "met:436535", calibratorPenalty: 0.35 }],
    });
    expect((await t.run((ctx) => ctx.db.get("objects", objectId)))?.calibratorPenalty).toBe(0.35);
  });
});

describe("placements, vectors and descriptors", () => {
  it("replaces the placement with the same object, venue and source", async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: "met:436535",
      venueKey: "wikidata:Q160236",
      gallery: "822",
      onView: true,
      source: "feed" as const,
      confidence: 0.9,
    };
    await t.mutation(internal.ingest.upsertPlacements, { rows: [row] });
    await t.mutation(internal.ingest.upsertPlacements, {
      rows: [
        { ...row, gallery: "825" },
        { ...row, source: "wikidata", confidence: 0.6 },
      ],
    });

    const placements = await t.run((ctx) =>
      ctx.db
        .query("placements")
        .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
        .collect(),
    );
    expect(placements).toHaveLength(2);
    expect(placements.find((p) => p.source === "feed")?.gallery).toBe("825");
    expect(placements.find((p) => p.source === "wikidata")?.confidence).toBe(0.6);
  });

  it("replaces corpus vectors by view and checks the dimension", async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: "met:436535",
      modelVersion: model.modelVersion,
      source: "corpus" as const,
      viewKey: "primary",
      vector: vector(1),
    };
    await importTestVectors(t, { rows: [row] });
    await importTestVectors(t, {
      rows: [
        { ...row, vector: vector(2) },
        { ...row, viewKey: "second-view", vector: vector(3) },
      ],
    });

    const vectors = await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) =>
          q.eq("objectId", objectId).eq("modelVersion", model.modelVersion),
        )
        .collect(),
    );
    expect(vectors).toHaveLength(2);
    expect(
      (
        await t.run((ctx) =>
          readVector(
            ctx,
            vectors.find((vec) => vec.viewKey === "primary")!,
          ),
        )
      )[1],
    ).toBe(vector(2)[1]);

    expect(
      await errorData(
        importTestVectors(t, {
          rows: [{ ...row, vector: [0.1, 0.2] }],
        }),
      ),
    ).toMatchObject({
      code: "bad_vector",
    });
  });

  // Exercise the full import size, including archive uploads, under transaction limits.
  it("updates a full vector batch with multiple views within transaction limits", { timeout: 60_000 }, async () => {
    const t = harness({ transactionLimits: true });
    await t.mutation(internal.ingest.upsertMuseums, { rows: [met] });
    await t.mutation(internal.ingest.upsertArtworks, { rows: [wheatField] });
    const objectRows = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => ({
      ...metObject,
      key: `met:batch-${i}`,
    }));
    const objects = await t.mutation(internal.ingest.upsertObjects, {
      rows: objectRows,
    });
    const rows = objectRows.map(({ key }) => ({
      objectKey: key,
      modelVersion: model.modelVersion,
      source: "corpus" as const,
      viewKey: key,
      vector: vector(1),
    }));
    const original = await importTestVectors(t, {
      rows,
    });
    for (const view of ["second", "third"]) {
      await importTestVectors(t, {
        rows: rows.map((row) => ({
          ...row,
          viewKey: `${row.viewKey}:${view}`,
        })),
      });
    }

    const updated = await importTestVectors(t, {
      rows: rows.map((row) => ({ ...row, vector: vector(2) })),
    });
    expect(updated.ids).toEqual(original.ids);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(MAX_BATCH_ROWS * 3);
    for (const object of [objectRows[0], objectRows[MAX_BATCH_ROWS - 1]]) {
      const vectors = await t.run((ctx) =>
        ctx.db
          .query("vectors")
          .withIndex("by_objectId_modelVersion_source", (q) =>
            q.eq("objectId", objects.ids[object.key]).eq("modelVersion", model.modelVersion),
          )
          .collect(),
      );
      expect(vectors).toHaveLength(3);
      expect(
        await t.run((ctx) =>
          readVector(
            ctx,
            vectors.find((row) => row.viewKey === object.key)!,
          ),
        ),
      ).toEqual(vector(2));
      expect(
        await t.run((ctx) =>
          readVector(
            ctx,
            vectors.find((row) => row.viewKey === `${object.key}:second`)!,
          ),
        ),
      ).toEqual(vector(1));
      expect(
        await t.run((ctx) =>
          readVector(
            ctx,
            vectors.find((row) => row.viewKey === `${object.key}:third`)!,
          ),
        ),
      ).toEqual(vector(1));
    }
  });

  it("stores one descriptor set per object and rejects malformed bytes", async () => {
    const { t, objectId } = await seeded();
    const row = {
      objectKey: "met:436535",
      descriptors: new Uint8Array(2 * 32).fill(7).buffer,
      keypoints: new Float32Array([1, 2, 31, 90, 3, 4, 31, 180]).buffer,
      keypointCount: 2,
      inputSize: model.inputSize,
      extractedFrom: metObject.imageRef,
    };
    await importTestDescriptors(t, { rows: [row] });
    await importTestDescriptors(t, {
      rows: [{ ...row, extractedFrom: "contribution:abc" }],
    });

    const stored = await t.run((ctx) => readTestOrb(ctx, objectId).then((orb) => (orb ? [orb] : [])));
    expect(stored).toHaveLength(1);
    expect(stored[0].extractedFrom).toBe("contribution:abc");
    expect(stored[0]).not.toHaveProperty("descriptors");
    expect(stored[0]).not.toHaveProperty("keypoints");
    expect(await t.run(async (ctx) => (await fileStorage.get(ctx, stored[0].storageId))!.size)).toBe(96);

    expect(
      await errorData(
        importTestDescriptors(t, {
          rows: [{ ...row, keypointCount: 3 }],
        }),
      ),
    ).toMatchObject({ code: "bad_orb_file" });
  });
});

describe("ORB file imports", () => {
  it("reuses identical bytes on replay and deletes the previous file when the bytes change", async () => {
    const { t } = await seeded();
    const first = await importTestDescriptors(t, {
      rows: [orbRow],
    });
    const before = (await t.run((ctx) => readTestOrb(ctx, first.ids[orbRow.objectKey])))!;
    expect(
      await importTestDescriptors(t, {
        rows: [{ ...orbRow, extractedFrom: "new URL" }],
      }),
    ).toEqual(first);
    expect(await t.run((ctx) => readTestOrb(ctx, first.ids[orbRow.objectKey]))).toMatchObject({
      storageId: before.storageId,
      extractedFrom: "new URL",
    });
    expect(await t.run((ctx) => loadOrb(ctx, before.storageId, before.keypointCount))).toEqual({
      descriptors: orbRow.descriptors,
      keypoints: orbRow.keypoints,
    });

    const changed = {
      ...orbRow,
      descriptors: new Uint8Array(64).fill(8).buffer,
    };
    expect(await importTestDescriptors(t, { rows: [changed] })).toEqual(first);
    const after = (await t.run((ctx) => readTestOrb(ctx, first.ids[orbRow.objectKey])))!;
    expect(after.storageId).not.toBe(before.storageId);
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, before.storageId))).toBeNull();
    expect(
      await t.run(async (ctx) => (await ctx.db.query("files").collect()).filter((file) => file.state === "ready")),
    ).toHaveLength(1);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      descriptors: 1,
    });
  });
});

describe("counts", () => {
  it("counts inserts, not updates", async () => {
    const t = harness();
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
      rows: [wheatField, { ...wheatField, key: "aic:1", wikidataId: undefined }],
    });
    await seededT.mutation(internal.ingest.upsertPlacements, {
      rows: [
        {
          objectKey: "met:436535",
          venueKey: "wikidata:Q160236",
          onView: true,
          source: "feed",
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

describe("exportVenues", () => {
  it("pages through every venue with a continue cursor", async () => {
    const t = harness();
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 5 }, (_, i) => ({
      ...met,
      key: `poi:${i}`,
      wikidataId: undefined,
      name: `Venue ${i}`,
    }));
    await t.mutation(internal.ingest.upsertMuseums, {
      rows: rows.slice(0, MAX_BATCH_ROWS),
    });
    await t.mutation(internal.ingest.upsertMuseums, {
      rows: rows.slice(MAX_BATCH_ROWS, 2 * MAX_BATCH_ROWS),
    });
    await t.mutation(internal.ingest.upsertMuseums, {
      rows: rows.slice(2 * MAX_BATCH_ROWS),
    });

    const first = await t.query(internal.ingest.exportVenues, {});
    expect(first.page).toHaveLength(EXPORT_PAGE_SIZE);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({
      key: "poi:0",
      name: "Venue 0",
      region: "us-ny",
    });
    expect(Object.keys(first.page[0]).sort()).toEqual(["_id", "key", "lat", "lng", "name", "region", "website"]);

    const second = await t.query(internal.ingest.exportVenues, {
      cursor: first.continueCursor,
    });
    expect(second.page).toHaveLength(5);
    expect(second.isDone).toBe(true);
    const keys = new Set([...first.page, ...second.page].map((m) => m.key));
    expect(keys.size).toBe(EXPORT_PAGE_SIZE + 5);
  });
});

describe("corpus import invariants", () => {
  it("preserves alternate corpus views and replaces each view idempotently", async () => {
    const { t, objectId } = await seeded();
    const rows = ["met:1", "wikidata:Q1"].map((viewKey, i) => ({
      objectKey: metObject.key,
      modelVersion: model.modelVersion,
      source: "corpus" as const,
      viewKey,
      vector: vector(i),
    }));
    const first = await importTestVectors(t, { rows });
    const second = await importTestVectors(t, {
      rows: [{ ...rows[1], vector: vector(9) }],
    });
    expect(Object.values(first.ids)).toContain(Object.values(second.ids)[0]);
    const stored = await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
        .collect(),
    );
    expect(stored).toHaveLength(2);
    expect(
      await t.run((ctx) =>
        readVector(
          ctx,
          stored.find((row) => row.viewKey === "met:1")!,
        ),
      ),
    ).toEqual(vector(0));
    expect(
      await t.run((ctx) =>
        readVector(
          ctx,
          stored.find((row) => row.viewKey === "wikidata:Q1")!,
        ),
      ),
    ).toEqual(vector(9));
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  });

  it("rejects unauthorized thumbnails and audits existing violations", async () => {
    const { t, objectId } = await seeded();
    await t.mutation(internal.ingest.upsertArtworks, {
      rows: [{ ...wheatField, rightsStatus: "unknown" }],
    });
    expect(await errorData(t.mutation(internal.ingest.upsertObjects, { rows: [metObject] }))).toMatchObject({
      code: "thumbnail_rights",
    });
    expect(await t.query(internal.ingest.auditThumbnails, {})).toMatchObject({
      checked: 1,
      violations: 1,
      isDone: true,
    });
    await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, thumbnailUrl: undefined }],
    });
    expect((await t.query(internal.ingest.auditThumbnails, {})).violations).toBe(0);
    expect(
      await t.run(async (ctx) => readObjectDetails(ctx, (await ctx.db.get("objects", objectId))!)),
    ).not.toHaveProperty("thumbnailUrl");
  });
});

describe("rebuilding corpus views", () => {
  it("moves a stable view to its new survivor without leaving a second searchable vector", async () => {
    const { t } = await seeded();
    const { ids } = await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, key: "met:survivor" }],
    });
    const row = {
      objectKey: metObject.key,
      modelVersion: model.modelVersion,
      source: "corpus" as const,
      viewKey: metObject.key,
      vector: vector(1),
    };
    const first = await importTestVectors(t, {
      rows: [row],
    });
    const second = await importTestVectors(t, {
      rows: [{ ...row, objectKey: "met:survivor" }],
    });
    expect(second).toEqual(first);
    const vectors = await t.run((ctx) => ctx.db.query("vectors").collect());
    expect(vectors).toHaveLength(1);
    expect(vectors[0].objectId).toBe(ids["met:survivor"]);
    expect(
      await t.query(internal.ingest.countExisting, {
        table: "vectors",
        rows: [
          {
            key: "not-yet-inserted-survivor",
            source: row.source,
            viewKey: row.viewKey,
            modelVersion: row.modelVersion,
          },
        ],
      }),
    ).toBe(1);
  });
});

describe("merged museum identities", () => {
  it("resolves an alias accession and page to the surviving artwork", async () => {
    const { t, objectId } = await seeded();
    const original = await t.run((ctx) => ctx.db.get("objects", objectId));
    const alternate = {
      ...wheatField,
      key: "wikidata:Qalias",
      wikidataId: undefined,
    };
    await t.mutation(internal.ingest.upsertArtworks, { rows: [alternate] });
    await t.mutation(internal.ingest.upsertObjects, {
      rows: [
        {
          ...metObject,
          key: "wikidata:Qalias",
          artworkKey: alternate.key,
          pageUrl: "https://museum.example/alternate-view",
          mergedIntoKey: metObject.key,
        },
      ],
    });
    const identities = await t.run((ctx) => ctx.db.query("museumWorkIdentities").collect());
    expect(identities).toHaveLength(3);
    expect(identities.every((row) => row.artworkId === original?.artworkId)).toBe(true);
  });
});

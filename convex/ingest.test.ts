/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
  upsertArtworks,
  upsertObjects,
  upsertPlacements,
  setObjectPenalty,
  EXPORT_PAGE_SIZE,
  MAX_BATCH_ROWS,
  TRAINING_EXPORT_PAGE_SIZE,
  upsertDescriptors,
} from "./ingest";
import { loadOrb } from "./lib/orbStorage";
import { insertVector, readVector } from "./lib/vectorStore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const runDescriptorImport = (
  upsertDescriptors as unknown as {
    _handler: (
      ctx: ActionCtx,
      args: FunctionArgs<typeof internal.ingest.upsertDescriptors>,
    ) => Promise<FunctionReturnType<typeof internal.ingest.upsertDescriptors>>;
  }
)._handler;

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
  const t = convexTest(schema, modules);
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
  await t.mutation(internal.ingest.upsertVectors, { rows: [row] });
  await t.action(internal.ingest.upsertDescriptors, { rows: [orbRow] });
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

describe("calibrator training exports", () => {
  it("exports only the requested model, resolves merged views and retains sampling rights and penalties", async () => {
    const { t, objectId } = await seeded();
    const { ids } = await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, key: "met:alias", mergedIntoKey: metObject.key }],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("objects", objectId, {
        calibratorPenalty: 0.3,
        rejectionPenalty: 0.2,
      });
      for (const [id, version] of [
        [objectId, "old"],
        [ids["met:alias"], model.modelVersion],
      ] as const) {
        await insertVector(ctx, {
          partition: JSON.stringify([version, "established"]),
          objectId: id,
          modelVersion: version,
          source: "corpus",
          vector: vector(1),
        });
      }
    });
    const page = await t.query(internal.ingest.exportVectors, {
      modelVersion: model.modelVersion,
    });
    expect(page.isDone).toBe(true);
    expect(page.page).toHaveLength(1);
    expect(page.page[0].object).toEqual({
      objectId,
      key: metObject.key,
      source: "corpus",
      imageRef: metObject.imageRef,
      rightsStatus: "public_domain",
      objectPenalty: 0.5,
    });
    expect(page.page[0].vector).toEqual(vector(1));
    await t.run((ctx) => ctx.db.patch("objects", objectId, { reverted: true }));
    expect(
      (
        await t.query(internal.ingest.exportVectors, {
          modelVersion: model.modelVersion,
        })
      ).page,
    ).toEqual([]);
  });

  it("pages vectors without dropping or repeating views", async () => {
    const { t, objectId } = await seeded();
    await t.run(async (ctx) => {
      for (let i = 0; i < TRAINING_EXPORT_PAGE_SIZE + 1; i++) {
        await insertVector(ctx, {
          partition: JSON.stringify([model.modelVersion, "established"]),
          objectId,
          modelVersion: model.modelVersion,
          source: "corpus",
          viewKey: String(i),
          vector: vector(i),
        });
      }
    });
    const ids = new Set<string>();
    let cursor: string | undefined;
    let done = false;
    let pages = 0;
    while (!done) {
      const result = await t.query(internal.ingest.exportVectors, {
        modelVersion: model.modelVersion,
        cursor,
      });
      expect(result.page.length).toBeLessThanOrEqual(TRAINING_EXPORT_PAGE_SIZE);
      for (const row of result.page) {
        expect(ids.has(row.vectorId)).toBe(false);
        ids.add(row.vectorId);
      }
      cursor = result.continueCursor;
      done = result.isDone;
      pages++;
    }
    expect(pages).toBeGreaterThan(1);
    expect(ids.size).toBe(TRAINING_EXPORT_PAGE_SIZE + 1);
  });

  it("preserves descriptor bytes and zero counts, excluding superseded references", async () => {
    const { t, objectId } = await seeded();
    await t.action(internal.ingest.upsertDescriptors, {
      rows: [
        {
          objectKey: metObject.key,
          descriptors: new ArrayBuffer(0),
          keypoints: new ArrayBuffer(0),
          keypointCount: 0,
          inputSize: 512,
          extractedFrom: metObject.imageRef,
        },
      ],
    });
    const page = await t.action(internal.ingest.exportDescriptors, {});
    expect(page.page).toEqual([
      {
        objectId,
        descriptors: new ArrayBuffer(0),
        keypoints: new ArrayBuffer(0),
        keypointCount: 0,
        inputSize: 512,
      },
    ]);
    await t.run((ctx) => ctx.db.patch("objects", objectId, { mergedInto: objectId }));
    expect((await t.action(internal.ingest.exportDescriptors, {})).page).toEqual([]);
  });
});

describe("upserting museums and artworks", () => {
  it("inserts once, then updates the same row on a second upsert", async () => {
    const t = convexTest(schema, modules);
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

  it("keeps artwork enrichment while refreshing the ingested fields", async () => {
    const t = convexTest(schema, modules);
    const { ids } = await t.mutation(internal.ingest.upsertArtworks, {
      rows: [wheatField],
    });
    await t.run((ctx) =>
      ctx.db.patch("artworks", ids[wheatField.key], {
        factSheet: [
          {
            id: "f1",
            text: "x",
            sourceUrl: "u",
            sourceLabel: "l",
            sourceScore: 1,
          },
        ],
      }),
    );
    await t.mutation(internal.ingest.upsertArtworks, {
      rows: [{ ...wheatField, title: "Wheatfield with Cypresses" }],
    });

    const artwork = await t.run((ctx) => ctx.db.get("artworks", ids[wheatField.key]));
    expect(artwork?.title).toBe("Wheatfield with Cypresses");
    expect(artwork?.factSheet).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("artworks").collect())).toHaveLength(1);
  });

  it("rejects batches over the row limit", async () => {
    const t = convexTest(schema, modules);
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
    expect(object?.medium).toBe("Oil on canvas (relined)");
    expect(object?.confirmCount).toBe(3);
    expect(object?.calibratorPenalty).toBe(0.2);
    expect(object?.reverted).toBe(false);
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
    await t.mutation(internal.ingest.upsertVectors, { rows: [row] });
    await t.mutation(internal.ingest.upsertVectors, {
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
        t.mutation(internal.ingest.upsertVectors, {
          rows: [{ ...row, vector: [0.1, 0.2] }],
        }),
      ),
    ).toMatchObject({
      code: "bad_dimension",
      expected: model.embeddingDim,
      actual: 2,
    });
  });

  // A full-dimension batch under transaction limits takes ~2 s alone and more under parallel suite load.
  it("updates a full vector batch with multiple views within transaction limits", { timeout: 20_000 }, async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
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
    const original = await t.mutation(internal.ingest.upsertVectors, {
      rows,
    });
    for (const view of ["second", "third"]) {
      await t.mutation(internal.ingest.upsertVectors, {
        rows: rows.map((row) => ({
          ...row,
          viewKey: `${row.viewKey}:${view}`,
        })),
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
    await t.action(internal.ingest.upsertDescriptors, { rows: [row] });
    await t.action(internal.ingest.upsertDescriptors, {
      rows: [{ ...row, extractedFrom: "contribution:abc" }],
    });

    const stored = await t.run((ctx) =>
      ctx.db
        .query("descriptors")
        .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
        .collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].extractedFrom).toBe("contribution:abc");
    expect(stored[0]).not.toHaveProperty("descriptors");
    expect(stored[0]).not.toHaveProperty("keypoints");
    expect(await t.run(async (ctx) => (await ctx.storage.get(stored[0].storageId))!.size)).toBe(96);

    expect(
      await errorData(
        t.action(internal.ingest.upsertDescriptors, {
          rows: [{ ...row, keypointCount: 3 }],
        }),
      ),
    ).toMatchObject({ code: "bad_descriptors" });
  });
});

describe("ORB file imports", () => {
  it("reuses identical bytes on replay and deletes the previous file when the bytes change", async () => {
    const { t } = await seeded();
    const first = await t.action(internal.ingest.upsertDescriptors, {
      rows: [orbRow],
    });
    const before = (await t.run((ctx) => ctx.db.get("descriptors", first.ids[orbRow.objectKey])))!;
    expect(
      await t.action(internal.ingest.upsertDescriptors, {
        rows: [{ ...orbRow, extractedFrom: "new URL" }],
      }),
    ).toEqual(first);
    expect(await t.run((ctx) => ctx.db.get("descriptors", before._id))).toMatchObject({
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
    expect(await t.action(internal.ingest.upsertDescriptors, { rows: [changed] })).toEqual(first);
    const after = (await t.run((ctx) => ctx.db.get("descriptors", before._id)))!;
    expect(after.storageId).not.toBe(before.storageId);
    expect(await t.run((ctx) => ctx.db.system.get("_storage", before.storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      descriptors: 1,
    });
  });

  it.each([false, true])(
    "cleans up safely when a commit fails (response lost after commit: %s)",
    async (afterCommit) => {
      const { t } = await seeded();
      await expect(
        t.action((ctx) =>
          runDescriptorImport(
            {
              ...ctx,
              runMutation: async (reference, args) => {
                if (getFunctionName(reference) !== "ingest:commitDescriptors") {
                  return ctx.runMutation(reference, args);
                }
                if (afterCommit) await ctx.runMutation(reference, args);
                throw new Error("connection lost");
              },
            },
            { rows: [orbRow] },
          ),
        ),
      ).rejects.toThrow("connection lost");
      const beforeRetry = await t.run((ctx) => ctx.db.system.query("_storage").collect());
      expect(beforeRetry).toHaveLength(afterCommit ? 1 : 0);
      await t.action(internal.ingest.upsertDescriptors, { rows: [orbRow] });
      const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
      expect(files).toHaveLength(1);
      expect(files.map((file) => file._id)).toEqual(expect.arrayContaining(beforeRetry.map((file) => file._id)));
      expect(await t.query(internal.ingest.counts, {})).toMatchObject({
        descriptors: 1,
      });
    },
  );

  it("waits for concurrent file writes before cleaning up a failed batch", async () => {
    const { t } = await seeded();
    await t.mutation(internal.ingest.upsertObjects, {
      rows: [{ ...metObject, key: "met:second" }],
    });
    let writes = 0;
    await expect(
      t.action((ctx) =>
        runDescriptorImport(
          {
            ...ctx,
            storage: {
              ...ctx.storage,
              store: async (blob) => {
                if (++writes === 1) throw new Error("storage unavailable");
                // convex-test's action storage writes can race with its global transaction stack.
                return t.run((transaction) => transaction.storage.store(blob));
              },
            },
          },
          { rows: [orbRow, { ...orbRow, objectKey: "met:second" }] },
        ),
      ),
    ).rejects.toThrow("storage unavailable");
    expect(writes).toBe(2);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("descriptors").collect())).toEqual([]);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      descriptors: 0,
    });
  });

  it("bounds exported file bytes even though the database references are small", async () => {
    const { t, objectId } = await seeded();
    await t.action(internal.ingest.upsertDescriptors, {
      rows: [
        {
          ...orbRow,
          descriptors: new ArrayBuffer(32_000),
          keypoints: new ArrayBuffer(16_000),
          keypointCount: 1000,
        },
      ],
    });
    await t.run(async (ctx) => {
      const { _id: _objectId, _creationTime: _objectTime, ...object } = (await ctx.db.get("objects", objectId))!;
      const {
        _id: _referenceId,
        _creationTime: _referenceTime,
        ...reference
      } = (await ctx.db.query("descriptors").unique())!;
      for (let i = 0; i < 104; i++) {
        const copy = await ctx.db.insert("objects", {
          ...object,
          key: `met:copy:${i}`,
        });
        await ctx.db.insert("descriptors", { ...reference, objectId: copy });
      }
    });
    const first = await t.action(internal.ingest.exportDescriptors, {});
    expect(first.page).toHaveLength(104);
    expect(
      first.page.reduce((sum, row) => sum + row.descriptors.byteLength + row.keypoints.byteLength, 0),
    ).toBeLessThanOrEqual(5_000_000);
    expect(first.isDone).toBe(false);
    const last = await t.action(internal.ingest.exportDescriptors, {
      cursor: first.continueCursor,
    });
    expect(last.page).toHaveLength(1);
    expect(last.isDone).toBe(true);
  });
});

describe("counts", () => {
  it("counts inserts, not updates", async () => {
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
    const t = convexTest(schema, modules);
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
    const first = await t.mutation(internal.ingest.upsertVectors, { rows });
    const second = await t.mutation(internal.ingest.upsertVectors, {
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
    expect((await t.run((ctx) => ctx.db.get("objects", objectId)))?.thumbnailUrl).toBeUndefined();
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
    const first = await t.mutation(internal.ingest.upsertVectors, {
      rows: [row],
    });
    const second = await t.mutation(internal.ingest.upsertVectors, {
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

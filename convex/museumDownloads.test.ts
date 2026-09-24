import { jsonToConvex } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { rankEntries, recognizeEntries } from "../shared/offline/recognition";
import type { MuseumEntry } from "../shared/offline/types";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api, internal } from "./_generated/api";
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const pair = makeSyntheticPair({ count: 120 });
async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      descriptors: pair.ref,
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
      artwork: {
        docent: {
          en: [{ sentence: "Painted as part of a series.", factIds: ["series"] }],
        },
        factSheet: [
          {
            id: "series",
            text: "Part of a series.",
            sourceUrl: "https://museum.example/work",
            sourceLabel: "Museum",
            sourceScore: 1,
          },
        ],
      },
    }),
  );
  return { t, user, venueId, work };
}

it("publishes an authenticated museum download only when all chunks are complete, with locally usable recognition and prose", async () => {
  const { t, user, venueId, work } = await fixture();
  await t.mutation(internal.museumDownloads.build, { venueId });
  const paginationOpts = { cursor: null, numItems: 64 };
  expect((await user.as.query(api.museumDownloads.catalog, { paginationOpts })).page).toEqual([]);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const manifest = await user.as.query(api.museumDownloads.get, { venueId });
  expect(manifest).toMatchObject({
    count: 1,
    modelVersion: model.modelVersion,
  });
  const entries = await t.run(async (ctx) => {
    const row = (await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue", (q) => q.eq("venueId", venueId))
      .unique())!;
    const file = await ctx.storage.get(row.published!.chunks[0].storageId);
    expect(file!.size).toBe(manifest!.size);
    return jsonToConvex(JSON.parse(await file!.text())) as unknown as MuseumEntry[];
  });
  expect(entries[0].candidate.object).toEqual({
    _id: work.objectId,
    identityStatus: "established",
    ownerId: venueId,
    medium: "Oil on canvas",
    calibratorPenalty: 0,
  });
  expect(entries[0].candidate.artwork).toEqual({
    _id: work.artworkId,
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1916",
    rightsStatus: "public_domain",
    docent: [{ sentence: "Painted as part of a series.", factIds: ["series"] }],
    factSheet: [
      {
        id: "series",
        sourceUrl: "https://museum.example/work",
        sourceLabel: "Museum",
      },
    ],
  });
  const ranked = rankEntries(testVector(), entries);
  const result = recognizeEntries(
    {
      modelVersion: model.modelVersion,
      venueId,
      ...encodeOrbFeatures(pair.query),
    },
    ranked,
  );
  expect(result).toMatchObject({
    outcome: "confident",
    best: { objectId: work.objectId, title: "Water Lilies" },
    docent: [{ sentence: "Painted as part of a series." }],
  });
  expect(
    recognizeEntries({ modelVersion: "old-model", venueId, ...encodeOrbFeatures(pair.query) }, ranked),
  ).toBeUndefined();
  expect(
    recognizeEntries(
      {
        modelVersion: model.modelVersion,
        venueId,
        descriptors: new ArrayBuffer(0),
        keypoints: new ArrayBuffer(0),
      },
      ranked,
    ),
  ).toBeUndefined();
  await expect(t.query(api.museumDownloads.catalog, { paginationOpts })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  await t.run((ctx) => ctx.db.patch("devices", user.deviceId, { banned: true }));
  await expect(user.as.query(api.museumDownloads.get, { venueId })).rejects.toMatchObject({
    data: { code: "device_banned" },
  });
});

it("excludes withdrawn works and museums from newly published downloads", async () => {
  const { t, user, venueId, work } = await fixture();
  await t.run((ctx) => ctx.db.patch("objects", work.objectId, { reverted: true }));
  await t.mutation(internal.museumDownloads.build, { venueId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await user.as.query(api.museumDownloads.get, { venueId })).toBeNull();
  await t.run((ctx) => ctx.db.patch("museums", venueId, { optOut: true }));
  await expect(t.mutation(internal.museumDownloads.build, { venueId })).rejects.toThrow("Museum unavailable");
});

it("can restart an interrupted build without publishing stale batches", async () => {
  const { t, user, venueId } = await fixture();
  await t.mutation(internal.museumDownloads.build, { venueId });
  await t.mutation(internal.museumDownloads.build, { venueId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const manifest = await user.as.query(api.museumDownloads.get, { venueId });
  expect(manifest?.count).toBe(1);
  expect(manifest?.chunks).toHaveLength(1);
});

it("rejects incomplete, unverified, and nonmatching references during offline recognition", async () => {
  const { t, venueId } = await fixture();
  await t.mutation(internal.museumDownloads.build, { venueId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const entries = await t.run(async (ctx) => {
    const row = (await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue", (q) => q.eq("venueId", venueId))
      .unique())!;
    return jsonToConvex(
      JSON.parse(await (await ctx.storage.get(row.published!.chunks[0].storageId))!.text()),
    ) as unknown as MuseumEntry[];
  });
  const ranked = rankEntries(testVector(-1), entries);
  expect(
    recognizeEntries(
      {
        modelVersion: model.modelVersion,
        ...encodeOrbFeatures(makeSyntheticPair({ seed: 123456, count: 120 }).query),
      },
      ranked,
    ),
  ).toBeUndefined();
});

it("publishes the rest of a museum when one reference has an unreadable ORB file", async () => {
  const { t, user, venueId, work } = await fixture();
  const damaged = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      descriptors: pair.ref,
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
      artwork: { title: "Haystacks" },
    }),
  );
  await t.run(async (ctx) => {
    const reference = (await ctx.db
      .query("descriptors")
      .withIndex("by_objectId", (q) => q.eq("objectId", damaged.objectId))
      .unique())!;
    await ctx.db.patch("descriptors", reference._id, {
      keypointCount: reference.keypointCount + 1,
    });
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await t.mutation(internal.museumDownloads.build, { venueId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  warn.mockRestore();
  const manifest = await user.as.query(api.museumDownloads.get, { venueId });
  expect(manifest?.count).toBe(1);
  const entries = await t.run(async (ctx) => {
    const row = (await ctx.db
      .query("museumDownloads")
      .withIndex("by_venue", (q) => q.eq("venueId", venueId))
      .unique())!;
    return jsonToConvex(
      JSON.parse(await (await ctx.storage.get(row.published!.chunks[0].storageId))!.text()),
    ) as unknown as MuseumEntry[];
  });
  expect(entries.map((entry) => entry.candidate.object._id)).toEqual([work.objectId]);
});

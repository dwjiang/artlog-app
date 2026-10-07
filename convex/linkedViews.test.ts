import { afterEach, beforeEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { eligibleVector, recognitionPartition } from "./lib/recognitionEligibility";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan, seedVector, testVector } from "./lib/testFactories";
import { readVector } from "./lib/vectorStore";
import { dropLinkedView, LINKED_VIEW_MIN_COSINE, MAX_VISITOR_VIEWS } from "./linkedViews";
import { harness } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const snapshot = { title: "Water Lilies", artist: "Claude Monet" };

async function fixture({
  similarity = 0.8,
  source = "label",
  atVenue = false,
}: { similarity?: number; source?: "label" | "manual"; atVenue?: boolean } = {}) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = atVenue ? await t.run(seedMuseum) : undefined;
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const other = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { title: "Haystacks" } }));
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      venueId,
      vector: testVector(similarity),
      linked: { source, objectId: work.objectId, artworkId: work.artworkId, linkedAt: Date.now() },
    }),
  );
  const save = async (overrides: { snapshot?: typeof snapshot } = {}) => {
    await user.as.mutation(api.collections.saveToCollection, {
      scope: user.scope,
      localId: crypto.randomUUID(),
      savedAt: Date.now(),
      scanId,
      venueId,
      objectId: work.objectId,
      artworkId: work.artworkId,
      snapshot,
      suggested: snapshot,
      ...overrides,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const views = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("vectors").collect()).filter((row) => row.source === "user_scan"),
    ) as Promise<Doc<"vectors">[]>;
  return { t, user, work, other, venueId, scanId, save, views };
}

it("lends the photo of a scan saved under its verified label's catalogue work to that work", async () => {
  const { t, work, scanId, save, views } = await fixture();
  await save();
  const [view] = await views();
  expect(view).toMatchObject({
    objectId: work.objectId,
    scanId,
    modelVersion: model.modelVersion,
    partition: recognitionPartition(model.modelVersion),
  });
  expect(await t.run((ctx) => readVector(ctx, view))).toEqual(testVector(0.8));
  expect(await t.run((ctx) => eligibleVector(ctx, view))).toBe(true);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(1);
  await save();
  expect(await views()).toHaveLength(1);
});

it.each([
  ["a photo that does not look like the work", { similarity: LINKED_VIEW_MIN_COSINE - 0.05 }, {}],
  ["a link from typed details", { source: "manual" as const }, {}],
  ["a save whose title was edited", {}, { snapshot: { ...snapshot, title: "Nymphéas" } }],
])("lends nothing for %s", async (_case, options, overrides) => {
  const { save, views } = await fixture(options);
  await save(overrides);
  expect(await views()).toEqual([]);
});

it("lends nothing when the work already holds the same photo or a full set of visitor views", async () => {
  const { t, work, save, views } = await fixture();
  const addView = (vector: number[]) =>
    t.run((ctx) =>
      seedVector(ctx, {
        objectId: work.objectId,
        modelVersion: model.modelVersion,
        source: "user_scan",
        partition: recognitionPartition(model.modelVersion),
        vector,
      }),
    );
  await addView(testVector(0.8));
  await save();
  expect(await views()).toHaveLength(1);

  const crowded = await fixture({ similarity: 0.7 });
  for (let i = 0; i < MAX_VISITOR_VIEWS; i++) {
    await crowded.t.run((ctx) =>
      seedVector(ctx, {
        objectId: crowded.work.objectId,
        modelVersion: model.modelVersion,
        source: "user_scan",
        partition: recognitionPartition(model.modelVersion),
        vector: testVector(0.3),
      }),
    );
  }
  await crowded.save();
  expect(await crowded.views()).toHaveLength(MAX_VISITOR_VIEWS);
});

it("withdraws the lent photo once the scan names another work, and never serves a stale one", async () => {
  const { t, other, scanId, save, views } = await fixture();
  await save();
  const [view] = await views();
  await t.run((ctx) =>
    ctx.db.patch("scans", scanId, {
      linked: { source: "label", objectId: other.objectId, artworkId: other.artworkId, linkedAt: Date.now() },
    }),
  );
  expect(await t.run((ctx) => eligibleVector(ctx, view))).toBe(false);
  await t.run((ctx) => dropLinkedView(ctx, scanId));
  expect(await views()).toEqual([]);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(0);
});

it("refuses new learning and an in-flight commit after the scan's venue opts out", async () => {
  const { t, work, venueId, scanId, save, views } = await fixture({ atVenue: true });
  expect(await t.query(internal.linkedViews.prepare, { scanId })).not.toBeNull();
  await t.mutation(internal.revert.applyOptOut, { venueId: venueId!, requester: "museum" });
  expect(await t.query(internal.linkedViews.prepare, { scanId })).toBeNull();
  await t.mutation(internal.linkedViews.commit, { scanId, objectId: work.objectId, checked: [] });
  await save();
  expect(await views()).toEqual([]);
});

it("hides opted-out views immediately and removes them across scan pages without removing catalogue views", async () => {
  const { t, user, work, other, venueId, scanId, save, views } = await fixture({ atVenue: true });
  await save();
  const [view] = await views();
  // Put another learned view beyond the first cleanup page.
  for (let i = 0; i < 25; i++) {
    await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId }));
  }
  const laterScan = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      venueId,
      vector: testVector(0.8),
      linked: { source: "label", objectId: other.objectId, artworkId: other.artworkId, linkedAt: Date.now() },
    }),
  );
  await t.action(internal.linkedViews.learn, { scanId: laterScan });
  const elsewhere = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      vector: testVector(0.65),
      linked: { source: "label", objectId: work.objectId, artworkId: work.artworkId, linkedAt: Date.now() },
    }),
  );
  await t.action(internal.linkedViews.learn, { scanId: elsewhere });
  expect(await views()).toHaveLength(3);

  const optOutId = await t.mutation(internal.revert.applyOptOut, { venueId: venueId!, requester: "museum" });
  expect(await t.run((ctx) => eligibleVector(ctx, view))).toBe(false);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await views()).toMatchObject([{ scanId: elsewhere }]);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(1);
  expect(await t.run((ctx) => ctx.db.get("vectors", work.vectorId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("scans", scanId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("optOuts", optOutId))).toMatchObject({ appliedAt: Date.now() });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
} from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const DAY = 24 * 60 * 60 * 1000;
async function fixture() {
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const run = () => t.action(internal.promotion.run, {});
  const get = <
    T extends "contributions" | "objects" | "devices" | "artworks" | "feedback",
  >(
    id: Id<T>,
  ) => t.run((ctx) => ctx.db.get(id)) as Promise<Doc<T> | null>;
  const all = <
    T extends
      | "objects"
      | "artworks"
      | "vectors"
      | "descriptors"
      | "placements"
      | "contributions",
  >(
    table: T,
  ) => t.run((ctx) => ctx.db.query(table).collect()) as Promise<Doc<T>[]>;
  const seed = (overrides: Parameters<typeof seedContribution>[1]) =>
    t.run((ctx) => seedContribution(ctx, overrides));
  return { t, alice, bob, venueId, run, get, all, seed };
}

async function seedFeedback(
  ctx: MutationCtx,
  row: {
    deviceId: Id<"devices">;
    venueId?: Id<"museums">;
    objectId: Id<"objects">;
    rejectedObjectId: Id<"objects">;
    vector?: number[];
    createdAt?: number;
  },
): Promise<Id<"feedback">> {
  const scanId = await seedScan(ctx, {
    deviceId: row.deviceId,
    venueId: row.venueId,
  });
  return ctx.db.insert("feedback", {
    scanId,
    deviceId: row.deviceId,
    vector: row.vector ?? testVector(0.9),
    modelVersion: model.modelVersion,
    venueId: row.venueId,
    rejectedObjectId: row.rejectedObjectId,
    score: 0.8,
    margin: 0.1,
    orbInliers: 20,
    probability: 0.9,
    calibratorVersion: "lr-v1",
    venueMismatch: false,
    penaltyAdded: 0,
    resolution: { kind: "runner_up", objectId: row.objectId },
    createdAt: row.createdAt ?? Date.now(),
  });
}

describe("multi-view vectors from resolved rejections", () => {
  async function multiViewFixture() {
    const base = await fixture();
    const { t, venueId } = base;
    const { work, wrong } = await t.run(async (ctx) => ({
      work: await seedArtworkWithObject(ctx, {
        placement: { venueId, onView: true, source: "feed", confidence: 1 },
      }),
      wrong: await seedArtworkWithObject(ctx, {
        artwork: { title: "Haystacks" },
      }),
    }));
    const feedback = (
      row: Omit<
        Parameters<typeof seedFeedback>[1],
        "objectId" | "rejectedObjectId"
      > & {
        objectId?: Id<"objects">;
      },
    ) =>
      t.run((ctx) =>
        seedFeedback(ctx, {
          objectId: work.objectId,
          rejectedObjectId: wrong.objectId,
          ...row,
        }),
      );
    const userScanVectors = async () =>
      (await base.all("vectors")).filter((row) => row.source === "user_scan");
    return { ...base, work, feedback, userScanVectors };
  }

  it("adds one user_scan vector per resolution once two devices resolved to the work at the venue", async () => {
    const {
      t,
      alice,
      bob,
      venueId,
      run,
      get,
      feedback,
      userScanVectors,
      work,
    } = await multiViewFixture();
    const first = await feedback({
      deviceId: alice.deviceId,
      venueId,
      vector: testVector(0.9),
    });
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect((await get(first))?.multiViewAt).toBeUndefined();
    const second = await feedback({
      deviceId: bob.deviceId,
      venueId,
      vector: testVector(0.8),
    });
    expect(await run()).toMatchObject({ multiViewVectors: 2 });
    const vectors = await userScanVectors();
    expect(vectors).toMatchObject([
      {
        objectId: work.objectId,
        modelVersion: model.modelVersion,
        vector: testVector(0.9),
      },
      {
        objectId: work.objectId,
        modelVersion: model.modelVersion,
        vector: testVector(0.8),
      },
    ]);
    expect(await get(first)).toMatchObject({
      multiViewAt: expect.any(Number),
      multiViewVectorId: vectors[0]._id,
    });
    expect(await get(second)).toMatchObject({
      multiViewAt: expect.any(Number),
      multiViewVectorId: vectors[1]._id,
    });
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toHaveLength(2);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  });

  it("adds nothing for a single device and keeps its resolution waiting for a partner", async () => {
    const { alice, venueId, run, get, feedback, userScanVectors } =
      await multiViewFixture();
    const rows = [
      await feedback({
        deviceId: alice.deviceId,
        venueId,
        vector: testVector(0.9),
      }),
      await feedback({
        deviceId: alice.deviceId,
        venueId,
        vector: testVector(0.8),
      }),
    ];
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) expect((await get(id))?.multiViewAt).toBeUndefined();
  });

  it("suppresses near-duplicate views and settles rows that can never qualify", async () => {
    const { t, alice, bob, venueId, run, get, feedback, userScanVectors } =
      await multiViewFixture();
    const elsewhere = await t.run((ctx) => seedMuseum(ctx));
    const first = await feedback({
      deviceId: alice.deviceId,
      venueId,
      vector: testVector(0.9),
    });
    const duplicate = await feedback({
      deviceId: bob.deviceId,
      venueId,
      vector: testVector(0.9),
    });
    const lonely = await feedback({
      deviceId: alice.deviceId,
      venueId: elsewhere,
    });
    const expired = await feedback({
      deviceId: bob.deviceId,
      venueId,
      createdAt: Date.now() - 100 * DAY,
    });
    const noVenue = await feedback({ deviceId: bob.deviceId });
    expect(await run()).toMatchObject({ multiViewVectors: 1 });
    expect(await userScanVectors()).toHaveLength(1);
    expect(await get(first)).toMatchObject({
      multiViewAt: expect.any(Number),
      multiViewVectorId: expect.any(String),
    });
    expect(await get(duplicate)).toMatchObject({
      multiViewAt: expect.any(Number),
    });
    expect((await get(duplicate))?.multiViewVectorId).toBeUndefined();
    expect((await get(lonely))?.multiViewAt).toBeUndefined();
    expect((await get(expired))?.multiViewAt).toEqual(expect.any(Number));
    expect((await get(noVenue))?.multiViewAt).toEqual(expect.any(Number));
  });

  it("settles resolutions to a reverted work without adding vectors", async () => {
    const {
      t,
      alice,
      bob,
      venueId,
      run,
      get,
      feedback,
      userScanVectors,
      work,
    } = await multiViewFixture();
    await t.run((ctx) => ctx.db.patch(work.objectId, { reverted: true }));
    const rows = [
      await feedback({ deviceId: alice.deviceId, venueId }),
      await feedback({
        deviceId: bob.deviceId,
        venueId,
        vector: testVector(0.8),
      }),
    ];
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) {
      expect((await get(id))?.multiViewAt).toEqual(expect.any(Number));
    }
  });
});

describe("multi-view regression guards", () => {
  it("advances past a full page of waiting feedback and revisits it when a partner arrives", async () => {
    const { t, alice, bob, venueId, run, all } = await fixture();
    const [waiting, ready, wrong] = await t.run(async (ctx) =>
      Promise.all([
        seedArtworkWithObject(ctx),
        seedArtworkWithObject(ctx),
        seedArtworkWithObject(ctx),
      ]),
    );
    const add = (
      objectId: Id<"objects">,
      deviceId: Id<"devices">,
      vector = testVector(0.9),
    ) =>
      t.run((ctx) =>
        seedFeedback(ctx, {
          objectId,
          deviceId,
          venueId,
          rejectedObjectId: wrong.objectId,
          vector,
        }),
      );
    for (let i = 0; i < 100; i++) await add(waiting.objectId, alice.deviceId);
    await add(ready.objectId, alice.deviceId);
    await add(ready.objectId, bob.deviceId, testVector(0.8));
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await run()).toMatchObject({ multiViewVectors: 2 });
    await add(waiting.objectId, bob.deviceId, testVector(0.8));
    await run();
    await run();
    expect(
      (await all("vectors")).filter(
        (row) =>
          row.objectId === waiting.objectId && row.source === "user_scan",
      ),
    ).toHaveLength(2);
  });

  it("handles a popular work with 1500 prior resolutions within transaction limits", async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const first = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: alice.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
      }),
    );
    for (let batch = 0; batch < 15; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 100; i++) {
          const id = await seedFeedback(ctx, {
            deviceId: bob.deviceId,
            venueId,
            objectId: work.objectId,
            rejectedObjectId: wrong.objectId,
          });
          await ctx.db.patch(id, { multiViewAt: Date.now() });
        }
      });
    }
    expect(await t.action(internal.promotion.run, {})).toMatchObject({
      multiViewVectors: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(first))).toMatchObject({
      multiViewVectorId: expect.any(String),
    });
  });
});

describe("multi-view paginated validation", () => {
  it("finds a duplicate beyond the first vector page and adds a distinct later view", async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const axis = (i: number) =>
      Array.from({ length: model.embeddingDim }, (_, j) => Number(j === i));
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = batch * 50; i < (batch + 1) * 50; i++) {
          await ctx.db.insert("vectors", {
            partition: JSON.stringify([model.modelVersion, "established"]),
            objectId: work.objectId,
            source: "user_scan",
            modelVersion: model.modelVersion,
            vector: axis(i),
          });
        }
      });
    }
    const duplicate = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: alice.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
        vector: axis(149),
      }),
    );
    const unique = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: bob.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
        vector: axis(150),
      }),
    );
    expect(await t.action(internal.promotion.run, {})).toMatchObject({
      multiViewVectors: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(duplicate))).toMatchObject({
      multiViewAt: expect.any(Number),
    });
    expect(
      (await t.run((ctx) => ctx.db.get(duplicate)))?.multiViewVectorId,
    ).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(unique))).toMatchObject({
      multiViewVectorId: expect.any(String),
    });
  });

  it("rechecks witnesses if a device is banned after agreement was loaded", async () => {
    const { t, alice, bob, venueId, all } = await fixture();
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const first = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: alice.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
      }),
    );
    const second = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: bob.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
        vector: testVector(0.8),
      }),
    );
    await t.run((ctx) => ctx.db.patch(bob.deviceId, { banned: true }));
    expect(
      await t.mutation(internal.promotion.applyMultiView, {
        feedbackId: first,
        agreementIds: [first, second],
        cursor: null,
      }),
    ).toEqual({ inserted: false, cursor: null });
    expect(
      (await all("vectors")).filter((row) => row.source === "user_scan"),
    ).toEqual([]);
    expect(
      (await t.run((ctx) => ctx.db.get(first)))?.multiViewAt,
    ).toBeUndefined();
  });
});

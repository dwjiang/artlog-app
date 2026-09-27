import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { fileStorage } from "./lib/fileStorage";
import { r2 } from "./lib/r2";
import {
  seedEmbedding,
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
  seedVector,
} from "./lib/testFactories";
import { readVector } from "./lib/vectorStore";
import { harness, promoteGroup } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

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
  const get = (id: Id<"feedback">) => t.run((ctx) => ctx.db.get("feedback", id));
  const all = <T extends "objects" | "artworks" | "vectors" | "placements" | "contributions">(table: T) =>
    t.run((ctx) => ctx.db.query(table).collect()) as Promise<Doc<T>[]>;
  const seed = (overrides: Parameters<typeof seedContribution>[1]) => t.run((ctx) => seedContribution(ctx, overrides));
  return { t, alice, bob, venueId, get, all, seed };
}

async function seedFeedback(
  ctx: MutationCtx,
  row: {
    deviceId: Id<"devices">;
    venueId?: Id<"museums">;
    objectId: Id<"objects">;
    rejectedObjectId: Id<"objects">;
    vector?: number[];
    embeddingId?: Id<"scanEmbeddings">;
  },
): Promise<Id<"feedback">> {
  const scanId = await seedScan(ctx, {
    deviceId: row.deviceId,
    venueId: row.venueId,
    embeddingId: row.embeddingId,
    vector: row.vector ?? testVector(0.9),
  });
  return ctx.db.insert("feedback", {
    scanId,
    deviceId: row.deviceId,
    embeddingId: (await ctx.db.get("scans", scanId))!.embeddingId!,
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
      row: Omit<Parameters<typeof seedFeedback>[1], "objectId" | "rejectedObjectId"> & {
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
    const userScanVectors = async () => (await base.all("vectors")).filter((row) => row.source === "user_scan");
    const promote = (venue = venueId) => promoteGroup(t, work.objectId, venue);
    return { ...base, work, feedback, userScanVectors, promote };
  }

  it("retries promotion after an archive read failure without committing a vector", async () => {
    const { t, alice, bob, venueId, feedback, get, userScanVectors, promote } = await multiViewFixture();
    const first = await feedback({ deviceId: alice.deviceId, venueId });
    await feedback({ deviceId: bob.deviceId, venueId });
    await vi.mocked(r2.get).withImplementation(
      async () => {
        throw new Error("R2 unavailable");
      },
      async () => {
        await promote();
      },
    );
    expect(await userScanVectors()).toEqual([]);
    expect((await get(first))?.multiViewAt).toBeUndefined();
    vi.advanceTimersByTime(31 * 60_000);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    const vectors = await userScanVectors();
    expect(vectors).toHaveLength(1);
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, vectors[0].archiveId))).not.toBeNull();
    expect((await get(first))?.multiViewAt).toBeDefined();
    expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").collect())).toEqual(
      expect.arrayContaining([expect.objectContaining({ vectorId: vectors[0]._id })]),
    );
    for (const job of await t.run((ctx) => ctx.db.query("vectorSyncJobs").collect())) {
      expect(job).not.toHaveProperty("pendingVector");
    }
  });

  it("rechecks a page if a matching view arrives while archive reads are in flight", async () => {
    const { t, alice, bob, venueId, work, feedback, get, userScanVectors } = await multiViewFixture();
    const first = await feedback({ deviceId: alice.deviceId, venueId, vector: testVector(0.9) });
    const second = await feedback({ deviceId: bob.deviceId, venueId, vector: testVector(0.9) });
    const duplicateId = await t.run((ctx) =>
      seedVector(ctx, {
        objectId: work.objectId,
        modelVersion: model.modelVersion,
        source: "user_scan",
        vector: testVector(0.9),
        partition: JSON.stringify([model.modelVersion, "established"]),
      }),
    );
    const retryId = await t.run((ctx) =>
      ctx.scheduler.runAfter(31 * 60_000, internal.promotion.promoteNextView, {
        objectId: work.objectId,
        venueId,
        feedbackId: first,
        agreementIds: [first, second],
        cursor: null,
      }),
    );
    await t.mutation(internal.promotion.commitNextView, {
      objectId: work.objectId,
      venueId,
      feedbackId: first,
      agreementIds: [first, second],
      cursor: null,
      checked: [],
      archiveId: null,
      retryId,
    });
    expect((await get(first))?.multiViewAt).toBeUndefined();
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect((await get(first))?.multiViewDuplicateVectorId).toBe(duplicateId);
    expect(await userScanVectors()).toHaveLength(1);
  });

  it("adds one user_scan vector per resolution once two devices resolved to the work at the venue", async () => {
    const { t, alice, bob, venueId, get, feedback, userScanVectors, work, promote } = await multiViewFixture();
    const first = await feedback({
      deviceId: alice.deviceId,
      venueId,
      vector: testVector(0.9),
    });
    await promote();
    expect(await userScanVectors()).toEqual([]);
    expect((await get(first))?.multiViewAt).toBeUndefined();
    const second = await feedback({
      deviceId: bob.deviceId,
      venueId,
      vector: testVector(0.8),
    });
    await promote();
    const vectors = await userScanVectors();
    expect(
      await Promise.all(vectors.map(async (row) => ({ ...row, vector: await t.run((ctx) => readVector(ctx, row)) }))),
    ).toMatchObject([
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
    await promote();
    expect(await userScanVectors()).toHaveLength(2);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  });

  it("adds nothing for a single device and keeps its resolution waiting for a partner", async () => {
    const { alice, venueId, get, feedback, userScanVectors, promote } = await multiViewFixture();
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
    await promote();
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) expect((await get(id))?.multiViewAt).toBeUndefined();
  });

  it("suppresses near-duplicate views and settles expired ones", async () => {
    const { t, alice, bob, venueId, get, feedback, userScanVectors, promote } = await multiViewFixture();
    const elsewhere = await t.run((ctx) => seedMuseum(ctx));
    const expired = await feedback({
      deviceId: bob.deviceId,
      venueId,
    });
    vi.setSystemTime(Date.now() + 100 * DAY);
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
    await promote();
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
  });

  it("settles resolutions to a reverted work without adding vectors", async () => {
    const { t, alice, bob, venueId, get, feedback, userScanVectors, work, promote } = await multiViewFixture();
    await t.run((ctx) => ctx.db.patch("objects", work.objectId, { reverted: true }));
    const rows = [
      await feedback({ deviceId: alice.deviceId, venueId }),
      await feedback({
        deviceId: bob.deviceId,
        venueId,
        vector: testVector(0.8),
      }),
    ];
    await promote();
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) {
      expect((await get(id))?.multiViewAt).toEqual(expect.any(Number));
    }
  });
});

describe("multi-view regression guards", () => {
  it("promotes every waiting view in the group once a partner arrives", async () => {
    const { t, alice, bob, venueId, all } = await fixture();
    const [work, elsewhere, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const add = (objectId: Id<"objects">, deviceId: Id<"devices">, vector: number[]) =>
      t.run((ctx) =>
        seedFeedback(ctx, {
          objectId,
          deviceId,
          venueId,
          rejectedObjectId: wrong.objectId,
          vector,
        }),
      );
    for (const similarity of [0.9, 0.7, 0.5]) {
      await add(work.objectId, alice.deviceId, testVector(similarity));
    }
    await add(elsewhere.objectId, alice.deviceId, testVector(0.9));
    await add(work.objectId, bob.deviceId, testVector(0.3));
    await promoteGroup(t, work.objectId, venueId);
    const views = (await all("vectors")).filter((row) => row.source === "user_scan");
    expect(views.map((row) => row.objectId)).toEqual(Array(4).fill(work.objectId));
  });

  it("finds agreement past 1500 resolutions from one device within transaction limits", async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const embeddingId = await t.run((ctx) => seedEmbedding(ctx, { vector: testVector(0.9) }));
    for (let batch = 0; batch < 15; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 100; i++) {
          const id = await seedFeedback(ctx, {
            deviceId: alice.deviceId,
            embeddingId,
            venueId,
            objectId: work.objectId,
            rejectedObjectId: wrong.objectId,
          });
          await ctx.db.patch("feedback", id, { multiViewAt: Date.now() });
        }
      });
    }
    const latest = await t.run((ctx) =>
      seedFeedback(ctx, {
        deviceId: bob.deviceId,
        venueId,
        objectId: work.objectId,
        rejectedObjectId: wrong.objectId,
      }),
    );
    await promoteGroup(t, work.objectId, venueId);
    expect(await t.run((ctx) => ctx.db.get("feedback", latest))).toMatchObject({
      multiViewVectorId: expect.any(String),
    });
  });

  it("requeues a view whose witnesses were reloaded without its partners", async () => {
    const { t, alice, bob, venueId, all } = await fixture();
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const add = (deviceId: Id<"devices">, vector: number[]) =>
      t.run((ctx) =>
        seedFeedback(ctx, {
          deviceId,
          venueId,
          objectId: work.objectId,
          rejectedObjectId: wrong.objectId,
          vector,
        }),
      );
    await add(alice.deviceId, testVector(0.9));
    const second = await add(bob.deviceId, testVector(0.8));
    await promoteGroup(t, work.objectId, venueId);
    await t.mutation(internal.promotion.replaceWitnesses, { feedbackId: second, agreementIds: [] });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await t.run((ctx) => ctx.db.get("feedback", second))).toMatchObject({
      multiViewVectorId: expect.any(String),
    });
    expect((await all("vectors")).filter((row) => row.source === "user_scan")).toHaveLength(2);
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
    const axis = (i: number) => Array.from({ length: model.embeddingDim }, (_, j) => Number(j === i));
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = batch * 50; i < (batch + 1) * 50; i++) {
          await seedVector(ctx, {
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
    await promoteGroup(t, work.objectId, venueId);
    expect(await t.run((ctx) => ctx.db.get("feedback", duplicate))).toMatchObject({
      multiViewAt: expect.any(Number),
    });
    expect((await t.run((ctx) => ctx.db.get("feedback", duplicate)))?.multiViewVectorId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("feedback", unique))).toMatchObject({
      multiViewVectorId: expect.any(String),
    });
  });

  it("reloads witnesses when one is banned after agreement was found", async () => {
    const { t, alice, bob, venueId, all } = await fixture();
    const carol = await seedDevice(t);
    const [work, wrong] = await t.run(async (ctx) =>
      Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]),
    );
    const add = (deviceId: Id<"devices">, vector: number[]) =>
      t.run((ctx) =>
        seedFeedback(ctx, {
          deviceId,
          venueId,
          objectId: work.objectId,
          rejectedObjectId: wrong.objectId,
          vector,
        }),
      );
    const views = async () => (await all("vectors")).filter((row) => row.source === "user_scan");
    const first = await add(alice.deviceId, testVector(0.9));
    const second = await add(bob.deviceId, testVector(0.8));
    await t.run((ctx) => ctx.db.patch("devices", bob.deviceId, { banned: true }));
    await t.mutation(internal.promotion.promoteNextView, {
      objectId: work.objectId,
      venueId,
      agreementIds: [first, second],
      cursor: null,
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await views()).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get("feedback", first)))?.multiViewAt).toBeUndefined();
    await add(carol.deviceId, testVector(0.7));
    await promoteGroup(t, work.objectId, venueId);
    expect(await Promise.all((await views()).map((row) => t.run((ctx) => readVector(ctx, row))))).toEqual([
      testVector(0.9),
      testVector(0.7),
    ]);
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { feedbackChanged } from "./feedbackReplay";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";
import model from "../shared/model/model-version.json";

afterEach(() => vi.useRealTimers());

it("replays surviving events chronologically across pages, resets feedback flags, and retains calibration penalties", async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t),
    bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scans = await t.run(async (ctx) => ({
    alice: await seedScan(ctx, { deviceId: alice.deviceId, venueId }),
    bob: await seedScan(ctx, { deviceId: bob.deviceId, venueId }),
  }));
  let at = Date.now();
  const reject = async (who: "alice" | "bob") =>
    t.run(async (ctx) => {
      const deviceId = who === "alice" ? alice.deviceId : bob.deviceId;
      const feedbackId = await ctx.db.insert("feedback", {
        scanId: scans[who],
        deviceId,
        rejectedObjectId: work.objectId,
        embeddingId: await ctx.db.insert("scanEmbeddings", { vector: testVector() }),
        modelVersion: model.modelVersion,
        venueId,
        score: 1,
        margin: 1,
        orbInliers: 100,
        probability: 0.99,
        calibratorVersion: "lr-v1",
        venueMismatch: false,
        penaltyAdded: 0,
        resolution: { kind: "unresolved" },
        createdAt: at,
      });
      await ctx.db.insert("feedbackEvents", {
        kind: "rejection",
        scanId: scans[who],
        deviceId,
        objectId: work.objectId,
        feedbackId,
        createdAt: at++,
      });
    });
  for (let i = 0; i < 19; i++) await reject("bob");
  await reject("alice");
  for (let batch = 0; batch < 3; batch++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++) {
        const saveId = await ctx.db.insert("collections", {
          owner: { kind: "device", deviceId: bob.deviceId },
          localId: crypto.randomUUID(),
          snapshot: { title: "Water Lilies", artist: "Claude Monet" },
          savedAt: at,
          updatedAt: at,
          updatedBy: bob.deviceId,
          changeVersion: at,
        });
        await ctx.db.insert("feedbackEvents", {
          kind: "confirmation",
          deviceId: bob.deviceId,
          scanId: scans.bob,
          objectId: work.objectId,
          saveId,
          createdAt: at++,
        });
      }
    });
  }
  await reject("bob");
  await t.run(async (ctx) => {
    await ctx.db.patch(work.objectId, {
      confirmCount: 120,
      rejectCount: 21,
      flaggedForReview: true,
      rejectionPenalty: 0.2,
      calibratorPenalty: 0.35,
    });
  });
  const removalId = await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(work.objectId))).toMatchObject({
    confirmCount: 120,
    rejectCount: 20,
    flaggedForReview: false,
    rejectionPenalty: 0,
    calibratorPenalty: 0.35,
  });
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "complete", settled: 2 });
  expect(
    await t.mutation(internal.revert.revertDevice, {
      deviceId: alice.deviceId,
      reason: "abuse",
    }),
  ).toBe(removalId);
});

it("restarts a partial replay when new feedback arrives", async () => {
  vi.useFakeTimers();
  const t = harness();
  const device = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: device.deviceId }));
  const add = (count: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("feedbackEvents", {
          kind: "confirmation",
          deviceId: device.deviceId,
          scanId,
          objectId: work.objectId,
          createdAt: Date.now(),
        });
      }
      await feedbackChanged(ctx, work.objectId);
    });
  await add(75);
  const job = (await t.run((ctx) => ctx.db.query("feedbackRebuilds").unique()))!;
  await t.mutation(internal.feedbackReplay.rebuildPage, { jobId: job._id });
  await add(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(work.objectId))).toMatchObject({
    confirmCount: 76,
  });
});

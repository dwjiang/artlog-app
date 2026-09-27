import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { EVIDENCE_RETENTION_MS, COMPLETED_REMOVAL_RETENTION_MS, CHALLENGE_RETENTION_MS } from "./lib/retentionPolicy";
import { seedArtworkWithObject, seedDevice, seedScan } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

it("expires challenges and trims old scan evidence while preserving the result and recent scans", async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const oldScan = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, runnerUps: [], candidateSignals: [] }));
  await user.as.mutation(api.devices.createChallenge, { purpose: "assert" });
  vi.setSystemTime(Date.now() + CHALLENGE_RETENTION_MS + 1);
  await t.action(internal.retention.expire, {});
  expect(await t.run((ctx) => ctx.db.query("attestChallenges").collect())).toEqual([]);
  vi.setSystemTime(Date.now() + EVIDENCE_RETENTION_MS);
  const recent = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, runnerUps: [], candidateSignals: [] }));
  await t.action(internal.retention.expire, {});
  expect(await t.run((ctx) => ctx.db.get("scans", oldScan))).toMatchObject({ status: "identified", outcome: "miss" });
  expect(await t.run((ctx) => ctx.db.get("scans", oldScan))).not.toHaveProperty("candidateSignals");
  expect(await t.run((ctx) => ctx.db.get("scans", oldScan))).not.toHaveProperty("expiresAt");
  expect(await t.run((ctx) => ctx.db.get("scans", recent))).toHaveProperty("candidateSignals");
});

it("expires feedback, its vector and evidence, and rebuilds reputation from surviving events", async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const seeded = await t.run(async (ctx) => {
    const work = await seedArtworkWithObject(ctx, { object: { rejectCount: 1, rejectionPenalty: 0.2 } });
    const scanId = await seedScan(ctx, { deviceId: user.deviceId });
    const scan = (await ctx.db.get("scans", scanId))!;
    const feedbackId = await ctx.db.insert("feedback", {
      deviceId: user.deviceId,
      scanId,
      rejectedObjectId: work.objectId,
      embeddingId: scan.embeddingId!,
      modelVersion: scan.modelVersion,
      score: 1,
      margin: 1,
      orbInliers: 0,
      probability: 1,
      calibratorVersion: "test",
      venueMismatch: false,
      penaltyAdded: 0.2,
      resolution: { kind: "runner_up", objectId: work.objectId },
      multiViewVectorId: work.vectorId,
      multiViewAgreement: { firstDeviceId: user.deviceId, secondDeviceId: user.deviceId },
      createdAt: Date.now(),
    });
    await ctx.db.insert("feedbackEvents", {
      kind: "rejection",
      deviceId: user.deviceId,
      scanId,
      objectId: work.objectId,
      feedbackId,
      createdAt: Date.now(),
    });
    return { ...work, feedbackId, embeddingId: scan.embeddingId! };
  });
  vi.setSystemTime(Date.now() + EVIDENCE_RETENTION_MS + 1);
  await t.action(internal.retention.expire, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get("feedback", seeded.feedbackId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("vectors", seeded.vectorId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("scanEmbeddings", seeded.embeddingId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("feedbackEvents").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get("objects", seeded.objectId))).toMatchObject({
    rejectCount: 0,
    rejectionPenalty: 0,
  });
});

it("deletes only completed removal jobs with no outstanding dependencies and drains more than one batch", async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const rows = await t.run(async (ctx) => {
    const fields = {
      deviceId: user.deviceId,
      reason: "test",
      cursor: null,
      processed: 0,
      settled: 0,
      settleAttempts: 0,
      resumeRevision: 0,
      startedAt: Date.now(),
    };
    for (let i = 0; i < 55; i++) {
      await ctx.db.insert("deviceRemovals", { ...fields, phase: "complete", completedAt: Date.now() });
    }
    const pending = await ctx.db.insert("deviceRemovals", { ...fields, phase: "complete", completedAt: Date.now() });
    await ctx.db.insert("removalDependencies", { jobId: pending });
    const stalled = await ctx.db.insert("deviceRemovals", { ...fields, phase: "stalled" });
    return { pending, stalled };
  });
  vi.setSystemTime(Date.now() + COMPLETED_REMOVAL_RETENTION_MS + 1);
  await t.action(internal.retention.expire, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const remaining = await t.run((ctx) => ctx.db.query("deviceRemovals").collect());
  expect(remaining.map((row) => row._id).sort()).toEqual([rows.pending, rows.stalled].sort());
});

import { afterEach, expect, it, vi } from "vitest";

import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api } from "./_generated/api";
import { socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedContribution, seedDevice, seedScan } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("rejects anonymous recognition, contribution, feedback, and reporting requests before accessing owner data", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const { visit } = await socialVisit(t, owner, 1);
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: owner.deviceId, venueId: visit.venueId }));
  const { artworkId, objectId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const contributionId = await t.run((ctx) =>
    seedContribution(ctx, { deviceId: owner.deviceId, venueId: visit.venueId, scanId }),
  );
  const checks = [
    () => t.query(api.scans.get, { scanId }),
    () => t.query(api.scans.corpusMatches, { scanId, fields: { title: "Private title" } }),
    () => t.mutation(api.scans.confirm, { scanId, source: "manual", fields: { title: "Changed" } }),
    () => t.mutation(api.scans.link, { scanId, objectId, source: "manual", fields: { title: "Changed" } }),
    () => t.mutation(api.docent.retry, { scanId }),
    () => t.action(api.label.readLabel, { scanId, lines: [{ text: "Private title", confidence: 1 }] }),
    () => t.action(api.label.verifyLabel, { scanId, fields: { title: "Private title" } }),
    () => t.action(api.label.fetchQr, { scanId, url: "https://museum.example/work" }),
    () => t.mutation(api.contributions.requestCropUpload, { size: 3 }),
    () => t.mutation(api.contributions.withdraw, { contributionId }),
    () => t.mutation(api.feedback.rejectMatch, { scanId, objectId, nonce: "unused", assertionBase64: "AAAA" }),
    () => t.mutation(api.corrections.correctFact, { artworkId, factId: "fact", message: "Correction" }),
    () => t.mutation(api.reports.submit, { target: { kind: "scanDocent", scanId }, reason: "wrongFacts" }),
    () => t.mutation(api.appFeedback.submit, { message: "Feedback", appVersion: "1", osVersion: "1" }),
    () =>
      t.mutation(api.push.register, {
        token: "ExpoPushToken[test]",
        friends: true,
        reactions: true,
        companions: true,
        mentions: true,
      }),
  ];
  for (const check of checks) await expect(check()).rejects.toMatchObject({ data: { code: "unauthenticated" } });
});

it("keeps another device's scans private across reads, label actions, writes, and contribution withdrawal", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await seedDevice(t);
  const { visit } = await socialVisit(t, owner, 1);
  const { objectId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: owner.deviceId,
      venueId: visit.venueId,
      confirmed: { source: "manual", fields: { title: "Private title" }, confirmedAt: 1, generation: 0 },
    }),
  );
  const contributionId = await t.run((ctx) =>
    seedContribution(ctx, { deviceId: owner.deviceId, venueId: visit.venueId, scanId }),
  );
  const before = await t.run((ctx) => ctx.db.get("scans", scanId));
  expect(await other.as.query(api.scans.get, { scanId })).toBeNull();
  expect(await other.as.query(api.scans.corpusMatches, { scanId, fields: { title: "Private title" } })).toEqual([]);
  for (const check of [
    () => other.as.mutation(api.scans.confirm, { scanId, source: "manual", fields: { title: "Changed" } }),
    () => other.as.mutation(api.scans.link, { scanId, objectId, source: "manual", fields: { title: "Changed" } }),
    () => other.as.mutation(api.docent.retry, { scanId }),
  ]) {
    await expect(check()).rejects.toMatchObject({ data: { code: "invalid_scan" } });
  }
  for (const check of [
    () => other.as.action(api.label.readLabel, { scanId, lines: [{ text: "Changed", confidence: 1 }] }),
    () => other.as.action(api.label.verifyLabel, { scanId, fields: { title: "Changed" } }),
    () => other.as.action(api.label.fetchQr, { scanId, url: "https://museum.example/work" }),
  ]) {
    await expect(check()).rejects.toMatchObject({ data: { code: "scan_not_found" } });
  }
  await expect(other.as.mutation(api.contributions.withdraw, { contributionId })).rejects.toMatchObject({
    data: { code: "contribution_not_found" },
  });
  expect(await t.run((ctx) => ctx.db.get("scans", scanId))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.get("contributions", contributionId))).toMatchObject({ status: "tentative" });
});

it("cannot attach recognition work to a foreign visit or recover a deleted save with a stale scope", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await seedDevice(t);
  const { visit, saves } = await socialVisit(t, owner, 1);
  const input = {
    scope: other.scope,
    localId: crypto.randomUUID(),
    vector: [],
    descriptors: new ArrayBuffer(0),
    keypoints: new ArrayBuffer(0),
    modelVersion: "retired-model",
    capturedAt: 1,
    visitId: visit._id,
  };
  await expect(other.as.action(api.identify.identify, input)).rejects.toMatchObject({ data: { code: "not_found" } });
  await expect(other.as.action(api.identify.identify, { ...input, scope: owner.scope })).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  const saved = { scope: owner.scope, localId: saves[0].localId };
  const features = encodeOrbFeatures(makeSyntheticPair({ count: 120 }).query);
  await expect(other.as.action(api.savedRecognition.identify, saved)).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  await owner.as.mutation(api.collections.remove, saved);
  await expect(
    owner.as.action(api.savedRecognition.upload, {
      ...saved,
      ...features,
      sourceLocalId: "photo",
      vector: [],
      modelVersion: "retired-model",
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  await expect(owner.as.action(api.savedRecognition.identify, saved)).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  expect(await t.run((ctx) => ctx.db.query("scans").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("savedRecognition").collect())).toEqual([]);
});

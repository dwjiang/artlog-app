import { afterEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { labelField } from "./lib/labelVerify";
import { effectiveObjectPenalty } from "./lib/rejectionPenalty";
import {
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
} from "./lib/testFactories";
import type { LabelFields } from "./lib/validators";
import { harness, signIn } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const { venueId, elsewhere, best, runnerUp, other } = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const elsewhere = await seedMuseum(ctx);
    const best = await seedArtworkWithObject(ctx, {
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
    });
    const runnerUp = await seedArtworkWithObject(ctx, {
      artwork: { title: "Haystacks", artist: "Claude Monet" },
      placement: { venueId: elsewhere, onView: true, source: "feed", confidence: 1 },
    });
    const other = await seedArtworkWithObject(ctx, {
      artwork: { title: "The Starry Night", artist: "Vincent van Gogh" },
    });
    return { venueId, elsewhere, best, runnerUp, other };
  });
  const signals = (objectId: Id<"objects">, similarity: number, probability: number) => ({
    identityStatus: "established" as const,
    objectId,
    similarity,
    margin: 0.1,
    orbInliers: 20,
    probability,
    homographyValid: true,
  });
  const seedRejectableScan = (overrides: Partial<Doc<"scans">> = {}) =>
    t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId,
        outcome: "confident",
        best: {
          identityStatus: "established" as const,
          objectId: best.objectId,
          artworkId: best.artworkId,
          probability: 0.9,
        },
        runnerUps: [
          {
            identityStatus: "established" as const,
            objectId: runnerUp.objectId,
            artworkId: runnerUp.artworkId,
            probability: 0.4,
          },
        ],
        candidateSignals: [signals(best.objectId, 0.8, 0.9), signals(runnerUp.objectId, 0.7, 0.4)],
        ...overrides,
      }),
    );
  const scanId = await seedRejectableScan();
  const sign = async (as = user.as) => ({
    nonce: (await as.mutation(api.devices.createChallenge, { purpose: "assert" })).nonce,
    assertionBase64: "AAAA",
  });
  const reject = async (objectId: Id<"objects">, scan = scanId, as = user.as) =>
    as.mutation(api.feedback.rejectMatch, { scanId: scan, objectId, ...(await sign(as)) });
  const object = (id: Id<"objects">) => t.run((ctx) => ctx.db.get(id));
  const feedback = (id: Id<"feedback">) => t.run((ctx) => ctx.db.get(id));
  const feedbackRows = () => t.run((ctx) => ctx.db.query("feedback").collect());
  const proposals = () => t.run((ctx) => ctx.db.query("placementProposals").collect());
  return {
    t,
    user,
    venueId,
    elsewhere,
    best,
    runnerUp,
    other,
    scanId,
    seedRejectableScan,
    sign,
    reject,
    object,
    feedback,
    feedbackRows,
    proposals,
  };
}

describe("rejectMatch", () => {
  it("records the rejected candidate’s signals, its venue relation and the running count", async () => {
    const { user, scanId, venueId, best, runnerUp, reject, object, feedbackRows } = await fixture();
    const { feedbackId } = await reject(best.objectId);
    expect(await feedbackRows()).toMatchObject([
      {
        _id: feedbackId,
        scanId,
        deviceId: user.deviceId,
        vector: testVector(),
        modelVersion: model.modelVersion,
        venueId,
        rejectedObjectId: best.objectId,
        score: 0.8,
        margin: 0.1,
        orbInliers: 20,
        probability: 0.9,
        calibratorVersion: "lr-v1",
        venueMismatch: false,
        resolution: { kind: "unresolved" },
      },
    ]);
    const counted = await object(best.objectId);
    expect(counted).toMatchObject({ rejectCount: 1, confirmCount: 0, calibratorPenalty: 0 });
    expect(counted?.flaggedForReview).toBeUndefined();
    await reject(runnerUp.objectId);
    expect((await feedbackRows())[1]).toMatchObject({
      rejectedObjectId: runnerUp.objectId,
      score: 0.7,
      probability: 0.4,
      venueMismatch: true,
    });
  });

  it("accepts only the scan’s own candidates and only from the scan’s device", async () => {
    const { t, scanId, best, other, reject, feedbackRows } = await fixture();
    await expect(reject(other.objectId)).rejects.toMatchObject({
      data: { code: "invalid_object" },
    });
    const stranger = await seedDevice(t);
    await expect(reject(best.objectId, scanId, stranger.as)).rejects.toMatchObject({
      data: { code: "invalid_scan" },
    });
    expect(await feedbackRows()).toEqual([]);
  });

  it("returns the existing rejection for a repeated tap without counting it again", async () => {
    const { best, reject, object, feedbackRows } = await fixture();
    const first = await reject(best.objectId);
    expect(await reject(best.objectId)).toEqual(first);
    expect(await feedbackRows()).toHaveLength(1);
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 1 });
  });

  it("limits rejections of one work per device per day while another work still passes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const { scanId, best, runnerUp, seedRejectableScan, reject } = await fixture();
    for (const scan of [scanId, await seedRejectableScan(), await seedRejectableScan()])
      await reject(best.objectId, scan);
    const fourth = await seedRejectableScan();
    await expect(reject(best.objectId, fourth)).rejects.toMatchObject({
      data: { code: "rate_limited", name: "rejectPerWork" },
    });
    await expect(reject(runnerUp.objectId, fourth)).resolves.toMatchObject({
      feedbackId: expect.any(String),
    });
  });

  it.each([
    {
      confirmCount: 40,
      rejectCount: 19,
      calibratorPenalty: 0,
      expected: { rejectCount: 20, flaggedForReview: true, calibratorPenalty: 0.2 },
    },
    {
      confirmCount: 100,
      rejectCount: 19,
      calibratorPenalty: 0,
      expected: { rejectCount: 20, calibratorPenalty: 0 },
    },
    {
      confirmCount: 0,
      rejectCount: 5,
      calibratorPenalty: 0,
      expected: { rejectCount: 6, calibratorPenalty: 0 },
    },
    {
      confirmCount: 0,
      rejectCount: 30,
      calibratorPenalty: 0.7,
      expected: { rejectCount: 31, flaggedForReview: true, calibratorPenalty: 0.8 },
    },
  ])(
    "flags and penalizes an object only past the rejection threshold (%#)",
    async ({ expected, ...counts }) => {
      const { t, best, reject, object } = await fixture();
      await t.run((ctx) => ctx.db.patch(best.objectId, counts));
      await reject(best.objectId);
      const row = await object(best.objectId);
      const { calibratorPenalty, ...expectedState } = expected;
      expect(row).toMatchObject(expectedState);
      expect(effectiveObjectPenalty(row!)).toBeCloseTo(calibratorPenalty);
      if (!("flaggedForReview" in expected)) expect(row?.flaggedForReview).toBeUndefined();
    },
  );

  it("requires an attested device when attestation is enforced", async () => {
    vi.stubEnv("APP_ATTEST_REQUIRED", "true");
    const t = harness();
    const user = await signIn(t);
    const { deviceId } = await user.as.mutation(api.devices.registerDevice, { platform: "ios" });
    const work = await t.run((ctx) => seedArtworkWithObject(ctx));
    const scanId = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId,
        best: {
          identityStatus: "established" as const,
          objectId: work.objectId,
          artworkId: work.artworkId,
          probability: 0.9,
        },
        candidateSignals: [
          {
            identityStatus: "established" as const,
            objectId: work.objectId,
            similarity: 0.8,
            margin: 0.1,
            orbInliers: 0,
            probability: 0.9,
            homographyValid: false,
          },
        ],
      }),
    );
    const { nonce } = await user.as.mutation(api.devices.createChallenge, { purpose: "assert" });
    await expect(
      user.as.mutation(api.feedback.rejectMatch, {
        scanId,
        objectId: work.objectId,
        nonce,
        assertionBase64: "AAAA",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_attested" } });
    expect(await t.run((ctx) => ctx.db.get(work.objectId))).toMatchObject({ rejectCount: 0 });
  });
});

describe("resolveRejection", () => {
  it("keeps a completed resolution immutable while allowing identical retries", async () => {
    const { t, user, scanId, venueId, best, runnerUp, other, reject, feedback, proposals } =
      await fixture();
    await t.run((ctx) =>
      ctx.db.patch(scanId, {
        runnerUps: [runnerUp, other].map((work) => ({
          identityStatus: "established" as const,
          objectId: work.objectId,
          artworkId: work.artworkId,
          probability: 0.4,
        })),
      }),
    );
    const { feedbackId } = await reject(best.objectId);
    const resolution = { kind: "runner_up" as const, objectId: runnerUp.objectId };
    await user.as.mutation(api.feedback.resolveRejection, { feedbackId, resolution });
    await user.as.mutation(api.feedback.resolveRejection, { feedbackId, resolution });
    const contributionId = await t.run((ctx) =>
      seedContribution(ctx, { deviceId: user.deviceId, venueId, scanId }),
    );
    for (const replacement of [
      { kind: "runner_up" as const, objectId: other.objectId },
      { kind: "label" as const, contributionId },
    ])
      await expect(
        user.as.mutation(api.feedback.resolveRejection, { feedbackId, resolution: replacement }),
      ).rejects.toMatchObject({ data: { code: "invalid_resolution" } });
    expect(await feedback(feedbackId)).toMatchObject({ resolution });
    expect((await proposals()).map((proposal) => proposal.objectId)).toEqual([runnerUp.objectId]);
  });

  it("resolves to a runner-up and proposes its venue once when the placement disagrees", async () => {
    const { user, scanId, venueId, best, runnerUp, reject, feedback, proposals } = await fixture();
    const { feedbackId } = await reject(best.objectId);
    const resolution = { kind: "runner_up" as const, objectId: runnerUp.objectId };
    await user.as.mutation(api.feedback.resolveRejection, { feedbackId, resolution });
    expect(await feedback(feedbackId)).toMatchObject({ resolution });
    expect(await proposals()).toMatchObject([
      {
        objectId: runnerUp.objectId,
        proposedVenueId: venueId,
        kind: "move",
        scanIds: [scanId],
        deviceIds: [user.deviceId],
        readyForReview: false,
      },
    ]);
    await user.as.mutation(api.feedback.resolveRejection, { feedbackId, resolution });
    expect((await proposals())[0].scanIds).toEqual([scanId]);
  });

  it("proposes nothing when the chosen work already hangs at the scan’s venue", async () => {
    const { user, best, runnerUp, reject, feedback, proposals } = await fixture();
    const { feedbackId } = await reject(runnerUp.objectId);
    await user.as.mutation(api.feedback.resolveRejection, {
      feedbackId,
      resolution: { kind: "runner_up", objectId: best.objectId },
    });
    expect(await feedback(feedbackId)).toMatchObject({
      resolution: { kind: "runner_up", objectId: best.objectId },
    });
    expect(await proposals()).toEqual([]);
  });

  it("resolves to the device’s own label contribution for the same scan", async () => {
    const { t, user, scanId, venueId, best, reject, feedback } = await fixture();
    const { feedbackId } = await reject(best.objectId);
    const contributionId = await t.run((ctx) =>
      seedContribution(ctx, { deviceId: user.deviceId, venueId, scanId }),
    );
    await user.as.mutation(api.feedback.resolveRejection, {
      feedbackId,
      resolution: { kind: "label", contributionId },
    });
    await user.as.mutation(api.feedback.resolveRejection, {
      feedbackId,
      resolution: { kind: "label", contributionId },
    });
    await expect(
      user.as.mutation(api.feedback.resolveRejection, {
        feedbackId,
        resolution: { kind: "runner_up", objectId: best.objectId },
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_resolution" } });
    expect(await feedback(feedbackId)).toMatchObject({
      resolution: { kind: "label", contributionId },
    });
  });

  it("refuses invalid resolutions and other devices’ feedback", async () => {
    const { t, user, scanId, venueId, best, runnerUp, other, reject, feedback } = await fixture();
    const { feedbackId } = await reject(best.objectId);
    const resolve = (
      resolution:
        | { kind: "runner_up"; objectId: Id<"objects"> }
        | { kind: "label"; contributionId: Id<"contributions"> },
      as = user.as,
    ) => as.mutation(api.feedback.resolveRejection, { feedbackId, resolution });
    await expect(resolve({ kind: "runner_up", objectId: best.objectId })).rejects.toMatchObject({
      data: { code: "invalid_resolution" },
    });
    await expect(resolve({ kind: "runner_up", objectId: other.objectId })).rejects.toMatchObject({
      data: { code: "invalid_resolution" },
    });
    const otherScan = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId }));
    const otherScanContribution = await t.run((ctx) =>
      seedContribution(ctx, { deviceId: user.deviceId, venueId, scanId: otherScan }),
    );
    await expect(
      resolve({ kind: "label", contributionId: otherScanContribution }),
    ).rejects.toMatchObject({ data: { code: "invalid_resolution" } });
    const stranger = await seedDevice(t);
    const strangerContribution = await t.run((ctx) =>
      seedContribution(ctx, { deviceId: stranger.deviceId, venueId, scanId }),
    );
    await expect(
      resolve({ kind: "label", contributionId: strangerContribution }),
    ).rejects.toMatchObject({ data: { code: "invalid_resolution" } });
    await expect(
      resolve({ kind: "runner_up", objectId: runnerUp.objectId }, stranger.as),
    ).rejects.toMatchObject({ data: { code: "feedback_not_found" } });
    expect(await feedback(feedbackId)).toMatchObject({ resolution: { kind: "unresolved" } });
  });
});

describe("false rejections", () => {
  it.each([0, 0.7, 0.8])(
    "undoes false-rejection penalties without touching the independent %s penalty",
    async (basePenalty) => {
      const { t, user, scanId, best, reject, object, feedback } = await fixture();
      await t.run((ctx) =>
        ctx.db.patch(best.objectId, { rejectCount: 19, calibratorPenalty: basePenalty }),
      );
      const { feedbackId } = await reject(best.objectId);
      expect(effectiveObjectPenalty((await object(best.objectId))!)).toBeCloseTo(
        Math.min(0.8, basePenalty + 0.2),
      );
      const write = () =>
        t.mutation(internal.label.write, {
          scanId,
          deviceId: user.deviceId,
          generation: 0,
          labelFlow: {
            stage: "verified",
            moderation: "clear",
            evidence: ["accession"],
            warnings: [],
            updatedAt: Date.now(),
            fields: {
              title: labelField("Water Lilies", "accession"),
              artist: labelField("Claude Monet", "accession"),
            },
          },
        });
      await write();
      await write();
      expect(await feedback(feedbackId)).toMatchObject({ resolution: { kind: "false_rejection" } });
      expect((await object(best.objectId))?.calibratorPenalty).toBeCloseTo(basePenalty);
      expect(effectiveObjectPenalty((await object(best.objectId))!)).toBeCloseTo(basePenalty);
      expect(await object(best.objectId)).toMatchObject({ rejectCount: 19 });
    },
  );

  it("preserves other rejection penalties at the cap and corpus penalty updates", async () => {
    const { t, user, scanId, best, seedRejectableScan, reject, object } = await fixture();
    await t.run((ctx) => ctx.db.patch(best.objectId, { rejectCount: 19, calibratorPenalty: 0.7 }));
    const otherScanId = await seedRejectableScan();
    await reject(best.objectId);
    await reject(best.objectId, otherScanId);
    const verify = (scan: Id<"scans">) =>
      t.mutation(internal.label.write, {
        scanId: scan,
        deviceId: user.deviceId,
        generation: 0,
        labelFlow: {
          stage: "verified",
          moderation: "clear",
          evidence: ["accession"],
          warnings: [],
          updatedAt: Date.now(),
          fields: {
            title: labelField("Water Lilies", "accession"),
            artist: labelField("Claude Monet", "accession"),
          },
        },
      });
    await verify(scanId);
    expect(effectiveObjectPenalty((await object(best.objectId))!)).toBeCloseTo(0.8);
    const key = (await object(best.objectId))!.key;
    await t.mutation(internal.ingest.setObjectPenalty, {
      rows: [{ objectKey: key, calibratorPenalty: 0.35 }],
    });
    expect(effectiveObjectPenalty((await object(best.objectId))!)).toBeCloseTo(0.55);
    await verify(otherScanId);
    expect(effectiveObjectPenalty((await object(best.objectId))!)).toBeCloseTo(0.35);
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 19, calibratorPenalty: 0.35 });
  });

  it("keeps a rejection when the verified title is similar but names a different work", async () => {
    const { t, user, scanId, best, reject, object, feedback } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch(best.artworkId, { title: "Still Life with Apples", artist: "Paul Cézanne" }),
    );
    const { feedbackId } = await reject(best.objectId);
    await t.mutation(internal.label.write, {
      scanId,
      deviceId: user.deviceId,
      generation: 0,
      labelFlow: {
        stage: "verified",
        moderation: "clear",
        evidence: ["accession"],
        warnings: [],
        updatedAt: Date.now(),
        fields: {
          title: labelField("Still Life with Pears", "accession"),
          artist: labelField("Paul Cézanne", "accession"),
        },
      },
    });
    expect(await feedback(feedbackId)).toMatchObject({ resolution: { kind: "unresolved" } });
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 1 });
  });

  it("stops counting a rejection once a verified label names the rejected work", async () => {
    const { t, user, scanId, best, runnerUp, reject, object, feedback } = await fixture();
    const { feedbackId } = await reject(best.objectId);
    const write = (fields: LabelFields, stage: "read" | "verified" = "verified") =>
      t.mutation(internal.label.write, {
        scanId,
        deviceId: user.deviceId,
        generation: 0,
        labelFlow: {
          stage,
          fields,
          evidence: [],
          warnings: [],
          moderation: "clear",
          updatedAt: Date.now(),
        },
      });
    await write({
      title: labelField("Haystacks", "ocr"),
      artist: labelField("Claude Monet", "ocr"),
    });
    await write(
      { title: labelField("Water Lilies", "ocr"), artist: labelField("Claude Monet", "ocr") },
      "read",
    );
    expect(await feedback(feedbackId)).toMatchObject({ resolution: { kind: "unresolved" } });
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 1 });
    await write({
      title: labelField("Water lilies", "ocr"),
      artist: labelField("Monet, Claude", "wikidata"),
    });
    expect(await feedback(feedbackId)).toMatchObject({ resolution: { kind: "false_rejection" } });
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 0 });
    await write({
      title: labelField("Water Lilies", "ocr"),
      artist: labelField("Claude Monet", "ocr"),
    });
    expect(await object(best.objectId)).toMatchObject({ rejectCount: 0 });
    await expect(
      user.as.mutation(api.feedback.resolveRejection, {
        feedbackId,
        resolution: { kind: "runner_up", objectId: runnerUp.objectId },
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_resolution" } });
  });
});

describe("exportForTraining", () => {
  it("pages through every rejection with its signals and resolution", async () => {
    const { t, best, runnerUp, seedRejectableScan, reject } = await fixture();
    await reject(best.objectId);
    await reject(runnerUp.objectId);
    await reject(best.objectId, await seedRejectableScan());
    const first = await t.query(internal.feedback.exportForTraining, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.page[0]).toMatchObject({
      score: 0.8,
      margin: 0.1,
      orbInliers: 20,
      probability: 0.9,
      calibratorVersion: "lr-v1",
      venueMismatch: false,
      resolution: { kind: "unresolved" },
      modelVersion: model.modelVersion,
    });
    const second = await t.query(internal.feedback.exportForTraining, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });
});

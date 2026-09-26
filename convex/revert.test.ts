import { afterEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { readArtworkContent } from "./lib/artworkContent";
import { fileStorage } from "./lib/fileStorage";
import { patchObjectDetails, readObjectDetails } from "./lib/objectDetails";
import {
  seedEmbedding,
  seedPublishedContribution,
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
  seedVector,
} from "./lib/testFactories";
import { harness, promoteGroup } from "./test.helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pair = makeSyntheticPair({ count: 120 });
const features = encodeOrbFeatures(pair.ref);

async function seedUserObject(
  ctx: MutationCtx,
  options: {
    venueId: Id<"museums">;
    deviceIds: Id<"devices">[];
    contributionIds?: Id<"contributions">[];
    thumbnailStorageId?: string;
    artworkId?: Id<"artworks">;
    title?: string;
  },
) {
  const sourceId = crypto.randomUUID();
  const artworkId =
    options.artworkId
    ?? (await ctx.db.insert("artworks", {
      identityStatus: "established" as const,
      key: `user:${sourceId}`,
      title: options.title ?? "Water Lilies",
      artist: "Claude Monet",
      rightsStatus: "unknown",
      multiplicity: "unknown",
    }));
  const objectId = await ctx.db.insert("objects", {
    identityStatus: "established" as const,
    key: `user:${sourceId}`,
    artworkId,
    ownerId: options.venueId,
    source: "user",
    sourceId,
    provenance: {
      contributionIds: options.contributionIds ?? [],
      deviceIds: options.deviceIds,
    },
    confirmCount: 0,
    rejectCount: 0,
    calibratorPenalty: 0,
    reverted: false,
  });
  await patchObjectDetails(ctx, { _id: objectId }, { thumbnailStorageId: options.thumbnailStorageId });
  await seedVector(ctx, {
    partition: JSON.stringify([model.modelVersion, "established"]),
    objectId,
    modelVersion: model.modelVersion,
    source: "user",
    vector: testVector(),
  });
  await ctx.db.insert("placements", {
    identityStatus: "established",
    objectId,
    venueId: options.venueId,
    onView: true,
    source: "contribution",
    confidence: 0.7,
  });
  return { artworkId, objectId };
}

async function fixture() {
  vi.useFakeTimers({ now: Date.UTC(2026, 8, 10, 12) });
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const get = <
    T extends
      | "contributions"
      | "objects"
      | "devices"
      | "artworks"
      | "feedback"
      | "museums"
      | "placementProposals"
      | "optOuts"
      | "takedowns",
  >(
    table: T,
    id: Id<T>,
  ) => t.run((ctx) => ctx.db.get(table, id)) as Promise<Doc<T> | null>;
  const all = <T extends "objects" | "vectors" | "descriptors" | "placements" | "contributions">(table: T) =>
    t.run((ctx) => ctx.db.query(table).collect()) as Promise<Doc<T>[]>;
  const finish = () => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return { t, alice, bob, venueId, get, all, finish, scheduled };
}

describe("revertObject", () => {
  it("keeps a shared ORB file until the last object reference is removed", async () => {
    const t = harness();
    const { first, second, storageId } = await t.run(async (ctx) => {
      const first = await seedArtworkWithObject(ctx, { descriptors: pair.ref });
      const second = await seedArtworkWithObject(ctx);
      const {
        _id: _referenceId,
        _creationTime: _createdAt,
        ...reference
      } = (await ctx.db.query("descriptors").unique())!;
      await ctx.db.insert("descriptors", {
        ...reference,
        objectId: second.objectId,
      });
      return { first, second, storageId: reference.storageId };
    });
    await t.action(internal.revert.revertObjectById, {
      objectId: first.objectId,
      reason: "test",
    });
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, storageId))).not.toBeNull();
    await t.action(internal.revert.revertObjectById, {
      objectId: second.objectId,
      reason: "test",
    });
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, storageId))).toBeNull();
  });

  it("removes the work from identification, closes its placement, deletes the crop and rejects its contributions", async () => {
    const { t, alice, venueId, get, all } = await fixture();
    const cropStorageId = await t.run((ctx) =>
      fileStorage.store(ctx, new Blob([new Uint8Array(1000)], { type: "image/jpeg" })),
    );
    const contributionId = await t.run((ctx) =>
      seedContribution(ctx, {
        deviceId: alice.deviceId,
        venueId,
        cropStorageId,
        ...features,
        keypointCount: pair.ref.count,
        evidence: ["qr"],
        fields: {
          title: { value: "Water Lilies", edited: false, evidence: "qr" },
          artist: { value: "Claude Monet", edited: false, evidence: "qr" },
        },
      }),
    );
    await t.run(async (ctx) => seedPublishedContribution(ctx, (await ctx.db.get("contributions", contributionId))!));
    const [object] = await all("objects");
    const capture = () => ({
      localId: crypto.randomUUID(),
      venueId,
      vector: testVector(),
      ...encodeOrbFeatures(pair.query),
      modelVersion: model.modelVersion,
      capturedAt: Date.now(),
    });
    expect(
      (
        await alice.as.action(api.identify.identify, {
          ...capture(),
          scope: (await alice.as.query(api.accounts.me, {})).scope,
        })
      ).best?.objectId,
    ).toBe(object._id);
    await t.action(internal.revert.revertObjectById, {
      objectId: object._id,
      reason: "mislabeled",
    });
    expect(await get("objects", object._id)).toMatchObject({
      reverted: true,
      revertedReason: "mislabeled",
    });
    expect(
      (await t.run(async (ctx) => readObjectDetails(ctx, (await ctx.db.get("objects", object._id))!)))
        ?.thumbnailStorageId,
    ).toBeUndefined();
    expect(await all("vectors")).toEqual([]);
    expect(await all("descriptors")).toEqual([]);
    expect(await all("placements")).toMatchObject([{ objectId: object._id, closedAt: Date.now() }]);
    expect(await t.run((ctx) => fileStorage.getMetadata(ctx, cropStorageId))).toBeNull();
    expect(await get("contributions", contributionId)).toMatchObject({
      status: "rejected",
      rejectedReason: "object_reverted",
      indexedObjectId: object._id,
    });
    expect((await get("contributions", contributionId))?.cropStorageId).toBeUndefined();
    const after = await alice.as.action(api.identify.identify, {
      ...capture(),
      scope: (await alice.as.query(api.accounts.me, {})).scope,
    });
    expect(after.outcome).toBe("miss");
    expect(after.best).toBeUndefined();
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      vectors: 0,
      descriptors: 0,
    });
  });
});

describe("applyOptOut", () => {
  it("flips the venue, blocks its page fetches and reverts user objects placed there across chunks", async () => {
    const { t, alice, venueId, get, all, finish } = await fixture();
    const elsewhere = await t.run((ctx) => seedMuseum(ctx));
    const seeded = await t.run(async (ctx) => {
      const mine: Id<"objects">[] = [];
      for (let i = 0; i < 30; i++) {
        mine.push(
          (
            await seedUserObject(ctx, {
              venueId,
              deviceIds: [alice.deviceId],
              title: `Study ${i}`,
            })
          ).objectId,
        );
      }
      const corpus = await seedArtworkWithObject(ctx, {
        placement: { venueId, onView: true, source: "feed", confidence: 1 },
      });
      const away = await seedUserObject(ctx, {
        venueId: elsewhere,
        deviceIds: [alice.deviceId],
      });
      return { mine, corpus, away };
    });
    const optOutId = await t.mutation(internal.revert.applyOptOut, {
      venueId,
      requester: "registrar@museum.example",
    });
    expect(await get("museums", venueId)).toMatchObject({ optOut: true });
    expect(await get("optOuts", optOutId)).toMatchObject({
      venueId,
      requester: "registrar@museum.example",
      receivedAt: Date.now(),
    });
    expect((await get("optOuts", optOutId))?.appliedAt).toBeUndefined();
    expect(await t.query(internal.museums.getForProbe, { venueId })).toBeNull();
    await finish();
    expect((await get("optOuts", optOutId))?.appliedAt).toBe(Date.now());
    for (const objectId of seeded.mine) {
      expect(await get("objects", objectId)).toMatchObject({
        reverted: true,
        revertedReason: `opt_out: ${venueId}`,
      });
    }
    expect(await get("objects", seeded.corpus.objectId)).toMatchObject({
      reverted: false,
    });
    expect(await get("objects", seeded.away.objectId)).toMatchObject({ reverted: false });
    expect((await all("vectors")).map((row) => row.objectId).sort()).toEqual(
      [seeded.corpus.objectId, seeded.away.objectId].sort(),
    );
  });
});

describe("applyTakedown", () => {
  const factSheet = [
    {
      id: "f1",
      text: "Painted in 1916.",
      sourceUrl: "https://museum.example/work",
      sourceLabel: "Museum",
      sourceScore: 1,
    },
  ];
  const docent = { en: [{ sentence: "Painted in 1916.", factIds: ["f1"] }] };

  it("clears the artwork prose, holds regeneration, and reverts every object of the artwork", async () => {
    const { t, alice, venueId, get, all, finish } = await fixture();
    const seeded = await t.run(async (ctx) => {
      const corpus = await seedArtworkWithObject(ctx, {
        artworkContent: { factSheet, docent },
        artwork: {
          factSheetUpdatedAt: 1,
          docentUpdatedAt: 1,
          enrichGeneration: 3,
        },
        placement: { venueId, onView: true, source: "feed", confidence: 1 },
      });
      const user = await seedUserObject(ctx, {
        venueId,
        deviceIds: [alice.deviceId],
        artworkId: corpus.artworkId,
      });
      const other = await seedArtworkWithObject(ctx, {
        artworkContent: { factSheet, docent },
        artwork: {
          title: "Haystacks",
          factSheetUpdatedAt: 1,
        },
      });
      return { corpus, user, other };
    });
    const takedownId = await t.mutation(internal.revert.applyTakedown, {
      artworkId: seeded.corpus.artworkId,
      requester: "estate@example.org",
    });
    const artwork = await get("artworks", seeded.corpus.artworkId);
    expect(artwork).toMatchObject({
      factSheetNeedsReview: true,
      enrichGeneration: 4,
    });
    for (const field of ["contentId", "factSheetUpdatedAt", "docentUpdatedAt", "enrichClaimedAt"] as const) {
      expect(artwork?.[field]).toBeUndefined();
    }
    await finish();
    expect(await get("takedowns", takedownId)).toMatchObject({
      artworkId: seeded.corpus.artworkId,
      requester: "estate@example.org",
      appliedAt: Date.now(),
    });
    expect(await get("objects", seeded.corpus.objectId)).toMatchObject({
      reverted: true,
      revertedReason: `takedown: ${takedownId}`,
    });
    expect(await get("objects", seeded.user.objectId)).toMatchObject({ reverted: true });
    expect(await get("objects", seeded.other.objectId)).toMatchObject({ reverted: false });
    expect(
      await t.run(async (ctx) => readArtworkContent(ctx, (await ctx.db.get("artworks", seeded.other.artworkId))!)),
    ).toMatchObject({ factSheet, docent });
    expect(await t.run((ctx) => ctx.db.query("artworkContent").collect())).toHaveLength(1);
    expect((await all("vectors")).map((row) => row.objectId)).toEqual([seeded.other.objectId]);
    expect(
      await t.mutation(internal.docent.claim, {
        artworkId: seeded.corpus.artworkId,
      }),
    ).toBeNull();
  });

  it("hides a single object immediately and completes its cleanup before marking the takedown applied", async () => {
    const { t, alice, venueId, get, finish } = await fixture();
    const { objectId, artworkId } = await t.run((ctx) => seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId] }));
    const takedownId = await t.mutation(internal.revert.applyTakedown, {
      objectId,
      requester: "estate@example.org",
    });
    expect(await get("objects", objectId)).toMatchObject({
      reverted: true,
      revertedReason: `takedown: ${takedownId}`,
    });
    expect((await get("takedowns", takedownId))?.appliedAt).toBeUndefined();
    await finish();
    expect(await get("takedowns", takedownId)).toMatchObject({
      objectId,
      appliedAt: Date.now(),
    });
    expect((await get("artworks", artworkId))?.factSheetNeedsReview).toBeUndefined();
    await expect(t.mutation(internal.revert.applyTakedown, { requester: "x" })).rejects.toMatchObject({
      data: { code: "takedown_target" },
    });
    await expect(
      t.mutation(internal.revert.applyTakedown, {
        objectId,
        artworkId,
        requester: "x",
      }),
    ).rejects.toMatchObject({ data: { code: "takedown_target" } });
  });
});

describe("cascade transaction limits", () => {
  it("cleans 25 objects with 60 views each before completing an opt-out", { timeout: 30_000 }, async () => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    for (let batch = 0; batch < 25; batch++) {
      await t.run(async (ctx) => {
        const work = await seedUserObject(ctx, { venueId, deviceIds: [] });
        for (let i = 0; i < 60; i++) {
          const vector = Array<number>(model.embeddingDim).fill(0);
          vector[i] = 1;
          await seedVector(ctx, {
            partition: JSON.stringify([model.modelVersion, "established"]),
            objectId: work.objectId,
            source: "user_scan",
            modelVersion: model.modelVersion,
            vector,
          });
        }
      });
    }
    const optOutId = await t.mutation(internal.revert.applyOptOut, {
      venueId,
      requester: "museum",
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await t.run((ctx) => ctx.db.get("optOuts", optOutId))).toMatchObject({
      appliedAt: expect.any(Number),
    });
    expect(await t.run((ctx) => ctx.db.query("vectors").first())).toBeNull();
    expect((await t.run((ctx) => ctx.db.query("objects").collect())).every((row) => row.reverted)).toBe(true);
  });
});

describe("object cleanup resumption", () => {
  it("drains child pages and can restart without changing counters or rejection reasons twice", async () => {
    const t = harness({ transactionLimits: true });
    const device = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const work = await t.run((ctx) => seedUserObject(ctx, { venueId, deviceIds: [device.deviceId] }));
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 50; i++) {
          await seedVector(ctx, {
            partition: JSON.stringify([model.modelVersion, "established"]),
            objectId: work.objectId,
            source: "user_scan",
            modelVersion: model.modelVersion,
            vector: testVector(0.9),
          });
        }
      });
    }
    for (let batch = 0; batch < 2; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 40; i++) {
          await seedContribution(ctx, {
            deviceId: device.deviceId,
            venueId,
            indexedObjectId: work.objectId,
            status: i === 0 ? "rejected" : "tentative",
            rejectedReason: i === 0 ? "device_reverted" : undefined,
          });
        }
      });
    }
    await t.run((ctx) =>
      ctx.db.insert("ingestCounters", {
        museums: 1,
        artworks: 1,
        objects: 1,
        placements: 1,
        vectors: 151,
        descriptors: 0,
      }),
    );
    await t.mutation(internal.revert.beginObjectRevert, {
      objectId: work.objectId,
      reason: "mislabeled",
    });
    expect(
      await t.mutation(internal.revert.cleanupObjectPage, {
        objectId: work.objectId,
        phase: "vectors",
        cursor: null,
      }),
    ).toEqual(expect.any(String));
    await t.action(internal.revert.revertObjectById, {
      objectId: work.objectId,
      reason: "retry",
    });
    await t.action(internal.revert.revertObjectById, {
      objectId: work.objectId,
      reason: "retry",
    });
    expect(await t.run((ctx) => ctx.db.query("vectors").first())).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query("contributions").collect());
    expect(rows).toHaveLength(80);
    expect(rows.every((row) => row.status === "rejected")).toBe(true);
    expect(rows.filter((row) => row.rejectedReason === "device_reverted")).toHaveLength(2);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      vectors: 0,
    });
    expect(await t.run((ctx) => ctx.db.get("objects", work.objectId))).toMatchObject({
      revertedReason: "mislabeled",
    });
  });
});

it.each(["first", "second"] as const)("removes views when their %s agreement witness is banned", async (witness) => {
  vi.useFakeTimers();
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  for (const [deviceId, vector] of [
    [alice.deviceId, testVector(0.9)],
    [bob.deviceId, testVector(0.8)],
  ] as const) {
    await t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId });
      await ctx.db.insert("feedback", {
        scanId,
        deviceId,
        embeddingId: await seedEmbedding(ctx, { vector }),
        modelVersion: model.modelVersion,
        venueId,
        rejectedObjectId: wrong.objectId,
        score: 0.8,
        margin: 0.1,
        orbInliers: 20,
        probability: 0.9,
        calibratorVersion: "lr-v1",
        venueMismatch: false,
        penaltyAdded: 0,
        resolution: { kind: "runner_up", objectId: work.objectId },
        createdAt: Date.now(),
      });
    });
  }
  await promoteGroup(t, work.objectId, venueId);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, {
    deviceId: witness === "first" ? alice.deviceId : bob.deviceId,
    reason: "poisoning",
  });
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  const remaining = await t.run((ctx) =>
    ctx.db
      .query("vectors")
      .withIndex("by_objectId_modelVersion_source", (q) =>
        q.eq("objectId", work.objectId).eq("modelVersion", model.modelVersion).eq("source", "user_scan"),
      )
      .collect(),
  );
  expect(remaining).toHaveLength(0);
});

it("reconsiders duplicate views across witness pages and restores them with clean agreement", async () => {
  const { t, alice, bob, venueId, finish } = await fixture();
  const carol = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  const add = (deviceId: Id<"devices">, vector: number[]) =>
    t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId });
      return ctx.db.insert("feedback", {
        scanId,
        deviceId,
        embeddingId: await seedEmbedding(ctx, { vector }),
        modelVersion: model.modelVersion,
        venueId,
        rejectedObjectId: wrong.objectId,
        score: 0.8,
        margin: 0.1,
        orbInliers: 20,
        probability: 0.9,
        calibratorVersion: "lr-v1",
        venueMismatch: false,
        penaltyAdded: 0,
        resolution: { kind: "runner_up", objectId: work.objectId },
        createdAt: Date.now(),
      });
    });
  await add(alice.deviceId, testVector(0.9));
  const bobRows: Id<"feedback">[] = [];
  for (let i = 0; i < 35; i++) {
    bobRows.push(await add(bob.deviceId, testVector(0.8)));
  }
  await promoteGroup(t, work.objectId, venueId);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "poisoning",
  });
  await finish();
  for (const id of bobRows) {
    const row = await t.run((ctx) => ctx.db.get("feedback", id));
    expect(row?.resolution.kind).toBe("runner_up");
    expect(row?.multiViewAt).toBeUndefined();
    expect(row?.multiViewAgreement).toBeUndefined();
  }
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(0);
  await add(carol.deviceId, testVector(0.6));
  await promoteGroup(t, work.objectId, venueId);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "retry",
  });
  await finish();
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
});

it("removes a taken-down object from a previously identified scan card", async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: user.deviceId,
      outcome: "confident",
      best: {
        identityStatus: "established" as const,
        objectId: work.objectId,
        artworkId: work.artworkId,
        probability: 0.99,
      },
    }),
  );
  const requestId = await t.mutation(internal.revert.applyTakedown, {
    objectId: work.objectId,
    requester: "owner",
  });
  expect((await user.as.query(api.scans.get, { scanId }))?.best).toBeUndefined();
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  expect((await t.run((ctx) => ctx.db.get("takedowns", requestId)))?.appliedAt).toEqual(expect.any(Number));
  expect((await user.as.query(api.scans.get, { scanId }))?.best).toBeUndefined();
  const cached = await user.as.action(api.identify.identify, {
    localId: (await t.run((ctx) => ctx.db.get("scans", scanId)))!.localId,
    vector: testVector(),
    ...features,
    modelVersion: model.modelVersion,
    capturedAt: Date.now(),
    scope: (await user.as.query(api.accounts.me, {})).scope,
  });
  expect(cached.best).toBeUndefined();
});

it("removes vectors learned at an opted-out venue while preserving the corpus vector", async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const work = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      placement: { venueId, onView: true, source: "feed", confidence: 1 },
    }),
  );
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  for (let i = 0; i < 30; i++) {
    const deviceId = i === 29 ? bob.deviceId : alice.deviceId;
    const vector = testVector(i === 29 ? 0.8 : 0.9);
    await t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId, vector });
      await ctx.db.insert("feedback", {
        scanId,
        deviceId,
        embeddingId: await seedEmbedding(ctx, { vector }),
        modelVersion: model.modelVersion,
        venueId,
        rejectedObjectId: wrong.objectId,
        score: 0.8,
        margin: 0.1,
        orbInliers: 20,
        probability: 0.9,
        calibratorVersion: "lr-v1",
        venueMismatch: false,
        penaltyAdded: 0,
        resolution: { kind: "runner_up", objectId: work.objectId },
        createdAt: Date.now(),
      });
    });
  }
  await promoteGroup(t, work.objectId, venueId);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  const requestId = await t.mutation(internal.revert.applyOptOut, {
    venueId,
    requester: "museum",
  });
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  const remaining = await t.run((ctx) =>
    ctx.db
      .query("vectors")
      .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", work.objectId))
      .collect(),
  );
  expect(remaining.map((row) => row.source)).toEqual(["corpus"]);
  expect(await t.run((ctx) => ctx.db.get("optOuts", requestId))).toMatchObject({
    appliedAt: expect.any(Number),
  });
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(0);
});

it.each(["ban", "opt_out", "duplicate_opt_out"] as const)(
  "preserves independently confirmed views through %s across duplicate pages",
  async (removal) => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const [alice, bob, carol, dan] = await Promise.all(Array.from({ length: 4 }, () => seedDevice(t)));
    const venueA = await t.run(seedMuseum);
    const venueB = await t.run(seedMuseum);
    const work = await t.run((ctx) => seedArtworkWithObject(ctx));
    const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
    for (const [deviceId, venueId, vector] of [
      [alice.deviceId, venueA, testVector(0.9)],
      [bob.deviceId, venueA, testVector(0.8)],
      ...Array.from({ length: 35 }, () => [carol.deviceId, venueB, testVector(0.9)] as const),
      [dan.deviceId, venueB, testVector(0.8)],
    ] as const) {
      await t.run(async (ctx) => {
        const scanId = await seedScan(ctx, { deviceId, venueId, vector });
        await ctx.db.insert("feedback", {
          scanId,
          deviceId,
          embeddingId: await seedEmbedding(ctx, { vector }),
          modelVersion: model.modelVersion,
          venueId,
          rejectedObjectId: wrong.objectId,
          score: 0.8,
          margin: 0.1,
          orbInliers: 20,
          probability: 0.9,
          calibratorVersion: "lr-v1",
          venueMismatch: false,
          penaltyAdded: 0,
          resolution: { kind: "runner_up", objectId: work.objectId },
          createdAt: Date.now(),
        });
      });
    }
    await promoteGroup(t, work.objectId, venueA);
    await promoteGroup(t, work.objectId, venueB);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
    if (removal === "ban") {
      await t.mutation(internal.revert.revertDevice, {
        deviceId: alice.deviceId,
        reason: "abuse",
      });
    } else {
      await t.mutation(internal.revert.applyOptOut, {
        venueId: removal === "opt_out" ? venueA : venueB,
        requester: "museum",
      });
    }
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    const rows = await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) =>
          q.eq("objectId", work.objectId).eq("modelVersion", model.modelVersion).eq("source", "user_scan"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  },
);

it("backs off while a dependency waits, parks a ban that never settles, and resumes it on request", async () => {
  vi.useFakeTimers();
  const t = harness();
  const alice = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.mutation(internal.revert.beginObjectRevert, {
    objectId: work.objectId,
    reason: "no_eligible_contributions",
  });
  const jobId = await t.run(async (ctx) => {
    await ctx.db.patch("devices", alice.deviceId, { banned: true });
    const jobId = await ctx.db.insert("deviceRemovals", {
      deviceId: alice.deviceId,
      reason: "abuse",
      phase: "settling",
      cursor: null,
      processed: 1,
      settled: 0,
      settleAttempts: 0,
      resumeRevision: 0,
      startedAt: Date.now(),
    });
    await ctx.db.insert("removalDependencies", {
      jobId,
      objectId: work.objectId,
    });
    return jobId;
  });
  await t.mutation(internal.revert.cleanupDevicePage, { jobId });
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "settling", settled: 0, settleAttempts: 1 });
  // The interrupted object revert is never rescheduled by itself: the job must stop retrying.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "stalled", settled: 0, settleAttempts: 30 });
  expect(await t.run((ctx) => ctx.db.get("vectors", work.vectorId))).not.toBeNull();
  await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "complete", settled: 1, settleAttempts: 0 });
  expect(await t.run((ctx) => ctx.db.get("vectors", work.vectorId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("objects", work.objectId))).toHaveProperty("revertCompletedAt");
});

it("removes every scan-owned vector across pages while preserving corpus vectors", async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: alice.deviceId }));
  for (let page = 0; page < 3; page++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await seedVector(ctx, {
          objectId: work.objectId,
          scanId,
          partition: JSON.stringify([model.modelVersion, "established"]),
          modelVersion: model.modelVersion,
          source: "user_scan",
          vector: testVector(),
        });
      }
    });
  }
  await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
        .collect(),
    ),
  ).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get("vectors", work.vectorId))).not.toBeNull();
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "complete", settled: 76 });
});

it("re-schedules parked rebuilds and scan cleanup when a stalled ban is resumed", async () => {
  vi.useFakeTimers();
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: alice.deviceId }));
  const { contributionId, objectId, jobId } = await t.run(async (ctx) => {
    await ctx.db.patch("devices", alice.deviceId, { banned: true });
    const cropStorageId = await fileStorage.store(ctx, new Blob(["crop"], { type: "image/jpeg" }));
    const contributionId = await seedContribution(ctx, {
      deviceId: bob.deviceId,
      venueId,
      cropStorageId,
    });
    const objectId = await seedPublishedContribution(ctx, (await ctx.db.get("contributions", contributionId))!);
    const object = (await ctx.db.get("objects", objectId))!;
    await seedVector(ctx, {
      objectId: work.objectId,
      scanId,
      partition: JSON.stringify([model.modelVersion, "established"]),
      modelVersion: model.modelVersion,
      source: "user_scan",
      vector: testVector(),
    });
    // Rebuild rows whose scheduled runs were lost, and a scan whose vector cleanup never ran.
    await ctx.db.insert("entryRebuilds", {
      objectId,
      revision: object.supportRevision ?? 0,
      cursor: null,
    });
    await ctx.db.insert("feedbackRebuilds", {
      objectId,
      revision: object.feedbackRevision ?? 0,
      cursor: null,
      confirmCount: 0,
      rejectCount: 0,
      rejectionPenalty: 0,
      flaggedForReview: false,
    });
    const jobId = await ctx.db.insert("deviceRemovals", {
      deviceId: alice.deviceId,
      reason: "abuse",
      phase: "settling",
      cursor: null,
      processed: 2,
      settled: 0,
      settleAttempts: 0,
      resumeRevision: 0,
      startedAt: Date.now(),
    });
    await ctx.db.insert("removalDependencies", { jobId, objectId });
    await ctx.db.insert("removalDependencies", { jobId, scanId });
    return { contributionId, objectId, jobId };
  });
  await t.mutation(internal.revert.cleanupDevicePage, { jobId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "stalled", settled: 0 });
  expect(await t.run((ctx) => ctx.db.query("entryRebuilds").collect())).toHaveLength(1);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
        .collect(),
    ),
  ).toHaveLength(1);
  await t.mutation(internal.revert.revertDevice, {
    deviceId: alice.deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // The rescheduled scan cleanup registers and settles one more dependency for the vector it deletes.
  expect(
    await t.query(internal.revert.removalProgress, {
      deviceId: alice.deviceId,
    }),
  ).toMatchObject({ phase: "complete", settled: 3 });
  expect(await t.run((ctx) => ctx.db.query("entryRebuilds").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("feedbackRebuilds").collect())).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
        .collect(),
    ),
  ).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get("vectors", work.vectorId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
    reverted: false,
    sourceContributionId: contributionId,
  });
});

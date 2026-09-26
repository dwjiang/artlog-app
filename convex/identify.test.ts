import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_CALIBRATOR } from "./lib/calibrator/weights";
import { completion, jsonResponse } from "./lib/labelFixtures";
import { storeOrb } from "./lib/orbStorage";
import { FIXTURE_NOW } from "./lib/rightNowFixtures";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedJournalVisit, testVector } from "./lib/testFactories";
import { insertVector } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { harness, signIn } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const pair = makeSyntheticPair({ count: 120 });
const capture = () => ({
  localId: crypto.randomUUID(),
  vector: testVector(),
  ...encodeOrbFeatures(pair.query),
  modelVersion: model.modelVersion,
  capturedAt: Date.now(),
});

const storedCorners = async (t: ReturnType<typeof harness>, scanId: Id<"scans">) =>
  (await t.run((ctx) => ctx.db.get("scans", scanId)))?.best?.corners;

async function fixture(withWork = true) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const visitId = await t.run((ctx) => seedJournalVisit(ctx, user.deviceId, venueId, { startedAt: Date.now() }));
  const work = withWork
    ? await t.run((ctx) =>
        seedArtworkWithObject(ctx, {
          descriptors: pair.ref,
          placement: {
            venueId,
            gallery: "4",
            onView: true,
            source: "feed",
            confidence: 1,
          },
        }),
      )
    : null;
  return {
    t,
    user,
    venueId,
    visitId,
    work,
    args: { ...capture(), venueId, visitId },
  };
}

describe("identify action", () => {
  it("fetches only the ten ORB references it verifies, skipping candidates without references", async () => {
    const { t, user, venueId, args } = await fixture(false);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        const work = await seedArtworkWithObject(ctx, {
          vector: testVector(1 - i / 100),
          descriptors: i === 0 ? undefined : pair.ref,
          placement: { venueId, onView: true, source: "feed", confidence: 1 },
        });
        if (i > 10) {
          const reference = (await ctx.db
            .query("descriptors")
            .withIndex("by_objectId", (q) => q.eq("objectId", work.objectId))
            .unique())!;
          await ctx.storage.delete(reference.storageId);
        }
      }
    });
    const result = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result.status).toBe("identified");
    expect(await storedCorners(t, result.scanId)).toHaveLength(4);
  });

  it("reports a missing file among verified candidates as an error", async () => {
    const { t, user, args } = await fixture();
    await t.run(async (ctx) => ctx.storage.delete((await ctx.db.query("descriptors").unique())!.storageId));
    await expect(
      user.as.action(api.identify.identify, {
        ...args,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      }),
    ).rejects.toMatchObject({ data: { code: "orb_file_missing" } });
  });

  it("stores verified corners, returns display data, persists the embedding, and updates the visit gallery", async () => {
    const { t, user, visitId, args, work } = await fixture();
    const result = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result).toMatchObject({
      status: "identified",
      outcome: "confident",
      calibratorVersion: DEFAULT_CALIBRATOR.version,
      best: {
        objectId: work!.objectId,
        title: "Water Lilies",
        artist: "Claude Monet",
        rightsStatus: "public_domain",
      },
    });
    expect(result.best).not.toHaveProperty("corners");
    expect(await storedCorners(t, result.scanId)).toHaveLength(4);
    expect(await user.as.query(api.scans.get, { scanId: result.scanId })).toEqual(result);
    expect(await t.run((ctx) => ctx.db.get("visits", visitId))).toMatchObject({
      lastConfidentGallery: "4",
      lastConfidentAt: args.capturedAt,
    });
    const scan = await t.run((ctx) => ctx.db.get("scans", result.scanId));
    expect(scan).not.toHaveProperty("vector");
    expect((await t.run((ctx) => ctx.db.get("scanEmbeddings", scan!.embeddingId)))!.vector).toEqual(args.vector);
    expect(scan?.candidateSignals).toHaveLength(1);
    const [signals] = scan!.candidateSignals!;
    expect(signals).toMatchObject({
      objectId: work!.objectId,
      probability: result.best!.probability,
      homographyValid: true,
    });
    expect(signals.similarity).toBeCloseTo(1);
    expect(signals.margin).toBeCloseTo(1);
    expect(signals.orbInliers).toBeGreaterThan(0);
  });

  it("returns an update status for unsupported models before decoding old feature formats", async () => {
    const { user, args } = await fixture();
    const result = await user.as.action(api.identify.identify, {
      ...args,
      modelVersion: "obsolete",
      vector: [1],
      descriptors: new ArrayBuffer(1),
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result).toMatchObject({
      status: "unsupported_version",
      error: "Update the app to identify.",
    });
    expect(result.best).toBeUndefined();
  });

  it("identifies a previously unsupported capture after its model and features are updated", async () => {
    const { t, user, args } = await fixture();
    const old = await user.as.action(api.identify.identify, {
      ...args,
      modelVersion: "retired",
      vector: [1],
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    const updated = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(updated).toMatchObject({
      scanId: old.scanId,
      status: "identified",
      outcome: "confident",
    });
    expect(updated.error).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get("scans", old.scanId))).toMatchObject({
      modelVersion: model.modelVersion,
    });
    const saved = (await t.run((ctx) => ctx.db.get("scans", old.scanId)))!;
    expect((await t.run((ctx) => ctx.db.get("scanEmbeddings", saved.embeddingId)))!.vector).toEqual(args.vector);
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(1);
  });

  it("preserves a supported pending generation when a retired-model retry arrives", async () => {
    const { t, user, venueId, args } = await fixture(false);
    const obsoleteArgs = { ...args, modelVersion: "retired", vector: [1] };
    const obsolete = await user.as.action(api.identify.identify, {
      ...obsoleteArgs,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    await t.mutation(internal.scans.create, {
      deviceId: user.deviceId,
      localId: args.localId,
      venueId,
      visitId: args.visitId,
      modelVersion: args.modelVersion,
      vector: args.vector,
      capturedAt: args.capturedAt,
    });
    const before = await t.run((ctx) => ctx.db.get("scans", obsolete.scanId));
    expect(before).toMatchObject({
      status: "pending",
      generation: 1,
      modelVersion: model.modelVersion,
    });
    expect(
      await user.as.action(api.identify.identify, {
        ...obsoleteArgs,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      }),
    ).toMatchObject({ scanId: obsolete.scanId, status: "pending" });
    expect(await t.run((ctx) => ctx.db.get("scans", obsolete.scanId))).toEqual(before);

    await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        descriptors: pair.ref,
        placement: { venueId, onView: true, source: "feed", confidence: 1 },
      }),
    );
    await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(await user.as.query(api.scans.get, { scanId: obsolete.scanId })).toMatchObject({
      status: "identified",
      outcome: "confident",
    });
  });

  it("keeps identification private for unattested devices even when attestation is required", async () => {
    vi.stubEnv("APP_ATTEST_REQUIRED", "true");
    const { t, args } = await fixture();
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    for (let i = 0; i < 2; i++) {
      const user = await signIn(t);
      await user.as.mutation(api.devices.registerDevice, { platform: "ios" });
      expect(
        await user.as.action(api.identify.identify, {
          ...args,
          venueId,
          visitId: undefined,
          scope: (await user.as.query(api.accounts.me, {})).scope,
        }),
      ).toMatchObject({ outcome: "confident" });
    }
    expect(await t.run((ctx) => ctx.db.query("placementProposals").collect())).toEqual([]);
  });

  it.each([
    { vector: [1] },
    { vector: Array(model.embeddingDim).fill(0) },
    { vector: [NaN, ...Array(model.embeddingDim - 1).fill(1)] },
  ])("rejects invalid vectors before creating a scan", async (invalid) => {
    const { t, user, args } = await fixture();
    await expect(
      user.as.action(api.identify.identify, {
        ...args,
        ...invalid,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      }),
    ).rejects.toMatchObject({ data: { code: "bad_vector" } });
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toEqual([]);
  });

  it.each([{ descriptors: new ArrayBuffer(1) }, { keypoints: new ArrayBuffer(1) }])(
    "maps malformed ORB buffers to bad_features before creating a scan",
    async (invalid) => {
      const { t, user, args } = await fixture();
      await expect(
        user.as.action(api.identify.identify, {
          ...args,
          ...invalid,
          scope: (await user.as.query(api.accounts.me, {})).scope,
        }),
      ).rejects.toMatchObject({ data: { code: "bad_features" } });
      expect(await t.run((ctx) => ctx.db.query("scans").collect())).toEqual([]);
    },
  );

  it("requires an authenticated, registered, unbanned device", async () => {
    const t = harness();
    await expect(t.action(api.identify.identify, { ...capture(), scope: "unused" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    const unregistered = await signIn(t);
    await expect(
      unregistered.as.action(api.identify.identify, {
        ...capture(),
        scope: "unused",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_registered" } });
    const user = await seedDevice(t);
    await t.run((ctx) => ctx.db.patch("devices", user.deviceId, { banned: true }));
    await expect(
      user.as.action(api.identify.identify, {
        ...capture(),
        scope: user.scope,
      }),
    ).rejects.toMatchObject({ data: { code: "device_banned" } });
  });

  it("refuses a foreign visit before search or writes", async () => {
    const { t, args } = await fixture();
    const other = await seedDevice(t);
    await expect(
      other.as.action(api.identify.identify, {
        ...args,
        scope: (await other.as.query(api.accounts.me, {})).scope,
      }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toEqual([]);
  });

  it("filters vector search only by model version, including equally similar vectors from other models", async () => {
    const { t, user, args } = await fixture(false);
    await t.run(async (ctx) => {
      for (let i = 0; i < 33; i++) {
        await seedArtworkWithObject(ctx, {
          modelVersion: "other-model",
          descriptors: pair.ref,
        });
      }
    });
    const result = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result).toMatchObject({
      status: "identified",
      outcome: "miss",
      runnerUps: [],
    });
    expect(result.best).toBeUndefined();
  });

  it("keeps a textured candidate soft when the query cannot verify it", async () => {
    const { t, user, args } = await fixture();
    const result = await user.as.action(api.identify.identify, {
      ...args,
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result.outcome).toBe("soft");
    expect(await storedCorners(t, result.scanId)).toBeUndefined();
  });

  it.each([0, 120])(
    "identifies a work with %s stored keypoints, storing corners only when verifiable",
    async (count) => {
      const { t, user, venueId, args } = await fixture(false);
      const work = await t.run(async (ctx) => {
        const work = await seedArtworkWithObject(ctx, {
          placement: { venueId, onView: true, source: "feed", confidence: 1 },
        });
        await ctx.db.insert("descriptors", {
          objectId: work.objectId,
          inputSize: model.inputSize,
          extractedFrom: "test reference",
          ...(await storeOrb(
            ctx,
            count === 0 ? new ArrayBuffer(0) : encodeOrbFeatures(pair.ref).descriptors,
            count === 0 ? new ArrayBuffer(0) : encodeOrbFeatures(pair.ref).keypoints,
          )),
        });
        return work;
      });
      const result = await user.as.action(api.identify.identify, {
        ...args,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      });
      expect(result).toMatchObject({
        status: "identified",
        outcome: "confident",
        best: { objectId: work.objectId },
      });
      expect((await storedCorners(t, result.scanId))?.length).toBe(count === 0 ? undefined : 4);
    },
  );

  it("returns the same stored result on retry even if the index has since changed", async () => {
    const { t, user, args, work } = await fixture();
    const first = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    await t.run((ctx) => ctx.db.delete("vectors", work!.vectorId));
    expect(
      await user.as.action(api.identify.identify, {
        ...args,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      }),
    ).toEqual(first);
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(1);
  });

  it("rejects the 21st identify call in a burst", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const { user, args } = await fixture(false);
    for (let i = 0; i < 20; i++) {
      await user.as.action(api.identify.identify, {
        ...args,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      });
    }
    await expect(
      user.as.action(api.identify.identify, {
        ...args,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      }),
    ).rejects.toMatchObject({
      data: { code: "rate_limited", name: "identify" },
    });
  });

  it.each(["unique", "multiple", "unknown"] as const)(
    "proposes a venue mismatch according to multiplicity (%s), deduplicating retries and devices",
    async (multiplicity) => {
      const { t, user, args, work } = await fixture();
      const otherVenue = await t.run((ctx) => seedMuseum(ctx));
      await t.run((ctx) => ctx.db.patch("artworks", work!.artworkId, { multiplicity }));
      const firstArgs = { ...args, venueId: otherVenue, visitId: undefined };
      const result = await user.as.action(api.identify.identify, {
        ...firstArgs,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      });
      expect(result.outcome).toBe("confident");
      const propose = async (as: typeof user.as, scanId: typeof result.scanId) => {
        const { nonce } = await as.mutation(api.devices.createChallenge, {
          purpose: "assert",
        });
        await as.mutation(api.identify.proposeFromScan, {
          scanId,
          nonce,
          assertionBase64: "AAAA",
        });
      };
      await propose(user.as, result.scanId);
      await user.as.action(api.identify.identify, {
        ...firstArgs,
        scope: (await user.as.query(api.accounts.me, {})).scope,
      });
      await propose(user.as, result.scanId);
      vi.setSystemTime(Date.now() + 1000);
      const another = await user.as.action(api.identify.identify, {
        ...firstArgs,
        localId: "another-capture",
        scope: (await user.as.query(api.accounts.me, {})).scope,
      });
      await propose(user.as, another.scanId);
      const before = await t.run((ctx) => ctx.db.query("placementProposals").collect());
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        kind: multiplicity === "unique" ? "move" : "new_object",
        readyForReview: false,
        deviceIds: [user.deviceId],
      });
      expect(before[0].scanIds).toHaveLength(2);
      const other = await seedDevice(t);
      const otherScan = await other.as.action(api.identify.identify, {
        ...firstArgs,
        scope: (await other.as.query(api.accounts.me, {})).scope,
      });
      await propose(other.as, otherScan.scanId);
      const proposal = await t.run((ctx) => ctx.db.get("placementProposals", before[0]._id));
      expect(proposal).toMatchObject({
        readyForReview: false,
        deviceIds: [user.deviceId, other.deviceId],
      });
      expect(proposal?.scanIds).toHaveLength(3);
    },
  );
});

describe("enrichment after identification", () => {
  const TOKEN_FACTORY = "https://api.tokenfactory.nebius.com/v1/chat/completions";
  const TAVILY = "https://api.tavily.com/search";
  const SOURCE = "https://www.metmuseum.org/art/collection/search/437127";

  function stubProviders() {
    vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubEnv("FACT_SHEET_MODEL", "super");
    vi.stubEnv("DOCENT_MODEL", "lightning");
    vi.stubEnv("FLAG_RIGHT_NOW", "on");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === TOKEN_FACTORY) {
        return completion(
          body.model === "super"
            ? [
                {
                  id: "f1",
                  text: "Claude Monet painted this canvas in 1916.",
                  sourceUrl: SOURCE,
                  sourceLabel: "x",
                  sourceScore: 1,
                },
              ]
            : [
                {
                  sentence: "Claude Monet painted these water lilies in 1916.",
                  fact_ids: ["f1"],
                },
              ],
        );
      }
      if (url === TAVILY && body.topic === "news") {
        return jsonResponse({
          answer:
            "Claude Monet’s “Water Lilies” returns to view at SFMOMA on 12 September 2026 with 40 companion works.",
          results: [
            {
              url: "https://www.sfmoma.org/press/monet-water-lilies-returns",
              title: "Monet’s Water Lilies returns",
              content:
                "Claude Monet’s “Water Lilies” returns to view at SFMOMA on 12 September 2026 with 40 companion works.",
              score: 0.82,
              published_date: new Date(FIXTURE_NOW - 24 * 60 * 60 * 1000).toUTCString(),
            },
          ],
          usage: { credits: 1 },
        });
      }
      if (url === TAVILY) {
        return jsonResponse({
          results: [
            {
              url: SOURCE,
              title: "Water Lilies",
              content: "Claude Monet painted this canvas in 1916.",
              score: 0.9,
            },
          ],
          usage: { credits: 1 },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return fetchMock;
  }

  it('schedules docent prose and "Right now" after a confident result without delaying the card', async () => {
    vi.useFakeTimers({ now: FIXTURE_NOW });
    const fetchMock = stubProviders();
    const { t, user, venueId, args, work } = await fixture();
    await t.run((ctx) => ctx.db.patch("museums", venueId, { region: "sf-bay-area" }));
    const result = await user.as.action(api.identify.identify, {
      ...args,
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result.outcome).toBe("confident");
    expect(result.docent).toBeUndefined();
    expect(result.rightNow).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get("artworks", work!.artworkId)))?.docent?.en).toEqual([
      {
        sentence: "Claude Monet painted these water lilies in 1916.",
        factIds: ["f1"],
      },
    ]);
    const display = await user.as.query(api.scans.get, {
      scanId: result.scanId,
    });
    expect(display?.docent).toEqual([
      {
        sentence: "Claude Monet painted these water lilies in 1916.",
        factIds: ["f1"],
      },
    ]);
    expect(display?.docentStatus).toBe("ready");
    expect(display?.factSheet).toEqual([{ id: "f1", sourceUrl: SOURCE, sourceLabel: "metmuseum.org" }]);
    expect(display?.rightNow).toEqual({
      text: "Claude Monet’s “Water Lilies” returns to view at SFMOMA on 12 September 2026 with 40 companion works.",
      sourceUrl: "https://www.sfmoma.org/press/monet-water-lilies-returns",
      sourceLabel: "sfmoma.org",
    });
    expect(await t.run((ctx) => ctx.db.query("dailySpend").collect())).toMatchObject([
      { tokenFactoryCalls: 2, tavilyCredits: 2 },
    ]);
  });

  it("schedules nothing for a soft result", async () => {
    vi.useFakeTimers({ now: FIXTURE_NOW });
    const fetchMock = stubProviders();
    const { t, user, args, work } = await fixture();
    const result = await user.as.action(api.identify.identify, {
      ...args,
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
      scope: (await user.as.query(api.accounts.me, {})).scope,
    });
    expect(result.outcome).toBe("soft");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get("artworks", work!.artworkId)))?.docent).toBeUndefined();
    const display = await user.as.query(api.scans.get, {
      scanId: result.scanId,
    });
    expect(display).not.toHaveProperty("docent");
    expect(display).not.toHaveProperty("factSheet");
  });
});

describe("candidate loading", () => {
  it("collapses merged objects and duplicate vectors using their maximum score", async () => {
    const t = harness();
    const { target, merged, second, duplicate } = await t.run(async (ctx) => {
      const target = await seedArtworkWithObject(ctx);
      const merged = await seedArtworkWithObject(ctx, {
        object: { mergedInto: target.objectId },
      });
      const second = await seedArtworkWithObject(ctx);
      const duplicate = await insertVector(ctx, {
        partition: JSON.stringify([model.modelVersion, "established"]),
        objectId: target.objectId,
        modelVersion: model.modelVersion,
        source: "user_scan",
        vector: Array(model.embeddingDim).fill(1),
      });
      return { target, merged, second, duplicate };
    });
    const candidates = await t.query(internal.identify.loadCandidates, {
      recordIds: [
        target.recordId,
        merged.recordId,
        second.recordId,
        searchRecordId((await t.run((ctx) => ctx.db.get("vectors", duplicate)))!),
      ],
      scores: [0.9, 0.99, 0.8, 0.95],
      now: Date.now(),
    });
    expect(candidates.map((c) => c.object._id)).toEqual([target.objectId, second.objectId]);
    expect(candidates[0]).toMatchObject({
      similarity: 0.99,
      runnerUpSimilarity: 0.8,
      keypointCount: null,
    });
    expect(candidates[1].runnerUpSimilarity).toBe(0.99);
  });

  it("excludes reverted objects, missing targets, and merge chains beyond one hop", async () => {
    const t = harness();
    const rows = await t.run(async (ctx) => {
      const reverted = await seedArtworkWithObject(ctx, {
        object: { reverted: true },
      });
      const toReverted = await seedArtworkWithObject(ctx, {
        object: { mergedInto: reverted.objectId },
      });
      const chain = await seedArtworkWithObject(ctx, {
        object: { mergedInto: toReverted.objectId },
      });
      const missing = await seedArtworkWithObject(ctx);
      await ctx.db.delete("objects", missing.objectId);
      return [reverted, toReverted, chain, missing];
    });
    expect(
      await t.query(internal.identify.loadCandidates, {
        recordIds: rows.map((r) => r.recordId),
        scores: rows.map(() => 0.99),
        now: Date.now(),
      }),
    ).toEqual([]);
  });

  it("loads at most 20 candidates with small ORB references and treats venue and rights as attributes", async () => {
    const t = harness();
    const pair = makeSyntheticPair({ count: 375, outlierFraction: 0 });
    const { venueId, rows } = await t.run(async (ctx) => {
      const venueId = await seedMuseum(ctx);
      const rows = [];
      for (let i = 0; i < 25; i++) {
        rows.push(
          await seedArtworkWithObject(ctx, {
            descriptors: pair.ref,
            artwork: { rightsStatus: "in_copyright" },
            placement: {
              venueId,
              gallery: "2",
              onView: false,
              source: "feed",
              confidence: 1,
            },
          }),
        );
      }
      return { venueId, rows };
    });
    const candidates = await t.query(internal.identify.loadCandidates, {
      recordIds: rows.map((r) => r.recordId),
      scores: rows.map((_, i) => 0.9 - i / 100),
      now: Date.now(),
      venueId: await t.run((ctx) => seedMuseum(ctx)),
    });
    expect(candidates).toHaveLength(20);
    expect(candidates[0]).toMatchObject({
      placement: { venueId, onView: false, gallery: "2" },
      institution: "Test Museum",
    });
    expect(candidates.every((c) => c.keypointCount === 375)).toBe(true);
    expect(candidates.every((c) => c.orbStorageId !== undefined)).toBe(true);
    expect(candidates[0]).not.toHaveProperty("descriptors");
    expect(candidates[0]).not.toHaveProperty("keypoints");
    expect(candidates.map((c) => c.object._id)).toEqual(rows.slice(0, 20).map((r) => r.objectId));
  });
});

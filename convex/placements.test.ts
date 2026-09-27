import type { FunctionArgs } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { runPipeline } from "./lib/identifyPipeline";
import { patchObjectDetails } from "./lib/objectDetails";
import { loadOrb } from "./lib/orbStorage";
import { loadCurrentPlacement } from "./lib/placements";
import { r2 } from "./lib/r2";
import {
  readTestOrb,
  readTestEmbedding,
  seedEmbedding,
  seedArtworkWithObject,
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
} from "./lib/testFactories";
import { readVector } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { proposePlacementFromScan, reviewPlacement } from "./placements";
import { harness } from "./test.helpers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-11T12:00:00Z");
const pair = makeSyntheticPair({ count: 120 });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture(multiplicity: Doc<"artworks">["multiplicity"] = "unique") {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const t = harness({ transactionLimits: true });
  const users = await Promise.all([seedDevice(t), seedDevice(t), seedDevice(t)]);
  const seeded = await t.run(async (ctx) => {
    const home = await seedMuseum(ctx);
    const venueId = await seedMuseum(ctx);
    const work = await seedArtworkWithObject(ctx, {
      descriptors: pair.ref,
      artwork: { multiplicity },
      placement: { venueId: home, source: "feed", onView: true, confidence: 1 },
    });
    const savedId = await ctx.db.insert("collections", {
      owner: { kind: "device", deviceId: users[0].deviceId },
      changeVersion: 1,
      localId: "saved",
      savedAt: NOW,
      venueId: home,
      updatedAt: NOW,
      updatedBy: users[0].deviceId,
      objectId: work.objectId,
      artworkId: work.artworkId,
      snapshot: {
        title: "My saved title",
        artist: "My saved artist",
        institution: "Original venue",
      },
    });
    return { home, venueId, savedId, ...work };
  });
  const propose = async (deviceIndex: number, now = NOW) => {
    vi.mocked(Date.now).mockReturnValue(now);
    return t.run(async (ctx) => {
      const scanId = await seedScan(ctx, {
        deviceId: users[deviceIndex].deviceId,
        venueId: seeded.venueId,
        outcome: "confident",
        best: {
          identityStatus: "established" as const,
          objectId: seeded.objectId,
          artworkId: seeded.artworkId,
          probability: 0.98,
        },
        vector: testVector(1 - deviceIndex / 10),
      });
      await proposePlacementFromScan(ctx, {
        scan: (await ctx.db.get("scans", scanId))!,
        objectId: seeded.objectId,
        proposedVenueId: seeded.venueId,
        deviceId: users[deviceIndex].deviceId,
      });
      return scanId;
    });
  };
  const proposal = () => t.run((ctx) => ctx.db.query("placementProposals").unique());
  const ready = async () => {
    await propose(0);
    await propose(1, NOW + DAY);
    return (await proposal())!;
  };
  return { t, users, ...seeded, propose, proposal, ready };
}

it("approves a new copy using its scan archives without external IO", async () => {
  const { t, ready } = await fixture("multiple");
  const pending = await ready();
  const archiveIds = await t.run(async (ctx) =>
    Promise.all(
      pending.scanIds.map(async (id) => {
        const scan = (await ctx.db.get("scans", id))!;
        return (await ctx.db.get("scanEmbeddings", scan.embeddingId!))!.archiveId;
      }),
    ),
  );
  await vi.mocked(r2.put).withImplementation(
    async () => {
      throw new Error("Unexpected R2 upload");
    },
    async () => {
      await t.action(internal.placements.reviewPlacement, {
        proposalId: pending._id,
        decision: "approve",
        reviewer: "curator",
      });
    },
  );
  const vectors = await t.run((ctx) => ctx.db.query("vectors").collect());
  expect(vectors.filter((row) => row.proposalId === pending._id).map((row) => row.archiveId)).toEqual(archiveIds);
});

it("reports unexpected review failures from the action without exposing review details", async () => {
  const { t, ready } = await fixture();
  const pending = await ready();
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const failure = new Error("private review details");
  try {
    await expect(
      t.action(async (ctx) => {
        vi.spyOn(ctx, "runMutation").mockRejectedValueOnce(failure);
        const handler = (
          reviewPlacement as unknown as {
            _handler: (ctx: ActionCtx, args: FunctionArgs<typeof internal.placements.reviewPlacement>) => Promise<null>;
          }
        )._handler;
        return handler(ctx, {
          proposalId: pending._id,
          decision: "approve",
          reviewer: "private reviewer",
        });
      }),
    ).rejects.toThrow("private review details");
    expect(fetch).toHaveBeenCalledTimes(1);
    const envelope = String(fetch.mock.calls[0][1]?.body);
    expect(envelope).toContain("placements.reviewPlacement");
    expect(envelope).not.toContain("private review");
    expect(await t.run((ctx) => ctx.db.get("placementProposals", pending._id))).toMatchObject({ status: "pending" });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("needs two devices over at least a day or three distinct devices; elapsed time alone is insufficient", async () => {
  const { t, propose, proposal, users } = await fixture();
  await propose(0);
  await propose(0, NOW + 2 * DAY);
  expect(await proposal()).toMatchObject({
    readyForReview: false,
    deviceIds: [users[0].deviceId],
  });
  await propose(1, NOW + 2 * DAY);
  expect(await proposal()).toMatchObject({
    readyForReview: true,
    firstSeenAt: NOW,
    lastSeenAt: NOW + 2 * DAY,
  });
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toHaveLength(1);
});

it("does not make two immediate devices ready and accepts a third without a day’s delay", async () => {
  const { propose, proposal } = await fixture();
  await propose(0);
  await propose(1, NOW + DAY - 1);
  expect(await proposal()).toMatchObject({ readyForReview: false });
  await propose(2, NOW + DAY - 1);
  expect(await proposal()).toMatchObject({ readyForReview: true });
});

it("a replay cannot manufacture the second day of evidence", async () => {
  const { t, users, propose, proposal, objectId, venueId } = await fixture();
  const scanId = await propose(0);
  await propose(1);
  const before = await proposal();
  vi.mocked(Date.now).mockReturnValue(NOW + DAY);
  await t.run(async (ctx) =>
    proposePlacementFromScan(ctx, {
      scan: (await ctx.db.get("scans", scanId))!,
      deviceId: users[0].deviceId,
      objectId,
      proposedVenueId: venueId,
    }),
  );
  expect(await proposal()).toEqual(before);
});

it("approval requires readiness, while a human may reject weak evidence", async () => {
  const { t, propose, proposal } = await fixture();
  await propose(0);
  const proposalId = (await proposal())!._id;
  await expect(
    t.action(internal.placements.reviewPlacement, {
      proposalId,
      decision: "approve",
      reviewer: "curator",
    }),
  ).rejects.toMatchObject({ data: { code: "proposal_not_ready" } });
  await t.action(internal.placements.reviewPlacement, {
    proposalId,
    decision: "reject",
    reviewer: "curator",
  });
  expect(await proposal()).toMatchObject({
    status: "rejected",
    readyForReview: false,
    reviewer: "curator",
    reviewedAt: NOW,
  });
  expect(await t.run((ctx) => ctx.db.query("placements").collect())).toHaveLength(1);
});

it("approving a move closes active placements elsewhere and preserves ownership, future windows, and saved snapshots", async () => {
  const { t, ready, objectId, venueId, home, savedId } = await fixture();
  const before = await t.run((ctx) => ctx.db.get("collections", savedId));
  const futureId = await t.run((ctx) =>
    ctx.db.insert("placements", {
      identityStatus: "established",
      objectId,
      venueId: home,
      source: "checklist",
      confidence: 0.85,
      onView: true,
      from: NOW + 10 * DAY,
    }),
  );
  const p = await ready();
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "approve",
    reviewer: "curator",
  });
  const rows = await t.run((ctx) => ctx.db.query("placements").collect());
  expect(rows).toHaveLength(3);
  expect(rows[0].closedAt).toBe(NOW + DAY);
  expect(rows[2]).toMatchObject({
    objectId,
    venueId,
    source: "proposal",
    confidence: 0.7,
    onView: true,
    from: NOW + DAY,
  });
  expect(await t.run((ctx) => ctx.db.get("placements", futureId))).not.toHaveProperty("closedAt");
  expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
    ownerId: home,
  });
  expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(before);
  expect(
    await t.query(internal.identify.loadCandidates, {
      recordIds: [searchRecordId((await t.run((ctx) => ctx.db.query("vectors").first()))!)],
      scores: [1],
      now: NOW + DAY,
    }),
  ).toMatchObject([{ placement: { venueId } }]);
});

it.each(["multiple", "unknown"] as const)(
  "approving %s creates a physical object with its own scan vectors and leaves the original intact",
  async (multiplicity) => {
    const { t, ready, objectId, artworkId, home, venueId, users, savedId } = await fixture(multiplicity);
    const before = await t.run((ctx) => ctx.db.get("collections", savedId));
    const p = await ready();
    expect(p.kind).toBe("new_object");
    await t.action(internal.placements.reviewPlacement, {
      proposalId: p._id,
      decision: "approve",
      reviewer: "curator",
    });
    const created = await t.run((ctx) =>
      ctx.db
        .query("objects")
        .withIndex("by_key", (q) => q.eq("key", `user:proposal:${p._id}`))
        .unique(),
    );
    expect(created).toMatchObject({
      artworkId,
      ownerId: venueId,
      source: "user",
      sourceId: p._id,
      reverted: false,
      confirmCount: 0,
      rejectCount: 0,
      calibratorPenalty: 0,
      provenance: {
        contributionIds: [],
        deviceIds: [users[0].deviceId, users[1].deviceId],
      },
    });
    const vectors = await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", created!._id))
        .collect(),
    );
    expect(
      await t.run(async (ctx) =>
        Promise.all(
          vectors.map(async (row) => ({
            source: row.source,
            vector: await readVector(ctx, row),
            modelVersion: row.modelVersion,
          })),
        ),
      ),
    ).toEqual([
      {
        source: "user_scan",
        vector: testVector(),
        modelVersion: model.modelVersion,
      },
      {
        source: "user_scan",
        vector: testVector(0.9),
        modelVersion: model.modelVersion,
      },
    ]);
    const candidates = await t.query(internal.identify.loadCandidates, {
      recordIds: [searchRecordId(vectors[0])],
      scores: [0.99],
      now: NOW + DAY,
    });
    const reference = await t.run((ctx) => readTestOrb(ctx, objectId));
    expect(candidates[0].orbStorageId).toBe(reference!.storageId);
    const hydrated = await t.run(async (ctx) =>
      Promise.all(
        candidates.map(async (candidate) => ({
          ...candidate,
          ...(await loadOrb(ctx, candidate.orbStorageId!, candidate.keypointCount!)),
        })),
      ),
    );
    expect(
      runPipeline({
        candidates: hydrated,
        query: pair.query,
        venueId,
        now: NOW + DAY,
        inputSize: model.inputSize,
      }).decision.outcome,
    ).toBe("confident");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("placements")
          .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
          .unique(),
      ),
    ).toMatchObject({ venueId: home, source: "feed" });
    expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(before);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({
      objects: 1,
      placements: 1,
      vectors: 2,
    });
  },
);

it.each(["row", "file"])("refuses to index a new physical object without its reference %s", async (missing) => {
  const { t, ready, objectId } = await fixture("multiple");
  const p = await ready();
  await t.run(async (ctx) => {
    const reference = (await readTestOrb(ctx, objectId))!;
    if (missing === "row") await patchObjectDetails(ctx, { _id: objectId }, { orb: undefined });
    else await ctx.db.patch("files", reference.storageId, { state: "deleting" });
  });
  await expect(
    t.action(internal.placements.reviewPlacement, {
      proposalId: p._id,
      decision: "approve",
      reviewer: "curator",
    }),
  ).rejects.toMatchObject({
    data: { code: "reference_descriptors_required" },
  });
  expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(1);
});

it("uses recorded scan times for delayed and out-of-order proposal submissions", async () => {
  const { t, propose, proposal, users, objectId, artworkId, venueId } = await fixture();
  await propose(0);
  const delayed = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: users[1].deviceId,
      venueId,
      outcome: "confident",
      best: {
        identityStatus: "established" as const,
        objectId,
        artworkId,
        probability: 0.98,
      },
      capturedAt: NOW + 10 * DAY,
    }),
  );
  vi.mocked(Date.now).mockReturnValue(NOW + DAY);
  await t.run(async (ctx) =>
    proposePlacementFromScan(ctx, {
      scan: (await ctx.db.get("scans", delayed))!,
      deviceId: users[1].deviceId,
      objectId,
      proposedVenueId: venueId,
    }),
  );
  const p = (await proposal())!;
  expect(p).toMatchObject({
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    readyForReview: false,
  });
  // Review recomputes the interval even if the stored summary is wrong.
  await t.run((ctx) => ctx.db.patch("placementProposals", p._id, { firstSeenAt: NOW - DAY, readyForReview: true }));
  await expect(
    t.action(internal.placements.reviewPlacement, {
      proposalId: p._id,
      decision: "approve",
      reviewer: "curator",
    }),
  ).rejects.toMatchObject({ data: { code: "proposal_not_ready" } });
});

it("retains both ends of the observation window when the older scan arrives last", async () => {
  const { t, propose, proposal, users, objectId, artworkId, venueId } = await fixture();
  const older = await t.run((ctx) =>
    seedScan(ctx, {
      deviceId: users[0].deviceId,
      venueId,
      outcome: "confident",
      best: {
        identityStatus: "established" as const,
        objectId,
        artworkId,
        probability: 0.98,
      },
    }),
  );
  await propose(1, NOW + DAY);
  await t.run(async (ctx) =>
    proposePlacementFromScan(ctx, {
      scan: (await ctx.db.get("scans", older))!,
      deviceId: users[0].deviceId,
      objectId,
      proposedVenueId: venueId,
    }),
  );
  expect(await proposal()).toMatchObject({
    firstSeenAt: NOW,
    lastSeenAt: NOW + DAY,
    readyForReview: true,
  });
});

it("keeps approval within transaction limits after 2100 repeat scans", async () => {
  const { t, propose, proposal, users, objectId, artworkId, venueId } = await fixture("multiple");
  for (let start = 0; start < 2100; start += 25) {
    await t.run(async (ctx) => {
      for (let i = start; i < start + 25; i++) {
        const scanId = await seedScan(ctx, {
          deviceId: users[0].deviceId,
          venueId,
          outcome: "confident",
          createdAt: NOW + i,
          best: {
            identityStatus: "established" as const,
            objectId,
            artworkId,
            probability: 0.98,
          },
        });
        await proposePlacementFromScan(ctx, {
          scan: (await ctx.db.get("scans", scanId))!,
          deviceId: users[0].deviceId,
          objectId,
          proposedVenueId: venueId,
        });
      }
    });
  }
  expect((await proposal())!.scanIds.length).toBeLessThanOrEqual(6);
  await propose(1, NOW + DAY);
  const ready = (await proposal())!;
  await propose(2, NOW + 2 * DAY);
  expect(await proposal()).toEqual(ready);
  await t.action(internal.placements.reviewPlacement, {
    proposalId: ready._id,
    decision: "approve",
    reviewer: "curator",
  });
  expect((await proposal())!.status).toBe("promoted");
}, 20000);

it("device reversion restores the home placement without changing the saved snapshot", async () => {
  vi.useFakeTimers();
  const { t, ready, users, objectId, home, savedId } = await fixture();
  const before = await t.run((ctx) => ctx.db.get("collections", savedId));
  const p = await ready();
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "approve",
    reviewer: "curator",
  });
  await t.mutation(internal.revert.revertDevice, {
    deviceId: users[0].deviceId,
    reason: "fraudulent evidence",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
    venueId: home,
  });
  expect(await t.run((ctx) => ctx.db.get("placementProposals", p._id))).toMatchObject({
    status: "promoted",
    revertedAt: expect.any(Number),
  });
  expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(before);
});

it.each(["device", "venue"] as const)(
  "reverting an earlier move via $0 preserves a later move and its rollback restores home",
  async (cause) => {
    vi.useFakeTimers();
    const { t, ready, users, objectId, artworkId, home } = await fixture();
    const first = await ready();
    await t.action(internal.placements.reviewPlacement, {
      proposalId: first._id,
      decision: "approve",
      reviewer: "curator",
    });
    const clean = await Promise.all([seedDevice(t), seedDevice(t), seedDevice(t)]);
    const nextVenue = await t.run((ctx) => seedMuseum(ctx));
    for (const device of clean) {
      await t.run(async (ctx) => {
        const scanId = await seedScan(ctx, {
          deviceId: device.deviceId,
          venueId: nextVenue,
          outcome: "confident",
          best: {
            identityStatus: "established" as const,
            objectId,
            artworkId,
            probability: 0.98,
          },
        });
        await proposePlacementFromScan(ctx, {
          scan: (await ctx.db.get("scans", scanId))!,
          deviceId: device.deviceId,
          objectId,
          proposedVenueId: nextVenue,
        });
      });
    }
    const second = (await t.run((ctx) =>
      ctx.db
        .query("placementProposals")
        .withIndex("by_object_venue", (q) => q.eq("objectId", objectId).eq("proposedVenueId", nextVenue))
        .unique(),
    ))!;
    await t.action(internal.placements.reviewPlacement, {
      proposalId: second._id,
      decision: "approve",
      reviewer: "curator",
    });
    if (cause === "device") {
      await t.mutation(internal.revert.revertDevice, {
        deviceId: users[0].deviceId,
        reason: "fraudulent evidence",
      });
    } else {
      await t.mutation(internal.revert.applyOptOut, {
        venueId: first.proposedVenueId,
        requester: "museum",
      });
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
      venueId: nextVenue,
    });
    await t.mutation(internal.revert.revertDevice, {
      deviceId: clean[0].deviceId,
      reason: "fraudulent evidence",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
      venueId: home,
    });
  },
);

it.each([
  { source: "wikidata", expiredHome: false },
  { source: "feed", expiredHome: false },
  { source: "feed", expiredHome: true },
] as const)(
  "rollback preserves a temporary checklist and the home window ($source, expired: $expiredHome)",
  async ({ source, expiredHome }) => {
    vi.useFakeTimers();
    const { t, ready, users, objectId, home, savedId } = await fixture();
    const saved = await t.run((ctx) => ctx.db.get("collections", savedId));
    const temporaryVenue = await t.run(async (ctx) => {
      const homePlacement = (await ctx.db
        .query("placements")
        .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
        .unique())!;
      await ctx.db.patch("placements", homePlacement._id, {
        source,
        to: expiredHome ? NOW + 2 * DAY : undefined,
      });
      return seedMuseum(ctx, {
        key: "temporary-exhibition",
        lat: 37.78,
        lng: -122.4,
      });
    });
    const p = await ready();
    await t.action(internal.placements.reviewPlacement, {
      proposalId: p._id,
      decision: "approve",
      reviewer: "curator",
    });
    const object = (await t.run((ctx) => ctx.db.get("objects", objectId)))!;
    await t.mutation(internal.checklists.ingestChecklist, {
      venueKey: "temporary-exhibition",
      works: [{ objectKey: object.key }],
      exhibition: {
        title: "Loan",
        from: "2026-09-12",
        to: "2026-09-14",
        sourceUrl: "https://museum.example/checklist",
      },
    });
    await t.mutation(internal.revert.revertDevice, {
      deviceId: users[0].deviceId,
      reason: "fraudulent evidence",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const end = Date.parse("2026-09-15T06:59:59.999Z");
    for (const now of [NOW + DAY, end]) {
      expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, now))).toMatchObject({
        venueId: temporaryVenue,
      });
    }
    const after = await t.run((ctx) => loadCurrentPlacement(ctx, objectId, end + 1));
    expect(after?.venueId ?? null).toBe(expiredHome ? null : home);
    expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(saved);
  },
);

it("venue opt-out undoes a corpus-object move while preserving the corpus and saved snapshot", async () => {
  vi.useFakeTimers();
  const { t, ready, objectId, home, venueId, savedId } = await fixture();
  const saved = await t.run((ctx) => ctx.db.get("collections", savedId));
  const p = await ready();
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "approve",
    reviewer: "curator",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const optOutId = await t.mutation(internal.revert.applyOptOut, {
      venueId,
      requester: "museum",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("optOuts", optOutId))).toHaveProperty("appliedAt");
    expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
      venueId: home,
    });
  }
  expect(await t.run((ctx) => ctx.db.get("placementProposals", p._id))).toMatchObject({
    status: "promoted",
    revertedAt: expect.any(Number),
  });
  expect(await t.run((ctx) => ctx.db.get("objects", objectId))).toMatchObject({
    source: "corpus",
    reverted: false,
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", objectId))
        .collect(),
    ),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(saved);
});

it("venue opt-out rolls back every move across placement pages", async () => {
  vi.useFakeTimers();
  const { t, ready, home, venueId } = await fixture();
  const evidence = await ready();
  const moved = await t.run(async (ctx) => {
    const rows = [];
    for (let i = 0; i < 26; i++) {
      const { objectId } = await seedArtworkWithObject(ctx, {
        placement: {
          venueId: home,
          source: "feed",
          onView: true,
          confidence: 1,
        },
      });
      const previous = (await ctx.db
        .query("placements")
        .withIndex("by_objectId", (q) => q.eq("objectId", objectId))
        .unique())!;
      const { _id, _creationTime, ...fields } = evidence;
      const proposalId = await ctx.db.insert("placementProposals", {
        ...fields,
        objectId,
        status: "promoted",
        readyForReview: false,
      });
      const placementId = await ctx.db.insert("placements", {
        identityStatus: "established",
        objectId,
        venueId,
        source: "proposal",
        onView: true,
        confidence: 0.7,
        from: NOW + DAY,
        proposalId,
      });
      await ctx.db.patch("placements", previous._id, {
        closedAt: NOW + DAY,
        closedByProposalId: proposalId,
      });
      await ctx.db.patch("placementProposals", proposalId, {
        promotion: { placementId, closedPlacementIds: [previous._id] },
      });
      rows.push({ objectId, proposalId });
    }
    return rows;
  });
  const optOutId = await t.mutation(internal.revert.applyOptOut, {
    venueId,
    requester: "museum",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get("optOuts", optOutId))).toHaveProperty("appliedAt");
  for (const { objectId, proposalId } of moved) {
    expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
      venueId: home,
    });
    expect(await t.run((ctx) => ctx.db.get("placementProposals", proposalId))).toHaveProperty("revertedAt");
  }
});

it("device reversion preserves a subsequent feed update and closes the revoked move", async () => {
  vi.useFakeTimers();
  const { t, ready, users, objectId, savedId } = await fixture();
  const saved = await t.run((ctx) => ctx.db.get("collections", savedId));
  const p = await ready();
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "approve",
    reviewer: "curator",
  });
  const later = await t.run(async (ctx) => ({
    venueId: await seedMuseum(ctx, { key: "later-feed-venue" }),
    object: (await ctx.db.get("objects", objectId))!,
  }));
  await t.mutation(internal.ingest.upsertPlacements, {
    rows: [
      {
        objectKey: later.object.key,
        venueKey: "later-feed-venue",
        source: "feed",
        confidence: 0.9,
        onView: true,
      },
    ],
  });
  expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
    venueId: later.venueId,
  });
  await t.mutation(internal.revert.revertDevice, {
    deviceId: users[0].deviceId,
    reason: "fraudulent evidence",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => loadCurrentPlacement(ctx, objectId, NOW + DAY))).toMatchObject({
    venueId: later.venueId,
  });
  const revoked = (await t.run((ctx) => ctx.db.get("placementProposals", p._id)))!;
  expect(revoked.revertedAt).toEqual(expect.any(Number));
  expect(await t.run((ctx) => ctx.db.get("placements", revoked.promotion!.placementId))).toHaveProperty("closedAt");
  expect(await t.run((ctx) => ctx.db.get("collections", savedId))).toEqual(saved);
});

it("replaces a rejected scan with fresh independent evidence in a ready pending proposal", async () => {
  const { t, users, propose, proposal, objectId } = await fixture();
  for (let i = 0; i < 3; i++) await propose(i);
  const p = (await proposal())!;
  await t.run(async (ctx) => {
    const scan = (await ctx.db.get("scans", p.scanIds[0]))!;
    await ctx.db.insert("feedback", {
      scanId: scan._id,
      deviceId: scan.deviceId,
      venueId: scan.venueId,
      embeddingId: await seedEmbedding(ctx, {
        vector: await readTestEmbedding(ctx, scan.embeddingId),
      }),
      modelVersion: scan.modelVersion,
      rejectedObjectId: objectId,
      score: 0.9,
      margin: 0.1,
      orbInliers: 100,
      probability: 0.98,
      calibratorVersion: "test",
      venueMismatch: true,
      penaltyAdded: 0,
      resolution: { kind: "unresolved" },
      createdAt: NOW,
    });
  });
  const args = {
    proposalId: p._id,
    decision: "approve" as const,
    reviewer: "curator",
  };
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "invalid_proposal_evidence" },
  });
  users.push(await seedDevice(t));
  const fresh = await propose(3);
  expect(await proposal()).toMatchObject({
    status: "pending",
    readyForReview: true,
    scanIds: [...p.scanIds.slice(1), fresh],
    deviceIds: users.slice(1).map((user) => user.deviceId),
  });
  await t.action(internal.placements.reviewPlacement, args);
  expect(await proposal()).toMatchObject({ status: "promoted" });
});

it("replaces copy evidence whose stored vector expired with a fresh scan", async () => {
  const { t, users, propose, proposal } = await fixture("multiple");
  for (let i = 0; i < 3; i++) await propose(i);
  const p = (await proposal())!;
  await t.run(async (ctx) => ctx.db.delete("scanEmbeddings", (await ctx.db.get("scans", p.scanIds[0]))!.embeddingId!));
  const args = {
    proposalId: p._id,
    decision: "approve" as const,
    reviewer: "curator",
  };
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "invalid_proposal_evidence" },
  });
  users.push(await seedDevice(t));
  const fresh = await propose(3);
  expect(await proposal()).toMatchObject({
    readyForReview: true,
    scanIds: [...p.scanIds.slice(1), fresh],
  });
  await t.action(internal.placements.reviewPlacement, args);
  expect(await proposal()).toMatchObject({ status: "promoted" });
});

it("keeps a promoted copy when its evidence vectors expire", async () => {
  vi.useFakeTimers();
  const { t, users, propose, proposal } = await fixture("multiple");
  await propose(0);
  await propose(1);
  await propose(2, NOW + DAY);
  const p = (await proposal())!;
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "approve",
    reviewer: "curator",
  });
  await t.run(async (ctx) => {
    for (const scanId of p.scanIds) {
      await ctx.db.delete("scanEmbeddings", (await ctx.db.get("scans", scanId))!.embeddingId!);
    }
  });
  await t.mutation(internal.revert.revertDevice, { deviceId: users[1].deviceId, reason: "abuse" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const promoted = (await proposal())!;
  expect(promoted).not.toHaveProperty("revertedAt");
  const placement = (await t.run((ctx) => ctx.db.get("placements", promoted.promotion!.placementId)))!;
  expect(await t.run((ctx) => ctx.db.get("objects", placement.objectId))).toMatchObject({ reverted: false });
});

it("recomputes the agreement window after removing missing evidence and can become ready again", async () => {
  const { t, ready, propose, proposal } = await fixture();
  const p = await ready();
  await t.run((ctx) => ctx.db.delete("scans", p.scanIds[0]));
  await propose(2, NOW + DAY);
  expect(await proposal()).toMatchObject({
    readyForReview: false,
    firstSeenAt: NOW + DAY,
    lastSeenAt: NOW + DAY,
  });
  const args = {
    proposalId: p._id,
    decision: "approve" as const,
    reviewer: "curator",
  };
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "proposal_not_ready" },
  });
  await propose(2, NOW + 2 * DAY);
  expect(await proposal()).toMatchObject({
    readyForReview: true,
    firstSeenAt: NOW + DAY,
    lastSeenAt: NOW + 2 * DAY,
  });
  await t.action(internal.placements.reviewPlacement, args);
  expect(await proposal()).toMatchObject({ status: "promoted" });
});

it.each(["approve", "reject"] as const)(
  "review retries are idempotent and later evidence cannot reopen a %s decision",
  async (decision) => {
    const { t, ready, propose, proposal } = await fixture("multiple");
    const p = await ready();
    const args = { proposalId: p._id, decision, reviewer: "curator" };
    await t.action(internal.placements.reviewPlacement, args);
    const before = await proposal();
    await t.action(internal.placements.reviewPlacement, args);
    await propose(2, NOW + 2 * DAY);
    expect(await proposal()).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(decision === "approve" ? 2 : 1);
    await expect(
      t.action(internal.placements.reviewPlacement, {
        ...args,
        decision: decision === "approve" ? "reject" : "approve",
      }),
    ).rejects.toMatchObject({ data: { code: "proposal_already_reviewed" } });
  },
);

it("refuses approval when an evidence device is banned or the object has been reverted", async () => {
  const { t, ready, users, objectId } = await fixture();
  const p = await ready();
  const args = {
    proposalId: p._id,
    decision: "approve" as const,
    reviewer: "curator",
  };
  await t.run((ctx) => ctx.db.patch("devices", users[0].deviceId, { banned: true }));
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "invalid_proposal_evidence" },
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("devices", users[0].deviceId, { banned: false });
    await ctx.db.patch("objects", objectId, { reverted: true });
  });
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "object_not_found" },
  });
});

it("lists proposals by status with pagination and supports the existing ready queue", async () => {
  const { t, ready } = await fixture();
  const p = await ready();
  const first = await t.query(internal.placements.listProposals, {
    status: "pending",
  });
  expect(first).toMatchObject({ rows: [{ _id: p._id }], cursor: null });
  expect(await t.query(internal.review.listProposalsReady, {})).toMatchObject([{ _id: p._id }]);
  await t.action(internal.placements.reviewPlacement, {
    proposalId: p._id,
    decision: "reject",
    reviewer: "curator",
  });
  expect(await t.query(internal.placements.listProposals, { status: "pending" })).toEqual({
    rows: [],
    cursor: null,
  });
  expect(await t.query(internal.placements.listProposals, { status: "rejected" })).toMatchObject({
    rows: [{ _id: p._id }],
  });
});

it("refuses stale evidence and rolls back approval if a scan no longer identifies the work", async () => {
  const { t, ready } = await fixture("multiple");
  const p = await ready();
  await t.run((ctx) => ctx.db.patch("scans", p.scanIds[0], { outcome: "miss", best: undefined }));
  await expect(
    t.action(internal.placements.reviewPlacement, {
      proposalId: p._id,
      decision: "approve",
      reviewer: "curator",
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_proposal_evidence" } });
  expect(await t.run((ctx) => ctx.db.query("objects").collect())).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.get("placementProposals", p._id))).toMatchObject({
    status: "pending",
  });
});

it("approves valid runner-up resolutions and refuses them after the resolution is withdrawn", async () => {
  const { t, ready, objectId } = await fixture("multiple");
  const p = await ready();
  const feedbackIds = await t.run(async (ctx) => {
    const rejected = await seedArtworkWithObject(ctx);
    const ids = [];
    for (const scanId of p.scanIds) {
      const scan = (await ctx.db.get("scans", scanId))!;
      await ctx.db.patch("scans", scanId, {
        best: {
          identityStatus: "established" as const,
          objectId: rejected.objectId,
          artworkId: rejected.artworkId,
          probability: 0.9,
        },
      });
      ids.push(
        await ctx.db.insert("feedback", {
          scanId,
          deviceId: scan.deviceId,
          venueId: scan.venueId,
          embeddingId: await seedEmbedding(ctx, {
            vector: await readTestEmbedding(ctx, scan.embeddingId),
          }),
          modelVersion: scan.modelVersion,
          rejectedObjectId: rejected.objectId,
          score: 0.9,
          margin: 0.1,
          orbInliers: 10,
          probability: 0.9,
          calibratorVersion: "test",
          venueMismatch: true,
          penaltyAdded: 0,
          resolution: { kind: "runner_up", objectId },
          createdAt: NOW,
        }),
      );
    }
    return ids;
  });
  await t.run((ctx) => ctx.db.patch("feedback", feedbackIds[0], { resolution: { kind: "unresolved" } }));
  const args = {
    proposalId: p._id,
    decision: "approve" as const,
    reviewer: "curator",
  };
  await expect(t.action(internal.placements.reviewPlacement, args)).rejects.toMatchObject({
    data: { code: "invalid_proposal_evidence" },
  });
  await t.run((ctx) =>
    ctx.db.patch("feedback", feedbackIds[0], {
      resolution: { kind: "runner_up", objectId },
    }),
  );
  await t.action(internal.placements.reviewPlacement, args);
  expect(await t.run((ctx) => ctx.db.get("placementProposals", p._id))).toMatchObject({
    status: "promoted",
  });
});

it("pages through a full review queue without skipping rows", async () => {
  const { t, ready } = await fixture();
  const p = await ready();
  await t.run(async (ctx) => {
    for (let i = 0; i < 100; i++) {
      await ctx.db.insert("placementProposals", {
        objectId: p.objectId,
        proposedVenueId: p.proposedVenueId,
        kind: p.kind,
        deviceIds: p.deviceIds,
        scanIds: p.scanIds,
        firstSeenAt: p.firstSeenAt,
        lastSeenAt: p.lastSeenAt,
        status: "pending",
        readyForReview: true,
      });
    }
  });
  const first = await t.query(internal.placements.listProposals, {
    status: "pending",
  });
  expect(first.rows).toHaveLength(100);
  expect(first.cursor).not.toBeNull();
  const last = await t.query(internal.placements.listProposals, {
    status: "pending",
    cursor: first.cursor,
  });
  expect(last.rows).toHaveLength(1);
  expect(last.cursor).toBeNull();
  expect(new Set([...first.rows, ...last.rows].map((row) => row._id)).size).toBe(101);
});

it.each(["unique", "multiple"] as const)(
  "retains a reviewed %s decision when the surviving evidence still qualifies",
  async (multiplicity) => {
    vi.useFakeTimers();
    const { t, users, propose, proposal, venueId } = await fixture(multiplicity);
    await propose(0);
    await propose(1);
    await propose(2, NOW + DAY);
    const row = (await proposal())!;
    await t.action(internal.placements.reviewPlacement, {
      proposalId: row._id,
      decision: "approve",
      reviewer: "curator",
    });
    const approved = (await proposal())!;
    await t.mutation(internal.revert.revertDevice, {
      deviceId: users[0].deviceId,
      reason: "abuse",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const surviving = (await proposal())!;
    expect(surviving).toMatchObject({
      status: "promoted",
      deviceIds: [users[1].deviceId, users[2].deviceId],
    });
    expect(surviving.revertedAt).toBeUndefined();
    const placement = (await t.run((ctx) => ctx.db.get("placements", approved.promotion!.placementId)))!;
    expect(placement.closedAt).toBeUndefined();
    expect(placement.identityStatus).toBe("established");
    expect(await t.run((ctx) => loadCurrentPlacement(ctx, placement.objectId, NOW + DAY))).toMatchObject({ venueId });
  },
);

it("reverses a reviewed new object when surviving evidence no longer qualifies", async () => {
  vi.useFakeTimers();
  const { t, ready, users } = await fixture("multiple");
  const row = await ready();
  await t.action(internal.placements.reviewPlacement, {
    proposalId: row._id,
    decision: "approve",
    reviewer: "curator",
  });
  const approved = (await t.run((ctx) => ctx.db.get("placementProposals", row._id)))!;
  const placement = (await t.run((ctx) => ctx.db.get("placements", approved.promotion!.placementId)))!;
  await t.mutation(internal.revert.revertDevice, {
    deviceId: users[0].deviceId,
    reason: "abuse",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get("placementProposals", row._id))).toHaveProperty("revertedAt");
  expect(await t.run((ctx) => ctx.db.get("objects", placement.objectId))).toMatchObject({
    reverted: true,
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("vectors")
        .withIndex("by_objectId_modelVersion_source", (q) => q.eq("objectId", placement.objectId))
        .collect(),
    ),
  ).toEqual([]);
});

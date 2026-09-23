import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  seedArtworkWithObject,
  seedContribution,
  seedDevice,
  seedMuseum,
  seedScan,
} from "./lib/testFactories";
import { harness } from "./test.helpers";

const factSheet = [
  {
    id: "f1",
    text: "Painted in 1916.",
    sourceUrl: "https://museum.example/work",
    sourceLabel: "Museum",
    sourceScore: 1,
  },
];

async function fixture() {
  const t = harness({ transactionLimits: true });
  const user = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { factSheet, factSheetUpdatedAt: 1 } }),
  );
  await user.as.mutation(api.corrections.correctFact, {
    artworkId,
    factId: "f1",
    message: "The year is wrong.",
  });
  const [correction] = await t.query(internal.review.listCorrections, {});
  return { t, user, artworkId, correction };
}

describe("review.replaceFactSheet", () => {
  it("resolves only addressed reports and keeps the hold until every report is reviewed", async () => {
    const { t, user, artworkId, correction } = await fixture();
    await user.as.mutation(api.corrections.correctFact, {
      artworkId,
      factId: "f1",
      message: "The source is also wrong.",
    });
    await t.mutation(internal.review.replaceFactSheet, {
      artworkId,
      factSheet,
      correctionIds: [correction._id],
    });
    const open = await t.query(internal.review.listCorrections, {});
    expect(open).toHaveLength(1);
    expect(open[0].message).toBe("The source is also wrong.");
    expect(await t.query(internal.review.listCorrections, { status: "resolved" })).toMatchObject([
      { _id: correction._id },
    ]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    await t.mutation(internal.review.replaceFactSheet, {
      artworkId,
      factSheet,
      correctionIds: [open[0]._id],
    });
    expect(await t.query(internal.review.listCorrections, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBeUndefined();
  });

  it("rejects a correction from another artwork without changing either report or sheet", async () => {
    const { t, artworkId, correction } = await fixture();
    const other = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { factSheet } }));
    await expect(
      t.mutation(internal.review.replaceFactSheet, {
        artworkId: other.artworkId,
        factSheet: [],
        correctionIds: [correction._id],
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_correction" } });
    expect((await t.run((ctx) => ctx.db.get(other.artworkId)))?.factSheet).toEqual(factSheet);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it("rejects an oversized review before changing reports or lifting the hold", async () => {
    const { t, artworkId, correction } = await fixture();
    await expect(
      t.mutation(internal.review.replaceFactSheet, {
        artworkId,
        factSheet: [],
        correctionIds: Array(101).fill(correction._id),
      }),
    ).rejects.toMatchObject({ data: { code: "too_many_corrections" } });
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheet).toEqual(factSheet);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it("allows a sheet edit without resolving unaddressed reports", async () => {
    const { t, artworkId } = await fixture();
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet, correctionIds: [] });
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBe(true);
    expect(await t.query(internal.review.listCorrections, {})).toHaveLength(1);
  });

  it("drains a backlog through bounded reviews without hiding the remaining reports", async () => {
    const { t, user, artworkId } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++)
        await ctx.db.insert("factCorrections", {
          artworkId,
          factId: "f1",
          message: `Report ${i}`,
          deviceId: user.deviceId,
          createdAt: Date.now(),
          status: "open",
        });
    });
    const first = await t.query(internal.review.listCorrections, {});
    expect(first).toHaveLength(100);
    await t.mutation(internal.review.replaceFactSheet, {
      artworkId,
      factSheet,
      correctionIds: first.map((row) => row._id),
    });
    const remaining = await t.query(internal.review.listCorrections, {});
    expect(remaining).toHaveLength(1);
    await t.mutation(internal.review.replaceFactSheet, {
      artworkId,
      factSheet,
      correctionIds: [remaining[0]._id],
    });
    expect(await t.query(internal.review.listCorrections, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(artworkId)))?.factSheetNeedsReview).toBeUndefined();
  });
});

describe("review queues", () => {
  it("lists flagged objects, tentative contributions without their vectors, and proposals ready for review", async () => {
    const t = harness();
    const user = await seedDevice(t);
    const other = await seedDevice(t);
    const seeded = await t.run(async (ctx) => {
      const venueId = await seedMuseum(ctx);
      const flagged = await seedArtworkWithObject(ctx, {
        object: { flaggedForReview: true, rejectCount: 20 },
      });
      const clean = await seedArtworkWithObject(ctx);
      const pending = await seedContribution(ctx, {
        deviceId: user.deviceId,
        venueId,
        status: "tentative",
      });
      await seedContribution(ctx, {
        deviceId: user.deviceId,
        venueId,
        status: "rejected",
        rejectedReason: "duplicate",
      });
      const scanId = await seedScan(ctx, { deviceId: user.deviceId, venueId });
      const proposal = (deviceIds: Id<"devices">[]) =>
        ctx.db.insert("placementProposals", {
          objectId: clean.objectId,
          proposedVenueId: venueId,
          kind: "move",
          scanIds: [scanId],
          deviceIds,
          firstSeenAt: 1,
          lastSeenAt: 2,
          status: "pending",
          readyForReview: deviceIds.length >= 2,
        });
      const ready = await proposal([user.deviceId, other.deviceId]);
      await proposal([user.deviceId]);
      return { venueId, flagged, pending, ready };
    });
    expect(await t.query(internal.review.listFlaggedObjects, {})).toMatchObject([
      { _id: seeded.flagged.objectId },
    ]);
    const { rows: pending } = await t.query(internal.review.listContributions, {});
    expect(pending).toMatchObject([
      {
        _id: seeded.pending,
        status: "tentative",
        venueId: seeded.venueId,
        fields: { title: { value: "Water Lilies" } },
      },
    ]);
    expect(pending[0]).not.toHaveProperty("vector");
    expect(pending[0]).not.toHaveProperty("descriptors");
    expect(
      (await t.query(internal.review.listContributions, { status: "tentative" })).rows,
    ).toHaveLength(1);
    expect(await t.query(internal.review.listProposalsReady, {})).toMatchObject([
      { _id: seeded.ready, readyForReview: true },
    ]);
  });
});

it("can list pending contributions that were accepted within document limits", async () => {
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  for (let i = 0; i < 40; i++) {
    await t.run((ctx) =>
      seedContribution(ctx, {
        deviceId: alice.deviceId,
        venueId,
        status: "tentative",
        fields: {
          title: { value: "Water Lilies", edited: false, evidence: "ocr" },
          artist: { value: "Claude Monet", edited: false, evidence: "ocr" },
          creditLine: { value: "x".repeat(450_000), edited: true, evidence: "user_edited" },
        },
      }),
    );
  }
  const ids: Id<"contributions">[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result: FunctionReturnType<typeof internal.review.listContributions> = await t.query(
      internal.review.listContributions,
      { cursor },
    );
    ids.push(...result.rows.map((row) => row._id));
    cursor = result.cursor;
    pages++;
  } while (cursor !== null);
  expect(pages).toBeGreaterThan(1);
  expect(ids).toHaveLength(40);
  expect(new Set(ids).size).toBe(40);
});

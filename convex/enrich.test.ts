import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { BatchCursor } from "./enrich";
import { patchArtworkContent } from "./lib/artworkContent";
import { patchContributionState } from "./lib/objectContributionState";
import { newObjectCounters } from "./lib/objectCounters";
import { seedArtworkWithObject, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

afterEach(() => vi.restoreAllMocks());

const HOUR = 60 * 60 * 1000;

async function fixture() {
  const t = harness();
  const now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  const ids = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const onView = {
      venueId,
      onView: true,
      source: "feed" as const,
      confidence: 1,
    };
    const contribution = (await seedArtworkWithObject(ctx, { object: { source: "user" } })).artworkId;
    const hanging = (await seedArtworkWithObject(ctx, { placement: onView })).artworkId;
    const stored = (
      await seedArtworkWithObject(ctx, {
        placement: { ...onView, onView: false },
      })
    ).artworkId;
    const closed = (
      await seedArtworkWithObject(ctx, {
        placement: { ...onView, closedAt: now - HOUR },
      })
    ).artworkId;
    const enriched = (
      await seedArtworkWithObject(ctx, {
        placement: onView,
        artwork: { factSheetUpdatedAt: now - HOUR },
      })
    ).artworkId;
    await patchArtworkContent(
      ctx,
      { _id: enriched },
      { docent: { en: [{ sentence: "The harbor fills the canvas.", factIds: ["f1"] }] } },
    );
    const freshClaim = (
      await seedArtworkWithObject(ctx, {
        object: { source: "user" },
        artwork: { enrichClaimedAt: now - HOUR / 2 },
      })
    ).artworkId;
    const staleClaim = (
      await seedArtworkWithObject(ctx, {
        object: { source: "user" },
        artwork: { enrichClaimedAt: now - 2 * HOUR },
      })
    ).artworkId;
    const reviewed = (
      await seedArtworkWithObject(ctx, {
        placement: onView,
        artwork: { factSheetNeedsReview: true },
      })
    ).artworkId;
    const reverted = (
      await seedArtworkWithObject(ctx, {
        object: { source: "user", reverted: true },
      })
    ).artworkId;
    return {
      contribution,
      hanging,
      stored,
      closed,
      enriched,
      freshClaim,
      staleClaim,
      reviewed,
      reverted,
    };
  });
  return { t, now, ids };
}

const claimed = (rows: { _id: Id<"artworks"> }[]) => rows.map((row) => row._id);

async function sweep(t: Harness, limit = 100, after?: BatchCursor): Promise<Doc<"artworks">[]> {
  const artworks: Doc<"artworks">[] = [];
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await t.mutation(internal.enrich.claimBatch, { limit, after });
    artworks.push(...page.artworks);
    if (page.after === null) return artworks;
    after = page.after;
  }
  throw new Error("Sweep failed to finish");
}

describe("enrich.claimBatch", () => {
  it.each([false, true])("includes empty descriptions when existing research is %s", async (hasResearch) => {
    const { t, ids } = await fixture();
    await t.run(async (ctx) => {
      await patchArtworkContent(
        ctx,
        { _id: ids.enriched },
        {
          factSheet: hasResearch
            ? [
                {
                  id: "f1",
                  text: "The harbor fills the canvas.",
                  sourceUrl: "https://www.metmuseum.org/art/1",
                  sourceLabel: "Met",
                  sourceScore: 1,
                },
              ]
            : [],
          docent: { en: [] },
        },
      );
    });
    expect(claimed(await sweep(t))).toContain(ids.enriched);
  });

  it("claims contributions before on-view works and skips enriched, claimed, reviewed and reverted rows", async () => {
    const { t, now, ids } = await fixture();
    const artworks = await sweep(t);
    expect(claimed(artworks)).toEqual([ids.contribution, ids.staleClaim, ids.hanging]);
    expect(artworks.every((row) => row.enrichClaimedAt === now && row.enrichGeneration === 1)).toBe(true);
    expect((await t.run((ctx) => ctx.db.get("artworks", ids.hanging)))?.enrichClaimedAt).toBe(now);
    expect((await t.run((ctx) => ctx.db.get("artworks", ids.stored)))?.enrichClaimedAt).toBeUndefined();
    expect(await sweep(t)).toEqual([]);
  });

  it("resumes both passes, advancing past empty pages without revisiting earlier contributions", async () => {
    const { t, ids } = await fixture();
    const first = await t.mutation(internal.enrich.claimBatch, { limit: 1 });
    expect(claimed(first.artworks)).toEqual([ids.contribution]);
    expect(first.after).toMatchObject({
      phase: "contributions",
      cursor: expect.any(String),
    });
    await t.run((ctx) => ctx.db.patch("artworks", ids.contribution, { enrichClaimedAt: undefined }));
    const second = await t.mutation(internal.enrich.claimBatch, {
      limit: 1,
      after: first.after!,
    });
    expect(second.artworks).toEqual([]);
    expect(second.after).not.toBeNull();
    expect(claimed(await sweep(t, 1, second.after!))).toEqual([ids.staleClaim, ids.hanging]);
  });

  it("releases only the owning generation so an artwork can be claimed again", async () => {
    const { t, ids } = await fixture();
    await sweep(t);
    await t.mutation(internal.enrich.releaseClaim, {
      artworkId: ids.hanging,
      generation: 0,
    });
    expect(await sweep(t)).toEqual([]);
    await t.mutation(internal.enrich.releaseClaim, {
      artworkId: ids.hanging,
      generation: 1,
    });
    expect((await t.run((ctx) => ctx.db.get("artworks", ids.hanging)))?.enrichClaimedAt).toBeUndefined();
    const next = await sweep(t);
    expect(claimed(next)).toEqual([ids.hanging]);
    expect(next[0].enrichGeneration).toBe(2);
  });

  it(
    "reaches pending work after 4,200 enriched contributions within transaction limits",
    { timeout: 30_000 },
    async () => {
      const t = harness({ transactionLimits: true });
      for (let batch = 0; batch < 21; batch++) {
        await t.run(async (ctx) => {
          for (let i = 0; i < 200; i++) {
            const key = `enriched-${batch}-${i}`;
            const artworkId = await ctx.db.insert("artworks", {
              identityStatus: "established" as const,
              key,
              title: "Work",
              artist: "Artist",
              rightsStatus: "unknown",
              multiplicity: "unique",
              factSheetUpdatedAt: 1,
              enrichGeneration: 0,
            });
            await patchArtworkContent(
              ctx,
              { _id: artworkId },
              { docent: { en: [{ sentence: "The harbor fills the canvas.", factIds: ["f1"] }] } },
            );
            const objectId = await ctx.db.insert("objects", {
              identityStatus: "established" as const,
              key,
              artworkId,
              source: "user",
              sourceId: key,
              ...newObjectCounters,
              reverted: false,
            });
            await patchContributionState(ctx, objectId, {});
          }
        });
      }
      const expected = await t.run(async (ctx) => {
        const venueId = await seedMuseum(ctx);
        const contribution = await seedArtworkWithObject(ctx, {
          object: { source: "user" },
        });
        const hanging = await seedArtworkWithObject(ctx, {
          placement: { venueId, onView: true, source: "feed", confidence: 1 },
        });
        return [contribution.artworkId, hanging.artworkId];
      });
      const first = await t.mutation(internal.enrich.claimBatch, { limit: 1 });
      expect(first.artworks).toEqual([]);
      expect(first.after).not.toBeNull();
      expect(claimed(await sweep(t, 100, first.after!))).toEqual(expected);
    },
  );
});

it("previews pending work without claims or generations and resolves object keys", async () => {
  const { t, ids } = await fixture();
  const page = await t.query(internal.enrich.previewBatch, { limit: 100 });
  expect(claimed(page.artworks)).toEqual([ids.contribution, ids.staleClaim]);
  expect((await t.run((ctx) => ctx.db.get("artworks", ids.contribution)))?.enrichGeneration).toBe(0);
  expect((await t.run((ctx) => ctx.db.get("artworks", ids.contribution)))?.enrichClaimedAt).toBeUndefined();
  const object = await t.run((ctx) =>
    ctx.db
      .query("objects")
      .withIndex("by_artworkId", (q) => q.eq("artworkId", ids.contribution))
      .first(),
  );
  expect((await t.query(internal.enrich.lookup, { key: object!.key }))?._id).toBe(ids.contribution);
  expect(await t.query(internal.enrich.lookup, { key: "missing" })).toBeNull();
});

import { convexTest } from "convex-test";
import { expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { harness, type Harness } from "../test.helpers";
import { findCorpusMatches, titleScore } from "./corpusMatch";
import { seedArtworkWithObject, seedMuseum } from "./testFactories";

type Work = { title: string; artist: string; yearStart?: number; wikidataId?: string };

async function seedWorks(t: Harness, works: Work[]) {
  const ids: Record<string, { artworkId: Id<"artworks">; objectId: Id<"objects"> }> = {};
  for (const work of works) {
    ids[work.title] = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: work }));
  }
  return ids;
}

const titles = (t: Harness, query: Parameters<typeof findCorpusMatches>[1]) =>
  t.run(async (ctx) =>
    Promise.all(
      (await findCorpusMatches(ctx, query)).map(
        async ({ artworkId }) => (await ctx.db.get("artworks", artworkId))!.title,
      ),
    ),
  );

it("finds misread titles by the artist's name, preferring the label's year", async () => {
  const t = harness();
  await seedWorks(t, [
    { title: "Adele Bloch-Bauer II", artist: "Gustav Klimt", yearStart: 1912 },
    { title: "Portrait of Adele Bloch-Bauer I", artist: "Gustav Klimt", yearStart: 1907 },
    { title: "Adele Bloch-Bauer", artist: "Unknown artist" },
    { title: "Study for Adele Bloch-Bauer", artist: "Gustav Klimt" },
    { title: "The Kiss", artist: "Gustav Klimt" },
  ]);
  expect(await titles(t, { title: "Adele Blochbauer", artist: "Klimt", date: "1907" })).toEqual([
    "Portrait of Adele Bloch-Bauer I",
    "Adele Bloch-Bauer II",
  ]);
  expect(await titles(t, { title: "Adele Blochbauer" })).toEqual([]);
});

it("puts the label's Wikidata work first even when its title reads differently", async () => {
  const t = harness();
  await seedWorks(t, [
    { title: "Café Terrace at Night", artist: "Vincent van Gogh", wikidataId: "Q1025704" },
    { title: "Terrace of a Café at Night", artist: "Vincent van Gogh" },
  ]);
  expect(await titles(t, { title: "Terrace of a Cafe at Night", artist: "Van Gogh", wikidataId: "Q1025704" })).toEqual([
    "Café Terrace at Night",
    "Terrace of a Café at Night",
  ]);
});

it("names only eligible catalogue objects, at most three, preferring the scan's venue", async () => {
  const t = harness();
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const works = await seedWorks(t, [
    { title: "Water Lilies", artist: "Claude Monet", yearStart: 1906 },
    { title: "Water Lilies ", artist: "Claude Monet", yearStart: 1907 },
    { title: "Water-Lilies", artist: "Claude Monet", yearStart: 1914 },
    { title: "Waterlilies", artist: "Claude Monet", yearStart: 1916 },
  ]);
  const retired = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { title: "Water Lilies", artist: "Claude Monet", retiredAt: 1 } }),
  );
  const visitor = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Water Lilies", artist: "Claude Monet" },
      object: { identityStatus: "tentative" },
    }),
  );
  await t.run((ctx) => ctx.db.patch("objects", works["Water-Lilies"].objectId, { reverted: true }));
  const atVenue = await t.run(async (ctx) => {
    const objectId = await ctx.db.insert("objects", {
      ...(await ctx.db.get("objects", works.Waterlilies.objectId))!,
      _id: undefined,
      _creationTime: undefined,
      ownerId: venueId,
    } as never);
    return objectId;
  });
  const matches = await t.run((ctx) => findCorpusMatches(ctx, { title: "Water Lilies", artist: "Monet" }, venueId));
  expect(matches).toHaveLength(3);
  const objectIds = matches.map((match) => match.objectId);
  expect(objectIds).toContain(atVenue);
  expect(objectIds).not.toContain(works.Waterlilies.objectId);
  expect(objectIds).not.toContain(works["Water-Lilies"].objectId);
  expect(objectIds).not.toContain(retired.objectId);
  expect(objectIds).not.toContain(visitor.objectId);
});

it("never names a study or copy for the finished work", () => {
  expect(titleScore("The Sleeping Gypsy", "Sleeping Gypsy")).toBeGreaterThan(0.6);
  expect(titleScore("Sleeping Gypsy", "Copy after The Sleeping Gypsy")).toBe(0);
  expect(titleScore("Nimphee", "Nymphéas")).toBe(0);
});

it("derives search text on every artwork write", async () => {
  const t = harness();
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { title: "Café Terrace", artist: "Vincent van Gogh" } }),
  );
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { title: "Café Terrace at Night", searchText: undefined }));
  expect((await t.run((ctx) => ctx.db.get("artworks", artworkId)))?.searchText).toBe(
    "cafe terrace at night vincent van gogh",
  );
});

it("backfills search fields on imported rows, which skip the trigger", async () => {
  // A bare harness writes without the database triggers, as corpus imports do.
  const t = convexTest(schema, import.meta.glob("../**/*.*s"));
  const artworkId = await t.run((ctx) =>
    ctx.db.insert("artworks", {
      identityStatus: "established",
      key: "wikidata:Q1219263",
      title: "The Sleeping Gypsy",
      artist: "Henri Rousseau",
      rightsStatus: "public_domain",
      multiplicity: "unique",
      enrichGeneration: 0,
    }),
  );
  await t.mutation(internal.artworks.backfillSearchFields, { cursor: null });
  expect(await t.run((ctx) => ctx.db.get("artworks", artworkId))).toMatchObject({
    searchText: "the sleeping gypsy henri rousseau",
    artistKey: "henri rousseau",
  });
});

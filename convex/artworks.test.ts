import { expect, it } from "vitest";

import { openingFixture } from "../shared/audio/guide-fixtures";
import { api } from "./_generated/api";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { narrationProvenance } from "./lib/narrationCache";
import { seedArtworkWithObject, seedDevice } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

const docent = [
  {
    sentence: "Monet painted this pond at Giverny in 1916.",
    factIds: ["f1", "f2"],
  },
];
const factSheet = [
  {
    id: "f1",
    text: "Painted in 1916.",
    sourceUrl: "https://www.wikidata.org/wiki/Q1",
    sourceLabel: "Wikidata",
    sourceScore: 0.8,
  },
  {
    id: "f2",
    text: "The pond is at Giverny.",
    sourceUrl: "https://museum.example/lilies",
    sourceLabel: "Test Museum",
    sourceScore: 1,
  },
];
const chips = [
  {
    id: "f1",
    sourceUrl: "https://www.wikidata.org/wiki/Q1",
    sourceLabel: "Wikidata",
  },
  {
    id: "f2",
    sourceUrl: "https://museum.example/lilies",
    sourceLabel: "Test Museum",
  },
];

it("returns docent sentences, source chips and the public-domain thumbnail to a registered device, keeping fact text private", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { factSheetUpdatedAt: 5 },
      artworkContent: { docent: { en: docent }, factSheet },
    }),
  );
  expect(await as.query(api.artworks.enrichment, { artworkId })).toEqual({
    docent,
    docentWriting: false,
    narrationWriting: false,
    narrationFacts: chips,
    narrationResearchUpdatedAt: 5,
    narrationOpening: openingFixture,
    factSheet: chips,
    rightsStatus: "public_domain",
    thumbnailUrl: "https://museum.example/work.jpg",
  });
});

it("omits the thumbnail for in-copyright works and reverted objects, and returns null for a missing artwork", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const inCopyright = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { rightsStatus: "in_copyright" } }));
  expect(
    await as.query(api.artworks.enrichment, {
      artworkId: inCopyright.artworkId,
    }),
  ).toEqual({
    rightsStatus: "in_copyright",
    docentWriting: false,
    narrationWriting: false,
    narrationOpening: openingFixture,
  });
  const reverted = await t.run((ctx) => seedArtworkWithObject(ctx, { object: { reverted: true } }));
  expect(await as.query(api.artworks.enrichment, { artworkId: reverted.artworkId })).toEqual({
    rightsStatus: "public_domain",
    docentWriting: false,
    narrationWriting: false,
    narrationOpening: openingFixture,
  });
  const gone = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.run((ctx) => ctx.db.delete("artworks", gone.artworkId));
  expect(await as.query(api.artworks.enrichment, { artworkId: gone.artworkId })).toBeNull();
});

it("rejects anonymous and unregistered callers", async () => {
  const t = harness();
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  await expect(t.query(api.artworks.enrichment, { artworkId })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  const user = await signIn(t);
  await expect(user.as.query(api.artworks.enrichment, { artworkId })).rejects.toMatchObject({
    data: { code: "device_not_registered" },
  });
});

it("keeps catalogue lines as source chips but out of the narration research", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const catalogue = {
    id: "f3",
    text: "Material: oil paint, canvas",
    sourceUrl: "https://www.wikidata.org/wiki/Q1",
    sourceLabel: "Wikidata",
    sourceScore: 0.8,
  };
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artworkContent: { factSheet: [...factSheet, catalogue] },
    }),
  );
  const enrichment = await as.query(api.artworks.enrichment, { artworkId });
  expect(enrichment?.narrationFacts).toEqual(chips);
  expect(enrichment?.factSheet?.map((chip) => chip.id)).toEqual(["f1", "f2", "f3"]);
  const bare = await t.run((ctx) => seedArtworkWithObject(ctx, { artworkContent: { factSheet: [catalogue] } }));
  expect((await as.query(api.artworks.enrichment, { artworkId: bare.artworkId }))?.narrationFacts).toBeUndefined();
});

it("withholds additional narration facts while their sources need review", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { factSheetNeedsReview: true },
      artworkContent: { docent: { en: docent }, factSheet },
    }),
  );
  expect((await as.query(api.artworks.enrichment, { artworkId }))?.narrationFacts).toBeUndefined();
});

it("returns the rendered audio guide script until the research behind it changes", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { factSheetUpdatedAt: 5 }, artworkContent: { factSheet } }),
  );
  const script = [
    { sentence: openingFixture, factIds: [] },
    { sentence: "The pond is in Monet's garden at Giverny.", factIds: ["f2"] },
  ];
  await t.run(async (ctx) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) throw new Error("Seeded artwork is missing.");
    const storageId = await fileStorage.store(ctx, new Blob(["mp3"], { type: "audio/mpeg" }));
    await retainFile(ctx, storageId, true);
    await ctx.db.insert("narrationAudio", {
      artworkId,
      claim: "render-1",
      claimedAt: 0,
      ...narrationProvenance(artwork),
      storageId,
      sentences: script,
    });
  });
  expect(await as.query(api.artworks.enrichment, { artworkId })).toMatchObject({
    narration: script,
    narrationRenderId: "render-1",
  });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { factSheetUpdatedAt: 6 }));
  const stale = await as.query(api.artworks.enrichment, { artworkId });
  expect(stale?.narration).toBeUndefined();
  expect(stale?.narrationRenderId).toBeUndefined();
});

import { expect, it } from "vitest";

import { openingFixture } from "../shared/audio/guide-fixtures";
import { api, internal } from "./_generated/api";
import { fileStorage, retainFile } from "./lib/fileStorage";
import { narrationProvenance } from "./lib/narrationCache";
import { seedArtworkWithObject, seedDevice, seedMuseum } from "./lib/testFactories";
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
    docentGeneration: 0,
    narrationWriting: false,
    narrationAvailable: true,
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
    docentGeneration: 0,
    narrationWriting: false,
    narrationAvailable: true,
    narrationOpening: openingFixture,
  });
  const reverted = await t.run((ctx) => seedArtworkWithObject(ctx, { object: { reverted: true } }));
  expect(await as.query(api.artworks.enrichment, { artworkId: reverted.artworkId })).toEqual({
    rightsStatus: "public_domain",
    docentWriting: false,
    docentGeneration: 0,
    narrationWriting: false,
    narrationAvailable: true,
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
  const unnarratable = await as.query(api.artworks.enrichment, { artworkId: bare.artworkId });
  expect(unnarratable?.narrationAvailable).toBe(false);
  expect(unnarratable).not.toHaveProperty("narrationFacts");
});

it("offers a guide for an unresearched work until research finds nothing to cite, or while a run writes it", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const available = async () => (await as.query(api.artworks.enrichment, { artworkId }))?.narrationAvailable;
  expect(await available()).toBe(true);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: Date.now() }));
  expect(await available()).toBe(true);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: undefined, docentNoSources: true }));
  expect(await available()).toBe(false);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { docentNoSources: undefined, retiredAt: 1 }));
  expect(await available()).toBe(false);
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
  const withheld = await as.query(api.artworks.enrichment, { artworkId });
  expect(withheld?.narrationAvailable).toBe(false);
  expect(withheld).not.toHaveProperty("narrationFacts");
});

it("returns the rendered audio guide script until the research behind it changes", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { factSheetUpdatedAt: 5 }, artworkContent: { factSheet } }),
  );
  const script = [
    { sentence: openingFixture, factIds: [], section: "hook" as const },
    { sentence: "The pond is in Monet's garden at Giverny.", factIds: ["f2"], section: "hook" as const },
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

it("finds catalog works by title or artist, leaving out works that can't be shown", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, { name: "Art Institute of Chicago" }));
  const wheat = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Stacks of Wheat (End of Summer)", artist: "Claude Monet", date: "1890–91" },
      object: { ownerId: venueId },
    }),
  );
  const copyrighted = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Monet's Garden", artist: "Jane Painter", rightsStatus: "in_copyright" },
    }),
  );
  const takenDown = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artwork: { title: "Taken", artist: "Claude Monet" } }),
  );
  await t.run((ctx) =>
    ctx.db.insert("takedowns", {
      target: { kind: "artwork", artworkId: takenDown.artworkId },
      requester: "museum",
      receivedAt: Date.now(),
    }),
  );
  await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Unconfirmed", artist: "Claude Monet", identityStatus: "tentative" },
    }),
  );
  const result = await as.query(api.artworks.search, { query: "Monet" });
  expect(result.isDone).toBe(true);
  expect(result.page).toEqual(
    expect.arrayContaining([
      {
        artworkId: wheat.artworkId,
        title: "Stacks of Wheat (End of Summer)",
        artist: "Claude Monet",
        date: "1890–91",
        medium: "Oil on canvas",
        institution: "Art Institute of Chicago",
        thumbnailUrl: "https://museum.example/work.jpg",
      },
      // In-copyright works are listed without their picture.
      expect.not.objectContaining({ thumbnailUrl: expect.anything() }),
    ]),
  );
  expect(result.page.map(({ artworkId }) => artworkId).sort()).toEqual([wheat.artworkId, copyrighted.artworkId].sort());
  expect((await as.query(api.artworks.search, { query: "wheat summ" })).page).toHaveLength(1);
  expect(await as.query(api.artworks.search, { query: " ?! " })).toEqual({ page: [], cursor: null, isDone: true });
});

it("opens a catalog work's page with a link to its artist, and nothing for a retired work", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { artist: "Claude Monet" } }));
  const page = await as.query(api.artworks.get, { artworkId });
  const artist = await t.run((ctx) => ctx.db.query("artists").first());
  expect(page).toMatchObject({ artworkId, title: "Water Lilies", artist: "Claude Monet", artistId: artist!._id });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { retiredAt: 1 }));
  expect(await as.query(api.artworks.get, { artworkId })).toBeNull();
});

it.each(["public_domain", "in_copyright", "unknown"] as const)(
  "shows a stored catalog crop only when the artwork is public domain: %s",
  async (rightsStatus) => {
    const t = harness();
    const { as } = await seedDevice(t);
    const { artworkId } = await t.run(async (ctx) => {
      const thumbnailStorageId = await fileStorage.store(ctx, new Blob(["crop"], { type: "image/jpeg" }));
      await retainFile(ctx, thumbnailStorageId, true);
      return seedArtworkWithObject(ctx, {
        artwork: { rightsStatus },
        object: { source: "user" },
        objectDetails: { thumbnailStorageId },
      });
    });
    const work = await as.query(api.artworks.get, { artworkId });
    expect(work).not.toBeNull();
    expect(!!work?.thumbnailUrl).toBe(rightsStatus === "public_domain");
    const search = await as.query(api.artworks.search, { query: "Water Lilies" });
    expect(search.page[0]?.thumbnailUrl).toBe(work?.thumbnailUrl);
    const works = await as.query(api.artists.works, { artistId: work!.artistId! });
    expect(works.page[0]?.thumbnailUrl).toBe(work?.thumbnailUrl);
  },
);

it("exposes a completed research generation even when the client missed the writing state", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  expect(await as.query(api.artworks.enrichment, { artworkId })).toMatchObject({
    docentGeneration: 0,
    docentWriting: false,
  });
  const generation = await t.mutation(internal.docent.claim, { artworkId });
  await t.mutation(internal.docent.fail, { artworkId, generation: generation!, noSources: false });
  expect(await as.query(api.artworks.enrichment, { artworkId })).toMatchObject({
    docentGeneration: generation,
    docentWriting: false,
  });
});

it("researches a work opened from search once, and not again after it found nothing", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(await as.mutation(api.artworks.research, { artworkId })).toBe(true);
  expect((await scheduled()).map(({ name }) => name)).toEqual(["docent:ensure"]);

  // A run in progress or one that found no sources is left alone; so is a work that already has its story.
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: Date.now() }));
  expect(await as.mutation(api.artworks.research, { artworkId })).toBe(false);
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: undefined, docentNoSources: true }));
  expect(await as.mutation(api.artworks.research, { artworkId })).toBe(false);
  const told = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { artworkContent: { docent: { en: docent }, factSheet } }),
  );
  expect(await as.mutation(api.artworks.research, { artworkId: told.artworkId })).toBe(false);
  expect(await scheduled()).toHaveLength(1);
});

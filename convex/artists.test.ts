import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { seedArtworkWithObject, seedDevice, seedMuseum } from "./lib/testFactories";
import schema from "./schema";
import { harness, type Harness } from "./test.helpers";

type Work = Partial<Omit<Doc<"artworks">, "_id" | "_creationTime">>;

const artistRows = (t: Harness) =>
  t.run(async (ctx) =>
    (await ctx.db.query("artists").collect()).map(({ key, name, workCount }) => ({ key, name, workCount })),
  );

async function seedWork(t: Harness, artwork: Work, thumbnailUrl = "https://museum.example/work.jpg") {
  return t.run((ctx) => seedArtworkWithObject(ctx, { artwork, objectDetails: { thumbnailUrl } }));
}

async function save(ctx: MutationCtx, artworkId: Id<"artworks">, deviceId: Id<"devices">, deleted = false) {
  await ctx.db.insert("collections", {
    owner: { kind: "device", deviceId },
    localId: crypto.randomUUID(),
    artworkId,
    snapshot: { title: "Work", artist: "" },
    savedAt: 1,
    updatedAt: 1,
    updatedBy: deviceId,
    changeVersion: 1,
    ...(deleted ? { deletedAt: 2 } : {}),
  });
}

it("counts each artist's established, unretired works under one key however sources spell the name", async () => {
  const t = harness();
  await seedWork(t, { title: "Water Lilies", artist: "Claude Monet" });
  const { artworkId } = await seedWork(t, { title: "Stacks of Wheat", artist: "CLAUDE  MONET" });
  await seedWork(t, { title: "Untitled", artist: "Unknown artist" });
  await seedWork(t, { title: "A community entry", artist: "Claude Monet", identityStatus: "tentative" });
  expect(await artistRows(t)).toEqual([{ key: "claude monet", name: "Claude Monet", workCount: 2 }]);

  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { retiredAt: 1 }));
  expect(await artistRows(t)).toEqual([{ key: "claude monet", name: "Claude Monet", workCount: 1 }]);
});

it("moves a work to its new artist when the name is corrected, and drops an artist with no works left", async () => {
  const t = harness();
  const { artworkId } = await seedWork(t, { title: "Haystacks", artist: "Claude Monnet" });
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { artist: "Claude Monet" }));
  expect(await artistRows(t)).toEqual([{ key: "claude monet", name: "Claude Monet", workCount: 1 }]);
  expect((await t.run((ctx) => ctx.db.get("artworks", artworkId)))?.artistKey).toBe("claude monet");
});

it("counts imported rows once when the backfill gives them a key, however often it runs", async () => {
  // A bare harness writes without the database triggers, as `convex import` does.
  const bare = convexTest(schema, import.meta.glob("./**/*.*s"));
  await bare.run(async (ctx) => {
    for (const title of ["The Sleeping Gypsy", "The Dream"]) {
      await ctx.db.insert("artworks", {
        identityStatus: "established",
        key: crypto.randomUUID(),
        title,
        artist: "Henri Rousseau",
        rightsStatus: "public_domain",
        multiplicity: "unique",
        enrichGeneration: 0,
      });
    }
  });
  await bare.mutation(internal.artworks.backfillSearchFields, { cursor: null });
  await bare.mutation(internal.artworks.backfillSearchFields, { cursor: null });
  expect(await bare.run((ctx) => ctx.db.query("artists").collect())).toMatchObject([
    { key: "henri rousseau", name: "Henri Rousseau", workCount: 2 },
  ]);
});

it("finds artists by any part of their name, with a work as the avatar", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  await seedWork(t, { title: "Water Lilies", artist: "Claude Monet" }, "https://museum.example/lilies.jpg");
  await seedWork(t, { title: "Sky Above Clouds", artist: "Georgia O’Keeffe", rightsStatus: "in_copyright" });
  expect(await as.query(api.artists.search, { query: "mon" })).toEqual([
    { artistId: expect.any(String), name: "Claude Monet", workCount: 1, coverUrl: "https://museum.example/lilies.jpg" },
  ]);
  // In-copyright pictures are never shown, so the artist gets no avatar.
  expect(await as.query(api.artists.search, { query: "keeffe" })).toEqual([
    { artistId: expect.any(String), name: "Georgia O’Keeffe", workCount: 1 },
  ]);
  expect(await as.query(api.artists.search, { query: "  " })).toEqual([]);
});

it("picks each artist's most-saved work with a picture as the avatar, monthly", async () => {
  vi.useFakeTimers();
  const t = harness();
  const { as, deviceId } = await seedDevice(t);
  await seedWork(t, { title: "Water Lilies", artist: "Claude Monet" }, "https://museum.example/first.jpg");
  const wheat = await seedWork(
    t,
    { title: "Stacks of Wheat", artist: "Claude Monet" },
    "https://museum.example/wheat.jpg",
  );
  const pond = await seedWork(
    t,
    { title: "Water Lily Pond", artist: "Claude Monet" },
    "https://museum.example/pond.jpg",
  );
  await t.run(async (ctx) => {
    await save(ctx, wheat.artworkId, deviceId);
    await save(ctx, pond.artworkId, deviceId);
    await save(ctx, pond.artworkId, deviceId);
    // Deleted saves don't count, so these leave the pond ahead.
    await save(ctx, wheat.artworkId, deviceId, true);
    await save(ctx, wheat.artworkId, deviceId, true);
  });
  const avatar = async () => (await as.query(api.artists.search, { query: "monet" }))[0]?.coverUrl;
  // Before the first pick, the first catalog work with a picture stands in.
  expect(await avatar()).toBe("https://museum.example/first.jpg");
  await t.action(internal.artists.refreshCovers, {});
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  expect(await avatar()).toBe("https://museum.example/pond.jpg");
  vi.useRealTimers();
});

it("lists an artist's shown works page by page and their details", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, { name: "Art Institute of Chicago" }));
  const shown = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Stacks of Wheat", artist: "Claude Monet", date: "1890–91" },
      object: { ownerId: venueId },
    }),
  );
  const retired = await seedWork(t, { title: "Retired", artist: "Claude Monet" });
  await t.run((ctx) => ctx.db.patch("artworks", retired.artworkId, { retiredAt: 1 }));
  const reverted = await seedWork(t, { title: "Reverted", artist: "Claude Monet" });
  await t.run((ctx) => ctx.db.patch("objects", reverted.objectId, { reverted: true }));
  const [{ artistId }] = await as.query(api.artists.search, { query: "monet" });
  expect(await as.query(api.artists.get, { artistId })).toMatchObject({ name: "Claude Monet", key: "claude monet" });
  expect(await as.query(api.artists.works, { artistId })).toEqual({
    page: [
      {
        artworkId: shown.artworkId,
        title: "Stacks of Wheat",
        artist: "Claude Monet",
        date: "1890–91",
        medium: "Oil on canvas",
        institution: "Art Institute of Chicago",
        thumbnailUrl: "https://museum.example/work.jpg",
      },
    ],
    cursor: null,
    isDone: true,
  });
});

it("replaces a cached avatar when its artwork is attributed to another artist", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  const picked = await seedWork(t, { artist: "Claude Monet" }, "https://museum.example/corrected.jpg");
  await seedWork(t, { artist: "Claude Monet" }, "https://museum.example/lilies.jpg");
  await t.run((ctx) =>
    ctx.db.insert("artistCovers", { artistKey: "claude monet", artworkId: picked.artworkId, saves: 3 }),
  );
  const [{ artistId }] = await as.query(api.artists.search, { query: "monet" });
  expect((await as.query(api.artists.get, { artistId }))?.coverUrl).toBe("https://museum.example/corrected.jpg");

  await t.run((ctx) => ctx.db.patch("artworks", picked.artworkId, { artist: "Edouard Manet" }));
  expect((await as.query(api.artists.search, { query: "monet" }))[0]).toMatchObject({
    workCount: 1,
    coverUrl: "https://museum.example/lilies.jpg",
  });
  expect((await as.query(api.artists.get, { artistId }))?.coverUrl).toBe("https://museum.example/lilies.jpg");
});

it("rejects callers without a registered device", async () => {
  const t = harness();
  await expect(t.query(api.artists.search, { query: "monet" })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
});

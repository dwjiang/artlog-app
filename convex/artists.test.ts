import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { newObjectCounters } from "./lib/objectCounters";
import { patchObjectDetails } from "./lib/objectDetails";
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

it("stores each artist's avatar for search and picks again once their works change", async () => {
  vi.useFakeTimers();
  const t = harness();
  const { as } = await seedDevice(t);
  const lilies = await seedWork(t, { artist: "Claude Monet" }, "https://museum.example/lilies.jpg");
  await seedWork(t, { artist: "Georgia O’Keeffe", rightsStatus: "in_copyright" });
  const covers = async () =>
    Object.fromEntries(
      (await t.run((ctx) => ctx.db.query("artists").collect())).map(({ name, coverArtworkId }) => [
        name,
        coverArtworkId,
      ]),
    );
  const refresh = async () => {
    await t.action(internal.artists.refreshCovers, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  };
  await refresh();
  expect(await covers()).toEqual({ "Claude Monet": lilies.artworkId, "Georgia O’Keeffe": null });
  expect(await as.query(api.artists.search, { query: "keeffe" })).toEqual([
    { artistId: expect.any(String), name: "Georgia O’Keeffe", workCount: 1 },
  ]);

  const early = await seedWork(t, { artist: "Georgia O’Keeffe" }, "https://museum.example/early.jpg");
  expect((await covers())["Georgia O’Keeffe"]).toBeUndefined();
  expect((await as.query(api.artists.search, { query: "keeffe" }))[0]?.coverUrl).toBe(
    "https://museum.example/early.jpg",
  );
  await refresh();
  expect(await covers()).toEqual({ "Claude Monet": lilies.artworkId, "Georgia O’Keeffe": early.artworkId });

  // A stored avatar taken down stops showing at once; the next work with a picture stands in.
  await seedWork(t, { artist: "Claude Monet" }, "https://museum.example/wheat.jpg");
  await refresh();
  await t.run((ctx) => ctx.db.patch("artworks", lilies.artworkId, { rightsStatus: "in_copyright" }));
  expect((await as.query(api.artists.search, { query: "monet" }))[0]?.coverUrl).toBe(
    "https://museum.example/wheat.jpg",
  );
  vi.useRealTimers();
});

it.each(["thumbnail", "rights"] as const)(
  "rechecks a missing cover after an existing work's %s changes",
  async (change) => {
    vi.useFakeTimers();
    try {
      const t = harness({ transactionLimits: true });
      const { as } = await seedDevice(t);
      const work = await t.run((ctx) =>
        seedArtworkWithObject(ctx, {
          artwork: { rightsStatus: change === "rights" ? "in_copyright" : "public_domain" },
          objectDetails: { thumbnailUrl: change === "thumbnail" ? undefined : "https://museum.example/work.jpg" },
        }),
      );
      const refresh = async () => {
        await t.action(internal.artists.refreshCovers, {});
        await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
      };
      await refresh();
      expect((await t.run((ctx) => ctx.db.query("artists").first()))?.coverArtworkId).toBeNull();

      await t.run((ctx) =>
        change === "thumbnail"
          ? patchObjectDetails(ctx, { _id: work.objectId }, { thumbnailUrl: "https://museum.example/work.jpg" })
          : ctx.db.patch("artworks", work.artworkId, { rightsStatus: "public_domain" }),
      );
      await refresh();
      expect((await t.run((ctx) => ctx.db.query("artists").first()))?.coverArtworkId).toBe(work.artworkId);
      expect((await as.query(api.catalog.search, { query: "monet" })).artists[0]?.coverUrl).toBe(
        "https://museum.example/work.jpg",
      );
    } finally {
      vi.useRealTimers();
    }
  },
);

it("finishes cover assignment across pages within transaction limits when works have multiple objects", async () => {
  vi.useFakeTimers();
  try {
    const t = harness({ transactionLimits: true });
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    for (let artist = 0; artist < 10; artist++) {
      await t.run(async (ctx) => {
        for (let work = 0; work < 12; work++) {
          const key = `artist-${artist}-work-${work}`;
          const artworkId = await ctx.db.insert("artworks", {
            identityStatus: "established",
            key,
            title: key,
            artist: `Painter ${artist}`,
            rightsStatus: "public_domain",
            multiplicity: "multiple",
            enrichGeneration: 0,
          });
          for (let object = 0; object < 8; object++) {
            const detailsId = await ctx.db.insert("objectDetails", { medium: "Etching" });
            await ctx.db.insert("objects", {
              identityStatus: "established",
              key: `${key}-object-${object}`,
              artworkId,
              ownerId: venueId,
              detailsId,
              source: "corpus",
              sourceId: `${key}-object-${object}`,
              ...newObjectCounters,
              reverted: false,
            });
          }
        }
      });
    }
    const pictured = await seedWork(t, { artist: "Last Painter" });

    await t.action(internal.artists.refreshCovers, { phase: "assign" });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    const artists = await t.run((ctx) => ctx.db.query("artists").collect());
    expect(artists).toHaveLength(11);
    expect(artists.filter(({ coverArtworkId }) => coverArtworkId === null)).toHaveLength(10);
    expect(artists.find(({ name }) => name === "Last Painter")?.coverArtworkId).toBe(pictured.artworkId);
  } finally {
    vi.useRealTimers();
  }
});

it("tallies a long tail of saved works across bounded transactions without dropping covers", async () => {
  const t = harness({ transactionLimits: true });
  const { deviceId } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  for (let work = 0; work < 500; work++) {
    await t.run(async (ctx) => {
      const key = `cover-work-${work}`;
      const artworkId = await ctx.db.insert("artworks", {
        key,
        title: key,
        artist: `Painter ${work}`,
        identityStatus: "established",
        rightsStatus: "public_domain",
        multiplicity: "unique",
        enrichGeneration: 0,
      });
      const detailsId = await ctx.db.insert("objectDetails", { thumbnailUrl: `https://museum.example/${work}.jpg` });
      await ctx.db.insert("objects", {
        key,
        artworkId,
        ownerId: venueId,
        detailsId,
        identityStatus: "established",
        source: "corpus",
        sourceId: key,
        ...newObjectCounters,
        reverted: false,
      });
      await save(ctx, artworkId, deviceId);
    });
  }
  let cursor: string | null = null;
  let open: { artworkId: Id<"artworks">; saves: number } | undefined;
  let done = false;
  while (!done) {
    const page: FunctionReturnType<typeof internal.artists.tallyCovers> = await t.mutation(
      internal.artists.tallyCovers,
      { cursor, open },
    );
    cursor = page.cursor;
    open = page.open ?? undefined;
    done = page.isDone;
  }
  expect(await t.run((ctx) => ctx.db.query("artistCovers").collect())).toHaveLength(500);
}, 30_000);

it("carries save counts across tally pages and excludes deleted saves", async () => {
  const t = harness({ transactionLimits: true });
  const { deviceId } = await seedDevice(t);
  const first = await seedWork(t, { artist: "Claude Monet" });
  const second = await seedWork(t, { artist: "Henri Rousseau" });
  await t.run(async (ctx) => {
    for (const { artworkId } of [first, second]) {
      for (let i = 0; i < 21; i++) await save(ctx, artworkId, deviceId);
    }
    for (let i = 0; i < 25; i++) await save(ctx, second.artworkId, deviceId, true);
  });
  let cursor: string | null = null;
  let open: { artworkId: Id<"artworks">; saves: number } | undefined;
  for (;;) {
    const page: FunctionReturnType<typeof internal.artists.tallyCovers> = await t.mutation(
      internal.artists.tallyCovers,
      { cursor, open },
    );
    if (page.isDone) break;
    cursor = page.cursor;
    open = page.open ?? undefined;
  }
  const covers = await t.run((ctx) => ctx.db.query("artistCovers").collect());
  expect(covers).toHaveLength(2);
  expect(covers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ artworkId: first.artworkId, saves: 21 }),
      expect.objectContaining({ artworkId: second.artworkId, saves: 21 }),
    ]),
  );
});

it("keeps the earlier cover when a later work ties its save count", async () => {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const first = await seedWork(t, { artist: "Claude Monet" });
  const second = await seedWork(t, { artist: "Claude Monet" });
  await t.run(async (ctx) => {
    await save(ctx, second.artworkId, deviceId);
    await ctx.db.insert("artistCovers", { artistKey: "claude monet", artworkId: first.artworkId, saves: 1 });
  });
  await t.mutation(internal.artists.tallyCovers, { cursor: null });
  expect(await t.run((ctx) => ctx.db.query("artistCovers").collect())).toMatchObject([
    { artworkId: first.artworkId, saves: 1 },
  ]);
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

import { expect, it } from "vitest";

import { api } from "./_generated/api";
import { newObjectCounters } from "./lib/objectCounters";
import { seedArtworkWithObject, seedDevice, seedMuseum } from "./lib/testFactories";
import { harness } from "./test.helpers";

it("finds matching artists and works in one search", async () => {
  const t = harness();
  const { as } = await seedDevice(t);
  for (const title of ["Water Lilies", "Stacks of Wheat", "Water Lily Pond"]) {
    await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        artwork: { title, artist: "Claude Monet" },
        objectDetails: { thumbnailUrl: `https://museum.example/${title}.jpg` },
      }),
    );
  }
  const result = await as.query(api.catalog.search, { query: "monet", limit: 2 });
  expect(result.artists).toEqual([
    { artistId: expect.any(String), name: "Claude Monet", workCount: 3, coverUrl: expect.any(String) },
  ]);
  expect(result.artworks).toMatchObject({
    page: [{ artist: "Claude Monet" }, { artist: "Claude Monet" }],
    isDone: false,
  });
  expect(await as.query(api.catalog.search, { query: "  " })).toEqual({
    artists: [],
    artworks: { page: [], cursor: null, isDone: true },
  });
});

it("rejects callers without a registered device", async () => {
  const t = harness();
  await expect(t.query(api.catalog.search, { query: "monet" })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
});

it("keeps artists and artworks searchable when uncached covers exhaust the read budget", async () => {
  const t = harness({ transactionLimits: true });
  const devices: Awaited<ReturnType<typeof seedDevice>>[] = [];
  for (let i = 0; i < 5; i++) devices.push(await seedDevice(t));
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const scans = await t.run(async (ctx) => {
    const rows = [];
    for (const { deviceId } of devices) {
      rows.push(
        await ctx.db.insert("scans", {
          deviceId,
          localId: crypto.randomUUID(),
          generation: 0,
          modelVersion: "test",
          capturedAt: 1,
          status: "identified",
          updatedAt: 1,
        }),
      );
    }
    return rows;
  });
  for (let artist = 0; artist < 3; artist++) {
    for (let work = 0; work < 12; work++) {
      await t.run(async (ctx) => {
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
          const objectId = await ctx.db.insert("objects", {
            identityStatus: "established",
            key: `${key}-object-${object}`,
            artworkId,
            ownerId: venueId,
            detailsId,
            source: "user",
            sourceId: `${key}-${object}`,
            ...newObjectCounters,
            reverted: false,
          });
          const proposalId = await ctx.db.insert("placementProposals", {
            objectId,
            proposedVenueId: venueId,
            kind: "new_object",
            firstSeenAt: 1,
            lastSeenAt: 1,
            status: "promoted",
            readyForReview: false,
          });
          for (let i = 0; i < devices.length; i++) {
            await ctx.db.insert("proposalEvidence", {
              proposalId,
              deviceId: devices[i].deviceId,
              scanId: scans[i],
            });
          }
          await ctx.db.patch("objects", objectId, { sourceProposalId: proposalId });
        }
      });
    }
  }
  const { as } = devices[0];
  expect(await as.query(api.artists.search, { query: "painter" })).toHaveLength(3);
  expect((await as.query(api.artworks.search, { query: "painter", limit: 5 })).page).toHaveLength(5);
  const result = await as.query(api.catalog.search, { query: "painter", limit: 5 });
  expect(result.artists).toHaveLength(3);
  expect(result.artworks.page).toHaveLength(5);
  expect(result.artworks.isDone).toBe(false);
});

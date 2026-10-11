import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { DEMO_BOT_ISSUER } from "./lib/demoBot";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan } from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

afterEach(() => vi.useRealTimers());

it("keeps device, account and catalog reads inaccessible to anonymous and unregistered callers", async () => {
  const t = harness();
  const user = await signIn(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const artistId = await t.run(async (ctx) => (await ctx.db.query("artists").first())!._id);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  for (const [caller, code] of [
    [t, "unauthenticated"],
    [user.as, "device_not_registered"],
  ] as const) {
    const reads = [
      () => caller.query(api.accounts.me, {}),
      () => caller.query(api.artworks.enrichment, { artworkId }),
      () => caller.query(api.artworks.get, { artworkId }),
      () => caller.query(api.artworks.search, { query: "Monet" }),
      () => caller.query(api.artists.get, { artistId }),
      () => caller.query(api.artists.search, { query: "Monet" }),
      () => caller.query(api.artists.works, { artistId }),
      () => caller.query(api.catalog.search, { query: "Monet" }),
      () => caller.query(api.museumPicks.forVenue, { venueId, day: "2026-10-10" }),
    ];
    for (const read of reads) await expect(read()).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.accounts.unlink, {})).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.accounts.deleteAccount, {})).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.artworks.research, { artworkId })).rejects.toMatchObject({ data: { code } });
  }
}, 15_000);

it("never treats a bot issuer with a user's subject as that user", async () => {
  const t = harness();
  const owner = await seedDevice(t);
  const impostor = t.withIdentity({ issuer: DEMO_BOT_ISSUER, subject: `${owner.userId}|session` });
  await expect(impostor.query(api.devices.me, {})).rejects.toMatchObject({ data: { code: "unauthenticated" } });
  await expect(impostor.query(api.accounts.me, {})).rejects.toMatchObject({ data: { code: "unauthenticated" } });
  await expect(impostor.mutation(api.accounts.deleteAccount, {})).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  expect(await owner.as.query(api.devices.me, {})).toMatchObject({ deviceId: owner.deviceId });
});

it("hides a taken-down artwork's enrichment thumbnail before asynchronous object cleanup", async () => {
  vi.useFakeTimers();
  const t = harness();
  const viewer = await seedDevice(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  expect(await viewer.as.query(api.artworks.enrichment, { artworkId })).toHaveProperty("thumbnailUrl");
  await t.mutation(internal.revert.applyTakedown, {
    target: { kind: "artwork", artworkId },
    requester: "rights@example.org",
  });
  expect(await viewer.as.query(api.artworks.get, { artworkId })).toBeNull();
  expect(await viewer.as.query(api.artworks.enrichment, { artworkId })).not.toHaveProperty("thumbnailUrl");
});

it("hides a taken-down artwork's cached museum pick before asynchronous object cleanup", async () => {
  vi.useFakeTimers();
  const t = harness();
  const viewer = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const { artworkId, objectId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, { placement: { venueId, source: "feed", onView: true, confidence: 1 } }),
  );
  await t.run((ctx) => ctx.db.insert("museumPicks", { venueId, artworkId, objectId, score: 1 }));
  const args = { venueId, day: "2026-10-10" };
  expect(await viewer.as.query(api.museumPicks.forVenue, args)).toHaveLength(1);
  await t.mutation(internal.revert.applyTakedown, {
    target: { kind: "artwork", artworkId },
    requester: "rights@example.org",
  });
  expect(await viewer.as.query(api.museumPicks.forVenue, args)).toEqual([]);
});

it("bounds museum-pick scoring reads while checking live object eligibility", async () => {
  const t = harness({ transactionLimits: true });
  const first = await seedDevice(t);
  const second = await seedDevice(t);
  await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const { objectId } = await seedArtworkWithObject(ctx);
    const proposalId = await ctx.db.insert("placementProposals", {
      objectId,
      proposedVenueId: venueId,
      kind: "new_object",
      firstSeenAt: 1,
      lastSeenAt: 1,
      status: "promoted",
      readyForReview: true,
    });
    for (const { deviceId } of [first, second]) {
      const scanId = await seedScan(ctx, { deviceId, venueId });
      await ctx.db.insert("proposalEvidence", { proposalId, deviceId, scanId });
    }
    await ctx.db.patch("objects", objectId, { sourceProposalId: proposalId });
    for (let index = 0; index < 800; index++) {
      await ctx.db.insert("placements", {
        identityStatus: "established",
        objectId,
        venueId,
        source: "feed",
        onView: true,
        confidence: 1,
      });
    }
  });
  expect((await t.query(internal.museumPicks.scorePage, { cursor: null })).venues).toHaveLength(1);
});

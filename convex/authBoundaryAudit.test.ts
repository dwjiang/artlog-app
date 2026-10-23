import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { DEMO_BOT_ISSUER } from "./lib/demoBot";
import { fileStorage } from "./lib/fileStorage";
import {
  befriend,
  setVisitVisibility,
  socialDerivative,
  socialUser,
  socialVisit,
  type SocialUser,
} from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan } from "./lib/testFactories";
import { harness, signIn, type Harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

// Access tokens outlive these changes by up to a day, so each must take effect through live state, not token expiry.
const revocations = [
  {
    change: "sign-out",
    revoke: async (_t: Harness, viewer: SocialUser) => {
      await viewer.as.mutation(api.accounts.unlink, {});
      await viewer.as.action(api.auth.signOut, {});
    },
    sessions: 0,
    // The token still names the phone's guest device, which the same installation signs straight back in to.
    me: { status: "fulfilled", value: { linked: false } },
    post: "not_found",
    profile: "sign_in_required",
    photo: 409,
  },
  {
    change: "data deletion",
    revoke: (_t: Harness, viewer: SocialUser) => viewer.as.mutation(api.accounts.deleteAccount, {}),
    sessions: 1,
    me: { status: "rejected", reason: { data: { code: "device_not_registered" } } },
    post: "not_found",
    profile: "device_not_registered",
    photo: 403,
  },
  {
    change: "ban",
    revoke: (t: Harness, viewer: SocialUser) =>
      t.mutation(internal.revert.revertDevice, { deviceId: viewer.deviceId, reason: "spam" }),
    sessions: 1,
    me: { status: "rejected", reason: { data: { code: "device_banned" } } },
    post: "device_banned",
    profile: "device_banned",
    photo: 403,
  },
] as const;

it.each(revocations)(
  "denies social reads and private media to a still-valid token after $change",
  async ({ revoke, sessions, me, post, profile, photo }) => {
    vi.useFakeTimers();
    const t = harness();
    const owner = await socialUser(t);
    const viewer = await socialUser(t);
    await befriend(owner, viewer);
    const shared = await socialVisit(t, owner, 1);
    await socialDerivative(t, owner, shared.saves[0].id);
    await setVisitVisibility(t, owner, shared.visit._id, "friends");
    const { revision } = await owner.as.query(api.sharedVisits.getState, { visitLocalId: shared.visit.localId });
    const { postId } = await owner.as.action(api.sharedVisits.publish, {
      ...shared.selection,
      audience: "friends",
      revision,
    });
    const { itemId } = (await viewer.as.query(api.sharedVisits.get, { postId: postId! })).artworks.page[0];
    const mediaPath = `/display-media?kind=sharedVisit&postId=${postId}&itemId=${itemId}`;
    const { saves } = await socialVisit(t, viewer, 1);
    const storageId = await t.run((ctx) => fileStorage.store(ctx, new Blob(["private crop"], { type: "image/jpeg" })));
    await viewer.as.mutation(internal.collectionPhotos.attach, {
      scope: viewer.scope,
      localId: saves[0].localId,
      kind: "crop",
      storageId,
    });
    const photoPath = `/collection-photo?scope=${encodeURIComponent(viewer.scope)}&localId=${saves[0].localId}&kind=crop`;
    expect((await viewer.as.fetch(mediaPath)).status).toBe(200);
    expect((await viewer.as.fetch(photoPath)).status).toBe(200);

    await revoke(t, viewer);

    // Cleanup stays queued under fake timers, and `viewer.as` keeps presenting the identity of the unexpired token.
    const remaining = await t.run((ctx) =>
      ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", viewer.userId))
        .collect(),
    );
    expect(remaining).toHaveLength(sessions);
    expect((await Promise.allSettled([viewer.as.query(api.accounts.me, {})]))[0]).toMatchObject(me);
    await expect(viewer.as.query(api.sharedVisits.get, { postId: postId! })).rejects.toMatchObject({
      data: { code: post },
    });
    await expect(viewer.as.query(api.profiles.mine, {})).rejects.toMatchObject({ data: { code: profile } });
    expect((await viewer.as.fetch(mediaPath)).status).toBe(404);
    const response = await viewer.as.fetch(photoPath);
    expect(response.status).toBe(photo);
    expect(await response.text()).not.toContain("private crop");
  },
);

it("keeps device, account and catalog reads inaccessible to anonymous and unregistered callers", async () => {
  const t = harness();
  const user = await signIn(t);
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const artistId = await t.run(async (ctx) => (await ctx.db.query("artists").first())!._id);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const exhibitionId = await t.run((ctx) =>
    ctx.db.insert("exhibitions", {
      museumId: venueId,
      region: "US",
      titleKey: "show",
      finalEndAt: 0,
      title: "Show",
      sourceUrl: "https://museum.example/show",
      sourceSha256: "a".repeat(64),
      checkedAt: 0,
      timeZone: "UTC",
      viewingPeriods: [],
    }),
  );
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
      () => caller.query(api.wantToSee.mine, {}),
      () => caller.query(api.wantToSee.museums, {}),
    ];
    for (const read of reads) await expect(read()).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.accounts.unlink, {})).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.accounts.deleteAccount, {})).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.artworks.research, { artworkId })).rejects.toMatchObject({ data: { code } });
    await expect(caller.mutation(api.wantToSee.set, { exhibitionId, saved: true })).rejects.toMatchObject({
      data: { code },
    });
    await expect(caller.mutation(api.wantToSee.setMuseum, { museumId: venueId, saved: true })).rejects.toMatchObject({
      data: { code },
    });
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

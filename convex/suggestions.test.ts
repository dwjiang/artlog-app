import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { VisitVisibility } from "../shared/journal/contracts";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { befriend, type SocialUser, socialUser } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function artwork(t: Harness, title: string) {
  return t.run(async (ctx) => (await seedArtworkWithObject(ctx, { artwork: { title } })).artworkId);
}
async function save(t: Harness, user: SocialUser, artworkId: Id<"artworks">, title: string, visit?: VisitRef) {
  const localId = crypto.randomUUID();
  await t.run((ctx) =>
    ctx.db.insert("collections", {
      owner: { kind: "account", accountId: user.accountId },
      localId,
      artworkId,
      ...(visit ? { visitId: visit.id, visitLocalId: visit.localId, venueId: visit.venueId } : {}),
      savedAt: Date.now(),
      snapshot: { title, artist: "Claude Monet" },
      updatedAt: 1,
      updatedBy: user.deviceId,
      changeVersion: 1,
    }),
  );
  return localId;
}
async function hang(user: SocialUser, saveLocalIds: string[]) {
  const wall = await user.as.query(api.walls.getMine, {});
  return user.as.mutation(api.walls.setLayout, {
    scope: user.scope,
    revision: wall.revision,
    color: "#45524B",
    items: saveLocalIds.map((saveLocalId, layer) => ({
      placementId: crypto.randomUUID(),
      saveLocalId,
      layout: { x: 0, y: 0, width: 0.3, layer, frame: "oak" as const },
    })),
  });
}
type VisitRef = { id: Id<"visits">; localId: string; venueId: Id<"museums">; visibility: VisitVisibility };
async function visitAt(t: Harness, user: SocialUser, venueId: Id<"museums">, visibility: VisitVisibility = "public") {
  const localId = crypto.randomUUID();
  const id = await t.run(async (ctx) =>
    ctx.db.insert("visits", {
      owner: { kind: "account", accountId: user.accountId },
      localId,
      visibility,
      venueId,
      venueName: (await ctx.db.get("museums", venueId))!.name,
      visitedOn: "2026-09-20",
      timeZone: "UTC",
      updatedAt: 1,
      updatedBy: user.deviceId,
      changeVersion: 1,
    }),
  );
  return { id, localId, venueId, visibility };
}
async function share(t: Harness, user: SocialUser, visit: VisitRef) {
  const saveLocalId = await save(t, user, await artwork(t, "Nighthawks"), "Nighthawks", visit);
  const state = await user.as.action(api.sharedVisits.publish, {
    audience: visit.visibility,
    visitLocalId: visit.localId,
    saveLocalIds: [saveLocalId],
    reflection: "",
    revision: 0,
  });
  return state.postId!;
}
const suggested = async (user: SocialUser) => (await user.as.query(api.suggestions.list, {})).people;
const names = async (user: SocialUser) => (await suggested(user)).map((person) => person.profile.name);

it("ranks friends of friends first and names up to two of the mutual friends", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const [theo, sam, hana] = [await socialUser(t, "Theo"), await socialUser(t, "Sam"), await socialUser(t, "Hana")];
  const maya = await socialUser(t, "Maya");
  const omar = await socialUser(t, "Omar");
  for (const friend of [theo, sam, hana]) await befriend(viewer, friend);
  for (const friend of [theo, sam, hana]) await befriend(maya, friend);
  await befriend(omar, hana);

  const result = await viewer.as.query(api.suggestions.list, {});
  expect(result.friendCount).toBe(3);
  expect(result.people.map((person) => person.profile.name)).toEqual(["Maya", "Omar"]);
  expect(result.people[0]).toMatchObject({
    profile: { profileId: maya.profileId, relationship: { state: "none" } },
    reason: { kind: "mutual", count: 3 },
  });
  const [first] = result.people;
  expect(first.reason.kind === "mutual" && first.reason.friends).toHaveLength(2);
  expect(result.people[1].reason).toMatchObject({ kind: "mutual", count: 1, friends: [{ name: "Hana" }] });
});

it("matches a saved artwork only once the other person hangs it on their public wall", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const priya = await socialUser(t, "Priya");
  const lilies = await artwork(t, "Water Lilies");
  await save(t, viewer, lilies, "Water Lilies");
  const theirs = await save(t, priya, lilies, "Water Lilies");
  await save(t, priya, await artwork(t, "Sunflowers"), "Sunflowers");
  expect(await suggested(viewer)).toEqual([]);

  const wall = await hang(priya, [theirs]);
  expect(await suggested(viewer)).toMatchObject([
    {
      profile: { profileId: priya.profileId },
      reason: { kind: "artwork", artwork: { itemId: wall.items[0].itemId, artwork: { title: "Water Lilies" } } },
    },
  ]);
});

it("matches a museum only through a visit the viewer may read", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const jonah = await socialUser(t, "Jonah");
  const venueId = await t.run((ctx) => seedMuseum(ctx, { name: "Art Institute of Chicago" }));
  await visitAt(t, viewer, venueId);
  await share(t, jonah, await visitAt(t, jonah, venueId, "friends"));
  await visitAt(t, jonah, venueId);
  expect(await suggested(viewer)).toEqual([]);

  await share(t, jonah, await visitAt(t, jonah, venueId));
  expect(await suggested(viewer)).toMatchObject([
    { profile: { profileId: jonah.profileId }, reason: { kind: "museum", venueName: "Art Institute of Chicago" } },
  ]);
});

it("suggests people who liked the viewer's shared visit", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const elena = await socialUser(t, "Elena");
  const venueId = await t.run((ctx) => seedMuseum(ctx, { name: "The Met" }));
  const postId = await share(t, viewer, await visitAt(t, viewer, venueId));
  await elena.as.mutation(api.visitReactions.setLike, { postId, liked: true });
  expect(await suggested(viewer)).toMatchObject([
    { profile: { profileId: elena.profileId }, reason: { kind: "liked", venueName: "The Met" } },
  ]);
});

it("leaves out friends, incoming and day-old requests, blocks and dismissals, and restores a dismissal", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const theo = await socialUser(t, "Theo");
  const people = [];
  for (const name of ["Ana", "Ben", "Cy", "Di", "Ed"]) {
    const person = await socialUser(t, name);
    await befriend(theo, person);
    people.push(person);
  }
  await befriend(viewer, theo);
  const [ana, ben, cy, di, ed] = people;
  await befriend(viewer, ana);
  await viewer.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 0 });
  await cy.as.mutation(api.friendships.request, { profileId: viewer.profileId, revision: 0 });
  await di.as.mutation(api.friendships.block, { scope: di.scope, profileId: viewer.profileId });
  expect(await suggested(viewer)).toMatchObject([
    { profile: { name: "Ben", relationship: { state: "pending", requesterId: viewer.profileId } } },
    { profile: { name: "Ed", relationship: { state: "none" } } },
  ]);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  await t.finishInProgressScheduledFunctions();
  expect(await names(viewer)).toEqual(["Ed"]);

  await viewer.as.mutation(api.suggestions.dismiss, { profileId: ed.profileId });
  await viewer.as.mutation(api.suggestions.dismiss, { profileId: ed.profileId });
  expect(await names(viewer)).toEqual([]);
  await viewer.as.mutation(api.suggestions.restore, { profileId: ed.profileId });
  expect(await names(viewer)).toEqual(["Ed"]);
  await expect(viewer.as.mutation(api.suggestions.dismiss, { profileId: viewer.profileId })).rejects.toMatchObject({
    data: { code: "invalid_relationship" },
  });
});

it.each(["forward", "reverse"] as const)("honors %s blocks beyond a thousand historical records", async (direction) => {
  const t = harness({ transactionLimits: true });
  const viewer = await socialUser(t, "viewer");
  const mutual = await socialUser(t, "mutual");
  await befriend(viewer, mutual);
  await t.run(async (ctx) => {
    for (let i = 0; i < 1000; i++) {
      const accountId = await ctx.db.insert("accounts", { provider: "apple", providerUserId: `history-${i}` });
      const profileId = await ctx.db.insert("profiles", {
        accountId,
        name: "Historical profile",
        username: `history_${i}`,
        searchText: "historical profile",
        active: true,
        publishedWallCount: 0,
        leaderboardVisibility: "global",
        updatedAt: 1,
      });
      await ctx.db.insert("blocks", {
        blockerId: direction === "forward" ? viewer.profileId : profileId,
        blockedId: direction === "forward" ? profileId : viewer.profileId,
        active: false,
        revision: 2,
      });
    }
  });
  const other = await socialUser(t, "other");
  await befriend(other, mutual);
  const [blocker, blocked] = direction === "forward" ? [viewer, other] : [other, viewer];
  await blocker.as.mutation(api.friendships.block, { scope: blocker.scope, profileId: blocked.profileId });
  expect(await names(viewer)).toEqual([]);
});

it("does not let an old expiry hide a newer outgoing request", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const mutual = await socialUser(t, "mutual");
  const other = await socialUser(t, "other");
  await befriend(viewer, mutual);
  await befriend(other, mutual);
  await viewer.as.mutation(api.friendships.request, { profileId: other.profileId, revision: 0 });
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
  await viewer.as.mutation(api.friendships.cancel, { profileId: other.profileId, revision: 1 });
  await viewer.as.mutation(api.friendships.request, { profileId: other.profileId, revision: 2 });
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
  await t.finishInProgressScheduledFunctions();
  expect(await names(viewer)).toEqual(["other"]);
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
  await t.finishInProgressScheduledFunctions();
  expect(await names(viewer)).toEqual([]);
  expect(await viewer.as.query(api.friendships.getState, { profileId: other.profileId })).toMatchObject({
    state: "pending",
    revision: 3,
  });
});

it("requires a profile", async () => {
  const t = harness();
  const guest = await seedDevice(t);
  const other = await socialUser(t);
  await expect(guest.as.query(api.suggestions.list, {})).rejects.toMatchObject({
    data: { code: "sign_in_required" },
  });
  await expect(guest.as.query(api.suggestions.inCommonWith, { profileId: other.profileId })).rejects.toMatchObject({
    data: { code: "sign_in_required" },
  });
});

it("lists public-wall artworks and readable museums in common, and nothing across a block", async () => {
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const priya = await socialUser(t, "Priya");
  const lilies = await artwork(t, "Water Lilies");
  const stars = await artwork(t, "The Starry Night");
  await save(t, viewer, lilies, "Water Lilies");
  await save(t, viewer, stars, "The Starry Night");
  const wall = await hang(priya, [
    await save(t, priya, lilies, "Water Lilies"),
    await save(t, priya, await artwork(t, "Sunflowers"), "Sunflowers"),
  ]);
  await save(t, priya, stars, "The Starry Night");
  const shared = await t.run((ctx) => seedMuseum(ctx, { name: "MoMA", city: "New York" }));
  const elsewhere = await t.run((ctx) => seedMuseum(ctx, { name: "Tate" }));
  await visitAt(t, viewer, shared);
  await share(t, priya, await visitAt(t, priya, shared));
  await share(t, priya, await visitAt(t, priya, elsewhere));

  expect(await viewer.as.query(api.suggestions.inCommonWith, { profileId: priya.profileId })).toMatchObject({
    artworks: [{ itemId: wall.items[0].itemId, artwork: { title: "Water Lilies" } }],
    museums: [{ venueId: shared, name: "MoMA", city: "New York" }],
  });
  expect((await viewer.as.query(api.suggestions.inCommonWith, { profileId: priya.profileId })).artworks).toHaveLength(
    1,
  );
  await priya.as.mutation(api.friendships.block, { scope: priya.scope, profileId: viewer.profileId });
  expect(await viewer.as.query(api.suggestions.inCommonWith, { profileId: priya.profileId })).toEqual({
    artworks: [],
    museums: [],
  });
});

it("purges dismissals in both directions when an account is deleted", async () => {
  vi.useFakeTimers();
  const t = harness();
  const viewer = await socialUser(t, "viewer");
  const other = await socialUser(t, "other");
  await viewer.as.mutation(api.suggestions.dismiss, { profileId: other.profileId });
  await other.as.mutation(api.suggestions.dismiss, { profileId: viewer.profileId });
  await viewer.as.mutation(api.accounts.deleteAccount, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("suggestionDismissals").collect())).toEqual([]);
  vi.useRealTimers();
});

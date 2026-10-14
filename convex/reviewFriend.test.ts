import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { fileStorage } from "./lib/fileStorage";
import { socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedJournalVisit, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const at = Date.UTC(2026, 8, 20, 15);

async function seedReviewFriend(t: Harness, visibility: "friends" | "public" = "friends") {
  const { venueId, photo } = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx, { key: "wikidata:Q160236", name: "Metropolitan Museum of Art" });
    await seedArtworkWithObject(ctx, {
      artwork: { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", date: "1889" },
      object: { key: "met:436535" },
      placement: { venueId, gallery: "822", onView: true, source: "feed", confidence: 1 },
    });
    const photo = await fileStorage.store(
      ctx,
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }),
    );
    return { venueId, photo };
  });
  const postId = crypto.randomUUID();
  const profileId = await t.mutation(internal.reviewFriend.seed, {
    username: "testfriend",
    name: "Test Friend",
    avatar: "vermeer",
    visits: [
      {
        visibility,
        localId: crypto.randomUUID(),
        venueKey: "wikidata:Q160236",
        visitedOn: "2026-09-20",
        timeZone: "America/New_York",
        startedAt: at,
        endedAt: at + 7_200_000,
        reflection: "Stayed for the cypresses.",
        post: { postId, publishedAt: at + 10_800_000 },
        saves: [
          {
            localId: crypto.randomUUID(),
            objectKey: "met:436535",
            savedAt: at + 600_000,
            photos: [{ localId: crypto.randomUUID(), storageId: photo, width: 1080, height: 1440, capturedAt: at }],
          },
        ],
      },
    ],
  });
  return { profileId, postId, venueId };
}

async function addFriend(user: SocialUser, profileId: SocialUser["profileId"]) {
  const { revision } = await user.as.query(api.friendships.getState, { profileId });
  return user.as.mutation(api.friendships.request, { profileId, revision });
}

it("accepts a request at once, so one reviewer can read its visit, name it as company and mention it", async () => {
  const t = harness();
  const friend = await seedReviewFriend(t);
  const reviewer = await socialUser(t, "reviewer");
  await expect(reviewer.as.query(api.sharedVisits.get, { postId: friend.postId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });

  expect(await addFriend(reviewer, friend.profileId)).toMatchObject({ state: "accepted", requesterId: null });
  const notices = (await reviewer.as.query(api.notifications.list, {})).page;
  expect(notices.map((notice) => [notice.kind, notice.actor.username])).toEqual([["friendAccepted", "testfriend"]]);
  expect(await reviewer.as.query(api.sharedVisits.get, { postId: friend.postId })).toMatchObject({
    author: { username: "testfriend" },
    reflection: "Stayed for the cypresses.",
  });

  const visit = await socialVisit(t, reviewer);
  const reflection = "Went back with @testfriend";
  await t.run((ctx) => ctx.db.patch("visits", visit.visit._id, { visibility: "friends", reflection }));
  const { postId } = await reviewer.as.action(api.sharedVisits.publish, {
    ...visit.selection,
    audience: "friends",
    reflection,
    companionIds: [friend.profileId],
  });
  const shared = await reviewer.as.query(api.sharedVisits.get, { postId: postId! });
  expect(shared.companions.map((person) => person.username)).toEqual(["testfriend"]);
  expect(shared.mentions.map((person) => person.username)).toEqual(["testfriend"]);
  const profilePosts = await reviewer.as.query(api.sharedVisits.listByProfile, { profileId: friend.profileId });
  expect(profilePosts.page.map((post) => post.postId)).toEqual(expect.arrayContaining([postId, friend.postId]));
});

it("is found only by its exact username", async () => {
  const t = harness();
  const friend = await seedReviewFriend(t);
  const stranger = await socialUser(t, "stranger");
  const found = async (query: string) =>
    (await stranger.as.query(api.profiles.search, { query })).page.map((person) => person.username);

  expect(await found("Test Friend")).toEqual([]);
  expect(await found("testfriend")).toEqual(["testfriend"]);
  expect((await stranger.as.query(api.profiles.discover, {})).page.map((person) => person.username)).not.toContain(
    "testfriend",
  );
  const mentionable = async () =>
    (
      await stranger.as.query(api.mentions.suggest, {
        query: "test",
        place: { kind: "visit", audience: "public", companionIds: [] },
      })
    ).map((row) => row.profile.username);
  expect(await mentionable()).toEqual([]);
  await addFriend(stranger, friend.profileId);
  expect(await mentionable()).toEqual(["testfriend"]);
});

it("keeps everyone who added it apart, and stays off leaderboards and out of the demo cleanup", async () => {
  const t = harness();
  const friend = await seedReviewFriend(t, "public");
  const first = await socialUser(t, "first");
  const second = await socialUser(t, "second");
  await addFriend(first, friend.profileId);
  await addFriend(second, friend.profileId);

  const friends = await first.as.query(api.profiles.friends, { profileId: friend.profileId });
  expect(friends?.map((person) => person.username)).toEqual(["u_first"]);
  expect((await first.as.query(api.suggestions.list, {})).people).toEqual([]);
  // A shared museum with its public visit does not suggest it to a stranger either.
  const stranger = await socialUser(t, "stranger");
  await t.run((ctx) =>
    seedJournalVisit(ctx, stranger.deviceId, friend.venueId, {
      owner: { kind: "account", accountId: stranger.accountId },
    }),
  );
  expect((await stranger.as.query(api.suggestions.list, {})).people).toEqual([]);

  const board = await t.query(api.leaderboards.list, { metric: "visits", audience: "global" });
  expect(board.rows.map((row) => row.profile.username)).not.toContain("testfriend");
  await t.mutation(internal.demoSeed.clear, {});
  expect(await t.query(api.profiles.getPublic, { profileId: friend.profileId })).toMatchObject({
    username: "testfriend",
  });
});

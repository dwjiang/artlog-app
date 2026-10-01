import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
const at = Date.UTC(2026, 8, 20, 15);
const layout = { x: 0.1, y: 0.2, width: 0.4, layer: 0, frame: "gilt" as const };

async function corpus(t: Harness) {
  return t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx, { key: "wikidata:Q160236", name: "Metropolitan Museum of Art" });
    const elsewhere = await seedMuseum(ctx, { key: "wikidata:Q239303", name: "Art Institute of Chicago" });
    const work = await seedArtworkWithObject(ctx, {
      artwork: { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", date: "1889" },
      object: { key: "met:436535" },
      placement: { venueId, gallery: "822", onView: true, source: "feed", confidence: 1 },
    });
    await seedArtworkWithObject(ctx, {
      object: { key: "aic:16568" },
      placement: { venueId: elsewhere, onView: true, source: "feed", confidence: 1 },
    });
    const files = [];
    for (let i = 0; i < 6; i++) files.push(await fileStorage.store(ctx, jpeg()));
    return { work, files };
  });
}

function person(
  username: string,
  files: Id<"files">[],
  options: { visibility: "public" | "friends"; wall?: boolean; avatar?: boolean },
) {
  const save = crypto.randomUUID();
  const photo = crypto.randomUUID();
  return {
    username,
    name: username.charAt(0).toUpperCase() + username.slice(1),
    bio: "Mostly here for the Dutch rooms.",
    ...(options.avatar ? { avatarId: files[2] } : {}),
    leaderboardVisibility: "global" as const,
    joinedAt: at - 86_400_000,
    visits: [
      {
        visibility: options.visibility,
        localId: crypto.randomUUID(),
        venueKey: "wikidata:Q160236",
        visitedOn: "2026-09-20",
        timeZone: "America/New_York",
        startedAt: at,
        endedAt: at + 7_200_000,
        reflection: "The cypresses look like they are still moving.",
        post: { postId: crypto.randomUUID(), publishedAt: at + 10_800_000 },
        saves: [
          {
            localId: save,
            objectKey: "met:436535",
            savedAt: at + 600_000,
            photos: [{ localId: photo, storageId: files[0], width: 1080, height: 1440, capturedAt: at + 590_000 }],
            crop: { storageId: files[1], width: 512, height: 404 },
          },
        ],
      },
    ],
    ...(options.wall
      ? {
          wall: {
            color: "#cdd0ca",
            pattern: "stripe" as const,
            items: [{ placementId: crypto.randomUUID(), saveLocalId: save, photoLocalId: photo, layout }],
          },
        }
      : {}),
  };
}

it("seeds people whose visits, photos, walls, friends and scores show in every social surface", async () => {
  const t = harness();
  const { files } = await corpus(t);
  const alice = person("alice", files, { visibility: "public", wall: true, avatar: true });
  const bob = person("bob", files, { visibility: "friends" });
  const aliceId = await t.mutation(internal.demoSeed.seedPerson, alice);
  await t.mutation(internal.demoSeed.seedPerson, bob);
  const alicePost = alice.visits[0].post.postId;
  const bobPost = bob.visits[0].post.postId;
  // Without the friendship, bob's friends-only visit is not Alice's to like.
  await expect(
    t.mutation(internal.demoSeed.seedSocial, {
      friendships: [],
      likes: [{ username: "alice", postId: bobPost }],
      comments: [],
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  await t.mutation(internal.demoSeed.seedSocial, {
    friendships: [{ from: "bob", to: "alice", state: "accepted", at }],
    likes: [
      { username: "bob", postId: alicePost },
      { username: "alice", postId: bobPost },
    ],
    comments: [{ username: "bob", postId: alicePost, body: "  Going back for this one.  " }],
  });

  const feed = await t.query(api.sharedVisits.listPublic, {});
  expect(feed.page.map((post) => post.postId)).toEqual([alicePost]);
  const [card] = feed.page[0].artworks.page;
  expect(feed.page[0]).toMatchObject({
    author: { username: "alice", photoUrl: expect.stringContaining("/file?id=") },
    venue: { name: "Metropolitan Museum of Art" },
    reflection: "The cypresses look like they are still moving.",
  });
  expect(card.artwork).toMatchObject({
    title: "Wheat Field with Cypresses",
    artist: "Vincent van Gogh",
    media: { kind: "photo", width: 1080, height: 1440 },
  });
  const context = {
    kind: "sharedVisit" as const,
    postId: alicePost,
    itemId: card.itemId,
    photoLocalId: alice.visits[0].saves[0].photos[0].localId,
  };
  expect(await t.query(internal.sharedMedia.authorize, { context })).toBe(files[0]);
  expect(await t.query(api.visitReactions.getSummary, { postId: alicePost })).toMatchObject({
    likeCount: 1,
    commentCount: 1,
  });
  expect((await t.query(api.visitReactions.listComments, { postId: alicePost })).page[0].body).toBe(
    "Going back for this one.",
  );

  const wall = await t.query(api.walls.getPublic, { profileId: aliceId });
  expect(wall).toMatchObject({ color: "#CDD0CA", pattern: "stripe", artworkCount: 1 });
  expect(wall!.items[0].artwork.media).toMatchObject({
    kind: "photo",
    width: 512,
    reference: { variant: "crop", cropRevision: alice.visits[0].saves[0].savedAt },
  });
  const leaderboard = await t.query(api.leaderboards.list, { metric: "artworks", audience: "global" });
  expect(leaderboard.rows.map((row) => [row.profile.username, row.score])).toEqual([
    ["alice", 1],
    ["bob", 1],
  ]);
  const save = await t.run(async (ctx) =>
    (await ctx.db.query("collections").collect()).find((row) => row.localId === alice.visits[0].saves[0].localId),
  );
  expect(save).toMatchObject({
    gallery: "822",
    venueName: "Metropolitan Museum of Art",
    snapshot: { title: "Wheat Field with Cypresses", institution: "Metropolitan Museum of Art", date: "1889" },
  });

  // A real user only sees the friends-only visit once they are friends with its author.
  const viewer = await socialUser(t, "viewer");
  await expect(viewer.as.query(api.sharedVisits.get, { postId: bobPost })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  expect((await viewer.as.query(api.profiles.discover, {})).page.map((row) => row.username)).toEqual(
    expect.arrayContaining(["alice", "bob"]),
  );
});

it("rejects a save at a different museum and a repeated username", async () => {
  const t = harness();
  const { files } = await corpus(t);
  const misplaced = person("carol", files, { visibility: "public" });
  misplaced.visits[0].saves[0].objectKey = "aic:16568";
  await expect(t.mutation(internal.demoSeed.seedPerson, misplaced)).rejects.toMatchObject({
    data: { code: "invalid_object" },
  });
  await t.mutation(internal.demoSeed.seedPerson, person("dana", files, { visibility: "public" }));
  await expect(
    t.mutation(internal.demoSeed.seedPerson, person("dana", files, { visibility: "public" })),
  ).rejects.toMatchObject({ data: { code: "demo_exists" } });
  expect(
    await t.query(internal.demoSeed.inspect, {
      objectKeys: ["met:436535", "met:0"],
      venueKeys: ["wikidata:Q160236", "wikidata:Q0"],
    }),
  ).toEqual({ missingObjects: ["met:0"], missingVenues: ["wikidata:Q0"], demoAccounts: 1 });
});

it("rejects a reused post ID while preserving the original public post", async () => {
  const t = harness();
  const { files } = await corpus(t);
  const alice = person("alice", files, { visibility: "public" });
  const bob = person("bob", files, { visibility: "public" });
  const { postId } = alice.visits[0].post;
  bob.visits[0].post.postId = postId;
  await t.mutation(internal.demoSeed.seedPerson, alice);

  await expect(t.mutation(internal.demoSeed.seedPerson, bob)).rejects.toMatchObject({
    data: { code: "invalid_post" },
  });
  expect(await t.query(api.sharedVisits.get, { postId })).toMatchObject({ author: { username: "alice" } });
  expect(await t.query(internal.demoSeed.inspect, { objectKeys: [], venueKeys: [] })).toMatchObject({
    demoAccounts: 1,
  });
});

it("rolls back a person whose visits reuse the same post ID", async () => {
  const t = harness();
  const { files } = await corpus(t);
  const alice = person("alice", files, { visibility: "public" });
  const anotherVisit = person("alice", files, { visibility: "public" }).visits[0];
  anotherVisit.post.postId = alice.visits[0].post.postId;
  alice.visits.push(anotherVisit);

  await expect(t.mutation(internal.demoSeed.seedPerson, alice)).rejects.toMatchObject({
    data: { code: "invalid_post" },
  });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(await t.query(internal.demoSeed.inspect, { objectKeys: [], venueKeys: [] })).toMatchObject({
    demoAccounts: 0,
  });
});

it.each([
  { scenario: "within a batch", copies: 2, runs: 1 },
  { scenario: "across retries", copies: 1, runs: 2 },
])("counts a person's like once when repeated $scenario", async ({ copies, runs }) => {
  const t = harness();
  const { files } = await corpus(t);
  const alice = person("alice", files, { visibility: "public" });
  const { postId } = alice.visits[0].post;
  await t.mutation(internal.demoSeed.seedPerson, alice);
  await t.mutation(internal.demoSeed.seedPerson, person("bob", files, { visibility: "public" }));

  for (let run = 0; run < runs; run++) {
    await t.mutation(internal.demoSeed.seedSocial, {
      friendships: [],
      likes: Array.from({ length: copies }, () => ({ username: "bob", postId })),
      comments: [],
    });
  }

  expect(await t.query(api.visitReactions.getSummary, { postId })).toMatchObject({ likeCount: 1 });
  expect((await t.query(api.visitReactions.listLikes, { postId })).page.map((profile) => profile.username)).toEqual([
    "bob",
  ]);
});

it("clears demo people with their journals, posts and reactions while keeping real users", async () => {
  vi.useFakeTimers();
  const t = harness();
  const { files } = await corpus(t);
  const alice = person("alice", files, { visibility: "public", wall: true, avatar: true });
  await t.mutation(internal.demoSeed.seedPerson, alice);
  const viewer = await socialUser(t, "viewer");
  const friend = await socialUser(t, "friend");
  await befriend(viewer, friend);
  await viewer.as.mutation(api.visitReactions.setLike, { postId: alice.visits[0].post.postId, liked: true });

  expect(await t.mutation(internal.demoSeed.clear, {})).toBe(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const remaining = await t.run(async (ctx) => ({
    profiles: (await ctx.db.query("profiles").collect()).map((row) => row.username).sort(),
    accounts: (await ctx.db.query("accounts").collect()).length,
    visits: (await ctx.db.query("visits").collect()).length,
    saves: (await ctx.db.query("collections").collect()).length,
    photos: (await ctx.db.query("artworkPhotos").collect()).length,
    posts: (await ctx.db.query("sharedVisits").collect()).length,
    likes: (await ctx.db.query("visitLikes").collect()).length,
    walls: (await ctx.db.query("wallItems").collect()).length,
    orphanScores: (
      await Promise.all(
        (await ctx.db.query("leaderboardScores").collect()).map((row) => ctx.db.get("accounts", row.accountId)),
      )
    ).filter((account) => !account).length,
    friendships: (await ctx.db.query("friendships").collect()).length,
    seededFiles: (await Promise.all(files.slice(0, 3).map((id) => ctx.db.get("files", id)))).filter(Boolean),
  }));
  expect(remaining).toEqual({
    profiles: ["u_friend", "u_viewer"],
    accounts: 2,
    visits: 0,
    saves: 0,
    photos: 0,
    posts: 0,
    likes: 0,
    walls: 0,
    orphanScores: 0,
    friendships: 1,
    seededFiles: [],
  });
});

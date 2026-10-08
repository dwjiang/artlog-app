import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDate, LIMITS } from "../shared/journal/limits";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEMO_BOT_ISSUER } from "./lib/demoBot";
import { fileStorage } from "./lib/fileStorage";
import { socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

type Activity = FunctionArgs<typeof api.demoActivity.publish>["activity"];
type PostActivity = Extract<Activity, { kind: "post" }>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MET = "wikidata:Q160236";
const AIC = "wikidata:Q239303";
const BOT = { issuer: DEMO_BOT_ISSUER, subject: "artlog-bot" };
const TITLES = ["Wheat Field with Cypresses", "The Harvesters", "Madame X", "The Death of Socrates", "Cypresses"];

beforeEach(() => vi.stubEnv("FLAG_DEMO_ACTIVITY", "on"));
afterEach(() => vi.unstubAllEnvs());

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });

async function world(t = harness()) {
  const venues = await t.run(async (ctx) => {
    const met = await seedMuseum(ctx, {
      key: MET,
      name: "Metropolitan Museum of Art",
      lat: 40.7794,
      lng: -73.9632,
      city: "New York",
      country: "US",
    });
    const aic = await seedMuseum(ctx, { key: AIC, name: "Art Institute of Chicago", lat: 41.8796, lng: -87.6237 });
    for (const [index, title] of TITLES.entries()) {
      await seedArtworkWithObject(ctx, {
        artwork: { title, artist: "Old Master" },
        object: { key: `met:${index}` },
        placement: { venueId: met, gallery: `80${index}`, onView: true, source: "feed", confidence: 1 },
      });
    }
    await seedArtworkWithObject(ctx, {
      object: { key: "aic:1" },
      placement: { venueId: aic, onView: true, source: "feed", confidence: 1 },
    });
    return { met, aic };
  });
  for (const username of ["alice", "bob", "cara"]) {
    await t.mutation(internal.demoSeed.seedPerson, {
      username,
      name: username.charAt(0).toUpperCase() + username.slice(1),
      bio: "Here for the Dutch rooms.",
      avatar: "vermeer",
      leaderboardVisibility: "global",
      joinedAt: Date.now() - 30 * DAY,
      visits: [],
    });
  }
  await t.mutation(internal.demoSeed.seedSocial, {
    friendships: [{ from: "alice", to: "bob", state: "accepted", at: Date.now() - DAY }],
    likes: [],
    comments: [],
  });
  return { t, bot: t.withIdentity(BOT), ...venues };
}

/** Photos as uploadPhoto leaves them: stored, unattached and registered for the bot. */
function uploads(t: Harness, count: number) {
  return t.run(async (ctx) => {
    const ids: Id<"files">[] = [];
    for (let i = 0; i < count; i++) {
      const id = await fileStorage.store(ctx, jpeg());
      await ctx.db.insert("demoPhotos", { fileId: id, width: 1536, height: 2048 });
      ids.push(id);
    }
    return ids;
  });
}

async function postActivity(t: Harness, overrides: Partial<PostActivity> = {}): Promise<PostActivity> {
  const now = Date.now();
  const [first, second] = await uploads(t, 2);
  return {
    kind: "post",
    submissionId: crypto.randomUUID(),
    author: "alice",
    venueKey: MET,
    startedAt: now - 3 * HOUR,
    endedAt: now - HOUR,
    audience: "public",
    reflection: "  The cypresses look like they are still moving.  ",
    artworks: [
      { objectKey: "met:0", note: "Thicker paint than I expected.", photoIds: [first] },
      { objectKey: "met:1", photoIds: [second] },
    ],
    ...overrides,
  };
}

const comment = (postId: string, overrides: Partial<Extract<Activity, { kind: "comment" }>> = {}) => ({
  kind: "comment" as const,
  submissionId: crypto.randomUUID(),
  author: "bob",
  postId,
  body: "Going back for this one.",
  ...overrides,
});

describe("authorization", () => {
  it("admits only the bot's service token, and only while the flag is on", async () => {
    const { t, bot } = await world();
    const viewer = await socialUser(t, "viewer");
    const activity = { activity: await postActivity(t) };
    const context = { since: Date.now() - DAY };
    const impostor = t.withIdentity({ issuer: DEMO_BOT_ISSUER, subject: "someone-else" });
    for (const caller of [t, viewer.as, impostor]) {
      await expect(caller.query(api.demoActivity.getContext, context)).rejects.toMatchObject({
        data: { code: "unauthenticated" },
      });
      await expect(caller.query(api.demoActivity.listVenueArtworks, { venueKey: MET })).rejects.toMatchObject({
        data: { code: "unauthenticated" },
      });
      await expect(caller.action(api.demoActivity.publish, activity)).rejects.toMatchObject({
        data: { code: "unauthenticated" },
      });
    }

    vi.stubEnv("FLAG_DEMO_ACTIVITY", "off");
    await expect(bot.query(api.demoActivity.getContext, context)).rejects.toMatchObject({
      data: { code: "feature_off" },
    });
    await expect(bot.action(api.demoActivity.publish, activity)).rejects.toMatchObject({
      data: { code: "feature_off" },
    });
    expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toEqual([]);
  });

  it("trusts the bot's keys, for its own issuer and audience, only when the deployment sets them", async () => {
    vi.stubEnv("DEMO_BOT_JWKS", undefined);
    vi.resetModules();
    expect((await import("./auth.config")).default.providers).toHaveLength(1);
    vi.stubEnv("DEMO_BOT_JWKS", "data:text/plain;charset=utf-8;base64,e30=");
    vi.resetModules();
    expect((await import("./auth.config")).default.providers[1]).toEqual({
      type: "customJwt",
      issuer: "https://artlog-bot.invalid/bot",
      applicationID: "artlog-demo-activity",
      jwks: "data:text/plain;charset=utf-8;base64,e30=",
      algorithm: "ES256",
    });
  });

  it("reads the bot's token as signed out in every other function", async () => {
    const { bot } = await world();
    expect(await bot.query(api.devices.sessionRevoked, {})).toBe(false);
    await expect(bot.query(api.sharedVisits.listShared, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    expect(await bot.query(api.sharedVisits.listPublic, {})).toMatchObject({ page: [] });
  });
});

describe("demo-only rules", () => {
  it("acts only as demo accounts, on demo posts each author can read", async () => {
    const { t, bot } = await world();
    const viewer = await socialUser(t, "viewer");
    const realVisit = await socialVisit(t, viewer);
    const realPost = await viewer.as.action(api.sharedVisits.publish, realVisit.selection);
    const friendsOnly = await postActivity(t, { audience: "friends" });
    await bot.action(api.demoActivity.publish, { activity: friendsOnly });
    const open = await postActivity(t, { author: "bob" });
    await bot.action(api.demoActivity.publish, { activity: open });

    const rejected = [
      { activity: await postActivity(t, { author: "u_viewer" }), code: "not_found" },
      { activity: { kind: "like" as const, author: "bob", postId: realPost.postId! }, code: "not_found" },
      { activity: comment(realPost.postId!), code: "not_found" },
      // Cara is not Alice's friend, so the friends-only post is not hers to read.
      { activity: { kind: "like" as const, author: "cara", postId: friendsOnly.submissionId }, code: "not_found" },
      { activity: comment(friendsOnly.submissionId, { author: "cara" }), code: "not_found" },
      { activity: comment(open.submissionId, { body: "@u_viewer look at this" }), code: "invalid_mention" },
      { activity: await postActivity(t, { reflection: "With @nobody_here today" }), code: "invalid_mention" },
    ];
    for (const { activity, code } of rejected) {
      await expect(bot.action(api.demoActivity.publish, { activity })).rejects.toMatchObject({ data: { code } });
    }

    await bot.action(api.demoActivity.publish, {
      activity: { kind: "like", author: "bob", postId: friendsOnly.submissionId },
    });
    await bot.action(api.demoActivity.publish, {
      activity: comment(open.submissionId, { author: "alice", body: "Same room as @cara last week" }),
    });
    const notified = await t.run(async (ctx) =>
      Promise.all(
        (await ctx.db.query("notifications").collect()).map(async (row) => ({
          kind: row.event.kind,
          to: (await ctx.db.get("profiles", row.recipientId))?.username,
        })),
      ),
    );
    // The seeded friendship's own notice aside, every recipient is a demo account.
    const fromActivity = notified.filter((row) => row.kind !== "friendAccepted");
    expect(fromActivity.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: "commentMention", to: "cara" },
      { kind: "visitComment", to: "bob" },
      { kind: "visitLike", to: "alice" },
    ]);
  });
});

describe("validation", () => {
  it("rejects posts that break a limit or name a work, venue or photo it may not use", async () => {
    const { t, bot } = await world();
    const now = Date.now();
    const [attached] = await uploads(t, 1);
    await bot.action(api.demoActivity.publish, {
      activity: await postActivity(t, { artworks: [{ objectKey: "met:0", photoIds: [attached] }] }),
    });
    const [shared] = await uploads(t, 1);
    const plainFile = await t.run((ctx) => fileStorage.store(ctx, jpeg()));
    const photos = await uploads(t, 4);
    const cases: [string, Partial<PostActivity>][] = [
      ["invalid_activity", { submissionId: "not-a-uuid" }],
      ["invalid_activity", { startedAt: now - 15 * DAY, endedAt: now - 15 * DAY + HOUR }],
      ["invalid_activity", { startedAt: now - 13 * HOUR, endedAt: now - 30_000 }],
      ["invalid_activity", { startedAt: now - HOUR, endedAt: now + HOUR }],
      ["invalid_activity", { startedAt: now - HOUR, endedAt: now - HOUR }],
      ["invalid_activity", { reflection: "   " }],
      ["invalid_activity", { reflection: "x".repeat(20_001) }],
      ["invalid_activity", { artworks: [] }],
      [
        "invalid_activity",
        { artworks: TITLES.concat("x", "y").map((_, i) => ({ objectKey: `met:${i}`, photoIds: [photos[0]] })) },
      ],
      ["invalid_activity", { artworks: [{ objectKey: "met:0", photoIds: photos }] }],
      [
        "invalid_activity",
        {
          artworks: [
            { objectKey: "met:0", photoIds: [shared] },
            { objectKey: "met:1", photoIds: [shared] },
          ],
        },
      ],
      [
        "invalid_activity",
        {
          artworks: [
            { objectKey: "met:0", photoIds: [photos[0]] },
            { objectKey: "met:0", photoIds: [photos[1]] },
          ],
        },
      ],
      ["invalid_venue", { venueKey: "wikidata:Q0" }],
      ["invalid_object", { artworks: [{ objectKey: "aic:1", photoIds: [shared] }] }],
      ["invalid_object", { artworks: [{ objectKey: "met:404", photoIds: [shared] }] }],
      ["photo_unavailable", { artworks: [{ objectKey: "met:0", photoIds: [plainFile] }] }],
      ["photo_unavailable", { artworks: [{ objectKey: "met:0", photoIds: [attached] }] }],
      ["reflection_not_allowed", { reflection: "What a load of shit" }],
    ];
    for (const [code, overrides] of cases) {
      const activity = await postActivity(t, overrides);
      await expect(bot.action(api.demoActivity.publish, { activity })).rejects.toMatchObject({ data: { code } });
    }
    const [{ postId }] = (await bot.query(api.demoActivity.getContext, { since: now - DAY })).posts;
    for (const [code, body] of [
      ["invalid_comment", "   "],
      ["invalid_comment", "x".repeat(1001)],
      ["comment_not_allowed", "What a load of shit"],
    ]) {
      await expect(bot.action(api.demoActivity.publish, { activity: comment(postId, { body }) })).rejects.toMatchObject(
        { data: { code } },
      );
    }
    await expect(bot.query(api.demoActivity.getContext, { since: now - 31 * DAY })).rejects.toMatchObject({
      data: { code: "invalid_activity" },
    });
    expect(await t.run(async (ctx) => (await ctx.db.query("sharedVisits").collect()).length)).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("visits").collect()).length)).toBe(1);
  });
});

it("forgets an unclaimed upload when its file lease runs out", async () => {
  vi.useFakeTimers();
  const t = harness();
  const [photoId] = await uploads(t, 1);
  await t.mutation(internal.files.discard, { id: photoId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("demoPhotos").collect())).toEqual([]);
  vi.useRealTimers();
});

describe("duplicate submissions", () => {
  it("answers a repeated post with the original and rejects a changed one", async () => {
    const { t, bot } = await world();
    const activity = await postActivity(t);
    expect(await bot.action(api.demoActivity.publish, { activity })).toEqual({
      status: "created",
      postId: activity.submissionId,
    });
    // A retry after the upload lease ran out carries new photo IDs for the same post.
    const reuploaded = await uploads(t, 2);
    const retry = {
      ...activity,
      artworks: activity.artworks.map((artwork, i) => ({ ...artwork, photoIds: [reuploaded[i]] })),
    };
    expect(await bot.action(api.demoActivity.publish, { activity: retry })).toEqual({
      status: "unchanged",
      postId: activity.submissionId,
    });
    for (const changed of [
      { ...activity, reflection: "Something else entirely." },
      { ...activity, author: "bob" },
      { ...activity, audience: "friends" as const },
      { ...activity, artworks: activity.artworks.slice(0, 1) },
    ]) {
      await expect(bot.action(api.demoActivity.publish, { activity: changed })).rejects.toMatchObject({
        data: { code: "conflict" },
      });
    }
    const rows = await t.run(async (ctx) => ({
      posts: (await ctx.db.query("sharedVisits").collect()).length,
      visits: (await ctx.db.query("visits").collect()).length,
      saves: (await ctx.db.query("collections").collect()).length,
    }));
    expect(rows).toEqual({ posts: 1, visits: 1, saves: 2 });
  });

  it("publishes concurrent copies of one submission once", async () => {
    const { t, bot } = await world();
    const activity = await postActivity(t);
    const receipts = await Promise.all([
      bot.action(api.demoActivity.publish, { activity }),
      bot.action(api.demoActivity.publish, { activity }),
    ]);
    expect(receipts.map((receipt) => receipt.status).sort()).toEqual(["created", "unchanged"]);
    expect(await t.run(async (ctx) => (await ctx.db.query("sharedVisits").collect()).length)).toBe(1);
  });

  it("keeps one comment per submission and one like per person", async () => {
    const { t, bot } = await world();
    const post = await postActivity(t);
    await bot.action(api.demoActivity.publish, { activity: post });
    const activity = comment(post.submissionId);
    const created = await bot.action(api.demoActivity.publish, { activity });
    expect(created).toMatchObject({ status: "created", postId: post.submissionId, commentId: expect.any(String) });
    expect(await bot.action(api.demoActivity.publish, { activity })).toEqual({ ...created, status: "unchanged" });
    for (const changed of [
      { ...activity, body: "Something else." },
      { ...activity, author: "cara" },
    ]) {
      await expect(bot.action(api.demoActivity.publish, { activity: changed })).rejects.toMatchObject({
        data: { code: "conflict" },
      });
    }
    const like = { kind: "like" as const, author: "cara", postId: post.submissionId };
    expect(await bot.action(api.demoActivity.publish, { activity: like })).toEqual({
      status: "created",
      postId: post.submissionId,
    });
    expect(await bot.action(api.demoActivity.publish, { activity: like })).toEqual({
      status: "unchanged",
      postId: post.submissionId,
    });
    expect(await t.query(api.visitReactions.getSummary, { postId: post.submissionId })).toMatchObject({
      likeCount: 1,
      commentCount: 1,
    });
  });
});

describe("feed behavior", () => {
  it("publishes a visit the way the share flow does", async () => {
    const { t, bot, met } = await world();
    const activity = await postActivity(t);
    const photoIds = activity.artworks.flatMap((artwork) => artwork.photoIds);
    const before = Date.now();
    await bot.action(api.demoActivity.publish, { activity });

    const feed = await t.query(api.sharedVisits.listPublic, {});
    expect(feed.page).toHaveLength(1);
    expect(feed.page[0]).toMatchObject({
      postId: activity.submissionId,
      author: { username: "alice" },
      venue: { name: "Metropolitan Museum of Art" },
      reflection: "The cypresses look like they are still moving.",
    });
    expect(feed.page[0].artworks.page.map((card) => [card.artwork.title, card.artwork.media])).toEqual([
      [TITLES[0], expect.objectContaining({ kind: "photo", width: 1536, height: 2048 })],
      [TITLES[1], expect.objectContaining({ kind: "photo", width: 1536, height: 2048 })],
    ]);

    const stored = await t.run(async (ctx) => {
      const post = (await ctx.db.query("sharedVisits").first())!;
      const visit = (await ctx.db.get("visits", post.visitId))!;
      const saves = (await ctx.db.query("collections").collect()).sort((a, b) => a.savedAt - b.savedAt);
      return {
        post,
        visit,
        saves,
        photos: await ctx.db.query("artworkPhotos").collect(),
        files: await Promise.all(photoIds.map((id) => ctx.db.get("files", id))),
        pendingUploads: (await ctx.db.query("demoPhotos").collect()).length,
      };
    });
    expect(stored.post.publishedAt).toBeGreaterThanOrEqual(before);
    expect(stored.post).not.toHaveProperty("companionSelections");
    expect(stored.visit).toMatchObject({
      venueId: met,
      timeZone: "America/New_York",
      visitedOn: calendarDate(activity.startedAt, "America/New_York"),
      startedAt: activity.startedAt,
      endedAt: activity.endedAt,
      visibility: "public",
    });
    expect(stored.saves.map((save) => [save.snapshot.title, save.gallery])).toEqual([
      [TITLES[0], "800"],
      [TITLES[1], "801"],
    ]);
    for (const save of stored.saves) {
      expect(save.savedAt).toBeGreaterThan(activity.startedAt);
      expect(save.savedAt).toBeLessThan(activity.endedAt);
      const photo = stored.photos.find((row) => row.saveId === save._id)!;
      expect(photo.capturedAt).toBeGreaterThan(activity.startedAt);
      expect(photo.capturedAt).toBeLessThan(save.savedAt);
    }
    expect(stored.files.map((file) => [file?.refCount, file?.expiresAt])).toEqual(photoIds.map(() => [1, undefined]));
    expect(stored.pendingUploads).toBe(0);

    const leaderboard = await t.query(api.leaderboards.list, { metric: "artworks", audience: "global" });
    expect(leaderboard.rows.map((row) => [row.profile.username, row.score])).toContainEqual(["alice", 2]);
  });

  it("keeps friends-only posts off the public feed", async () => {
    const { t, bot } = await world();
    const activity = await postActivity(t, { audience: "friends" });
    await bot.action(api.demoActivity.publish, { activity });
    expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
    await expect(t.query(api.sharedVisits.get, { postId: activity.submissionId })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
  });
});

describe("context", () => {
  it.each([
    { content: "reflections", count: 200, artworkCount: 1, note: "A work.", reflection: "界".repeat(LIMITS.note) },
  ])("returns complete newest posts within the read budget with long $content", async (input) => {
    const { t, bot } = await world(harness({ transactionLimits: true }));
    const template = await postActivity(t);
    const now = Date.now();
    const postIds = [];
    for (let index = 0; index < input.count; index++) {
      const photoIds = await uploads(t, input.artworkCount);
      const activity: PostActivity = {
        ...template,
        submissionId: crypto.randomUUID(),
        author: ["alice", "bob", "cara"][index % 3],
        reflection: input.reflection,
        artworks: photoIds.map((photoId, i) => ({ objectKey: `met:${i}`, note: input.note, photoIds: [photoId] })),
      };
      await bot.mutation(internal.demoActivity.insertPost, activity);
      await t.run(async (ctx) => {
        const post = (await ctx.db
          .query("sharedVisits")
          .withIndex("by_postId", (q) => q.eq("postId", activity.submissionId))
          .unique())!;
        await ctx.db.patch("sharedVisits", post._id, { publishedAt: now - index });
      });
      postIds.push(activity.submissionId);
    }

    const context = await bot.query(api.demoActivity.getContext, { since: now - DAY });
    expect(context.characters.map((person) => person.username)).toEqual(["alice", "bob", "cara"]);
    expect(context.posts.length).toBeGreaterThan(0);
    expect(context.posts.length).toBeLessThan(100);
    expect(context.posts.map((post) => post.postId)).toEqual(postIds.slice(0, context.posts.length));
    for (const post of context.posts) {
      expect(post.reflection).toBe(input.reflection);
      expect(post.artworks.map((artwork) => artwork.title)).toEqual(TITLES.slice(0, input.artworkCount));
    }
  });

  it("lists demo characters and their recent posts with only demo reactions", async () => {
    const { t, bot } = await world();
    const viewer = await socialUser(t, "viewer");
    const older = await postActivity(t, { author: "bob" });
    await bot.action(api.demoActivity.publish, { activity: older });
    await t.run(async (ctx) => {
      const post = (await ctx.db.query("sharedVisits").first())!;
      await ctx.db.patch("sharedVisits", post._id, { publishedAt: Date.now() - 2 * DAY });
    });
    const since = Date.now() - DAY;
    const newer = await postActivity(t, { audience: "friends", startedAt: Date.now() - 2 * HOUR });
    const newest = await postActivity(t, { author: "cara" });
    await bot.action(api.demoActivity.publish, { activity: newer });
    await bot.action(api.demoActivity.publish, { activity: newest });
    const reply = comment(newest.submissionId, { author: "alice" });
    await bot.action(api.demoActivity.publish, { activity: reply });
    await bot.action(api.demoActivity.publish, {
      activity: { kind: "like", author: "bob", postId: newest.submissionId },
    });
    await viewer.as.mutation(api.visitReactions.setLike, { postId: newest.submissionId, liked: true });
    await viewer.as.action(api.visitReactions.addComment, {
      postId: newest.submissionId,
      body: "Real person here.",
      requestId: crypto.randomUUID(),
    });

    const context = await bot.query(api.demoActivity.getContext, { since });
    expect(context.characters).toEqual([
      { username: "alice", name: "Alice", bio: "Here for the Dutch rooms.", avatar: "vermeer", friends: ["bob"] },
      { username: "bob", name: "Bob", bio: "Here for the Dutch rooms.", avatar: "vermeer", friends: ["alice"] },
      { username: "cara", name: "Cara", bio: "Here for the Dutch rooms.", avatar: "vermeer", friends: [] },
    ]);
    expect(context.posts.map((post) => [post.author, post.audience])).toEqual([
      ["cara", "public"],
      ["alice", "friends"],
    ]);
    expect(context.posts[0]).toMatchObject({
      postId: newest.submissionId,
      venue: { key: MET, name: "Metropolitan Museum of Art" },
      reflection: "The cypresses look like they are still moving.",
      artworks: [
        { objectKey: "met:0", title: TITLES[0], artist: "Old Master" },
        { objectKey: "met:1", title: TITLES[1], artist: "Old Master" },
      ],
      likes: ["bob"],
      comments: [{ submissionId: reply.submissionId, author: "alice", body: reply.body }],
    });
  });

  it("answers an empty context before any demo account exists", async () => {
    const t = harness();
    expect(await t.withIdentity(BOT).query(api.demoActivity.getContext, { since: Date.now() - DAY })).toEqual({
      characters: [],
      posts: [],
    });
  });

  it("lists a venue's owned works on view, best pick first", async () => {
    const { t, bot, met, aic } = await world();
    await t.run(async (ctx) => {
      const objects = await ctx.db.query("objects").collect();
      const byKey = (key: string) => objects.find((row) => row.key === key)!;
      // A loan on view at the Met, a closed placement, and a reverted work are all left out.
      const loan = byKey("aic:1");
      await ctx.db.insert("placements", {
        identityStatus: "established",
        objectId: loan._id,
        venueId: met,
        onView: true,
        source: "feed",
        confidence: 1,
      });
      const closed = (await ctx.db.query("placements").collect()).find((row) => row.objectId === byKey("met:2")._id)!;
      await ctx.db.patch("placements", closed._id, { closedAt: Date.now() });
      await ctx.db.patch("objects", byKey("met:3")._id, { reverted: true });
      for (const [score, key] of ["met:1", "aic:1", "met:2", "met:3", "met:0", "met:4"].entries()) {
        const object = byKey(key);
        await ctx.db.insert("museumPicks", {
          venueId: met,
          artworkId: object.artworkId,
          objectId: object._id,
          score: -score,
        });
      }
      await ctx.db.insert("museumPicks", {
        venueId: aic,
        artworkId: loan.artworkId,
        objectId: loan._id,
        score: 1,
      });
    });

    const listed = await bot.query(api.demoActivity.listVenueArtworks, { venueKey: MET, limit: 2 });
    expect(listed.venue).toEqual({
      key: MET,
      name: "Metropolitan Museum of Art",
      city: "New York",
      country: "US",
      timeZone: "America/New_York",
    });
    expect(listed.artworks).toEqual([
      {
        objectKey: "met:1",
        title: TITLES[1],
        artist: "Old Master",
        date: "1916",
        medium: "Oil on canvas",
        gallery: "801",
        thumbnailUrl: "https://museum.example/work.jpg",
      },
      expect.objectContaining({ objectKey: "met:0" }),
    ]);
    expect(
      (await bot.query(api.demoActivity.listVenueArtworks, { venueKey: MET })).artworks.map((row) => row.objectKey),
    ).toEqual(["met:1", "met:0", "met:4"]);
    for (const limit of [0, 51, 1.5]) {
      await expect(bot.query(api.demoActivity.listVenueArtworks, { venueKey: MET, limit })).rejects.toMatchObject({
        data: { code: "invalid_activity" },
      });
    }
    await expect(bot.query(api.demoActivity.listVenueArtworks, { venueKey: "wikidata:Q0" })).rejects.toMatchObject({
      data: { code: "invalid_venue" },
    });
  });
});

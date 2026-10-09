import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APPROVED_DEMO_USERNAMES, weekStart, WEEK_MS } from "../shared/demo-policy";
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
  for (const username of ["mayachen", "leahgoldberg", "alexrivera"]) {
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
    friendships: [{ from: "mayachen", to: "leahgoldberg", state: "accepted", at: Date.now() - DAY }],
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
    author: "mayachen",
    venueKey: MET,
    startedAt: now - 3 * HOUR,
    endedAt: now - HOUR,
    audience: "public",
    companions: [],
    reflection: "  The cypresses look like they are still moving.  ",
    artworks: [
      { objectKey: "met:0", photoIds: [first] },
      { objectKey: "met:1", photoIds: [second] },
    ],
    ...overrides,
  };
}

const comment = (postId: string, overrides: Partial<Extract<Activity, { kind: "comment" }>> = {}) => ({
  kind: "comment" as const,
  submissionId: crypto.randomUUID(),
  author: "leahgoldberg",
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
    const open = await postActivity(t, { author: "leahgoldberg" });
    await bot.action(api.demoActivity.publish, { activity: open });

    const rejected = [
      { activity: await postActivity(t, { author: "u_viewer" }), code: "not_found" },
      { activity: { kind: "like" as const, author: "leahgoldberg", postId: realPost.postId! }, code: "not_found" },
      { activity: comment(realPost.postId!), code: "not_found" },
      // Cara is not Alice's friend, so the friends-only post is not hers to read.
      {
        activity: { kind: "like" as const, author: "alexrivera", postId: friendsOnly.submissionId },
        code: "not_found",
      },
      { activity: comment(friendsOnly.submissionId, { author: "alexrivera" }), code: "not_found" },
      { activity: comment(open.submissionId, { body: "@u_viewer look at this" }), code: "invalid_mention" },
      { activity: await postActivity(t, { reflection: "With @nobody_here today" }), code: "invalid_mention" },
    ];
    for (const { activity, code } of rejected) {
      await expect(bot.action(api.demoActivity.publish, { activity })).rejects.toMatchObject({ data: { code } });
    }

    await bot.action(api.demoActivity.publish, {
      activity: { kind: "like", author: "leahgoldberg", postId: friendsOnly.submissionId },
    });
    await bot.action(api.demoActivity.publish, {
      activity: comment(open.submissionId, { author: "mayachen", body: "Same room as @alexrivera last week" }),
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
      { kind: "commentMention", to: "alexrivera" },
      { kind: "visitComment", to: "leahgoldberg" },
      { kind: "visitLike", to: "mayachen" },
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
      { ...activity, author: "leahgoldberg" },
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
      { ...activity, author: "alexrivera" },
    ]) {
      await expect(bot.action(api.demoActivity.publish, { activity: changed })).rejects.toMatchObject({
        data: { code: "conflict" },
      });
    }
    const like = { kind: "like" as const, author: "alexrivera", postId: post.submissionId };
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
      author: { username: "mayachen" },
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
    expect(leaderboard.rows.map((row) => [row.profile.username, row.score])).toContainEqual(["mayachen", 2]);
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
        author: ["mayachen", "leahgoldberg", "alexrivera"][index % 3],
        reflection: input.reflection,
        artworks: photoIds.map((photoId, i) => ({ objectKey: `met:${i}`, photoIds: [photoId] })),
      };
      await bot.mutation(internal.demoActivity.insertPost, activity);
      // This read-budget fixture represents historic seeded demo posts, independent of bot quota accounting.
      await t.run(async (ctx) => {
        for (const row of await ctx.db.query("demoActivityReceipts").collect()) {
          await ctx.db.delete("demoActivityReceipts", row._id);
        }
      });
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
    expect(context.characters.map((person) => person.username)).toEqual(["alexrivera", "leahgoldberg", "mayachen"]);
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
    const older = await postActivity(t, { author: "leahgoldberg" });
    await bot.action(api.demoActivity.publish, { activity: older });
    await t.run(async (ctx) => {
      const post = (await ctx.db.query("sharedVisits").first())!;
      await ctx.db.patch("sharedVisits", post._id, { publishedAt: Date.now() - 2 * DAY });
    });
    const since = Date.now() - DAY;
    const newer = await postActivity(t, { audience: "friends", startedAt: Date.now() - 2 * HOUR });
    const newest = await postActivity(t, { author: "alexrivera" });
    await bot.action(api.demoActivity.publish, { activity: newer });
    await bot.action(api.demoActivity.publish, { activity: newest });
    const reply = comment(newest.submissionId, { author: "mayachen" });
    await bot.action(api.demoActivity.publish, { activity: reply });
    await bot.action(api.demoActivity.publish, {
      activity: { kind: "like", author: "leahgoldberg", postId: newest.submissionId },
    });
    await viewer.as.mutation(api.visitReactions.setLike, { postId: newest.submissionId, liked: true });
    await viewer.as.action(api.visitReactions.addComment, {
      postId: newest.submissionId,
      body: "Real person here.",
      requestId: crypto.randomUUID(),
    });

    const context = await bot.query(api.demoActivity.getContext, { since });
    expect(context.characters).toEqual(
      expect.arrayContaining([
        {
          username: "mayachen",
          name: "Mayachen",
          bio: "Here for the Dutch rooms.",
          avatar: "vermeer",
          friends: ["leahgoldberg"],
        },
        {
          username: "leahgoldberg",
          name: "Leahgoldberg",
          bio: "Here for the Dutch rooms.",
          avatar: "vermeer",
          friends: ["mayachen"],
        },
        {
          username: "alexrivera",
          name: "Alexrivera",
          bio: "Here for the Dutch rooms.",
          avatar: "vermeer",
          friends: [],
        },
      ]),
    );
    expect(context.posts.map((post) => [post.author, post.audience])).toEqual([
      ["alexrivera", "public"],
      ["mayachen", "friends"],
    ]);
    expect(context.posts[0]).toMatchObject({
      postId: newest.submissionId,
      venue: { key: MET, name: "Metropolitan Museum of Art" },
      reflection: "The cypresses look like they are still moving.",
      artworks: [
        { objectKey: "met:0", title: TITLES[0], artist: "Old Master" },
        { objectKey: "met:1", title: TITLES[1], artist: "Old Master" },
      ],
      likes: ["leahgoldberg"],
      comments: [{ submissionId: reply.submissionId, author: "mayachen", body: reply.body }],
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

describe("approved cohort, companions and shared limits", () => {
  it("rejects active demo accounts outside the approved cohort", async () => {
    const { t, bot } = await world();
    await t.mutation(internal.demoSeed.seedPerson, {
      username: "outsider",
      name: "Other demo",
      bio: "Art",
      avatar: "vermeer",
      leaderboardVisibility: "global",
      joinedAt: Date.now() - DAY,
      visits: [],
    });
    const activity = await postActivity(t, { author: "outsider" });
    await expect(bot.action(api.demoActivity.publish, { activity })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    expect(
      (await bot.query(api.demoActivity.getContext, { since: Date.now() - DAY })).characters.map((p) => p.username),
    ).not.toContain("outsider");
    await expect(
      bot.action(api.demoActivity.publish, { activity: await postActivity(t, { reflection: "With @outsider" }) }),
    ).rejects.toMatchObject({ data: { code: "invalid_mention" } });
  });

  it("stores eligible companions, preserves retries after a companion leaves, and rejects changed requests", async () => {
    const { t, bot } = await world();
    const activity = await postActivity(t, {
      companions: ["leahgoldberg"],
      reflection: "Loved the light #painting @leahgoldberg",
    });
    await bot.action(api.demoActivity.publish, { activity });
    const publication = await t.run((ctx) =>
      ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", activity.submissionId))
        .unique(),
    );
    expect(publication!.companionSelections).toHaveLength(1);
    expect(publication!.mentions?.map((mention) => mention.username)).toContain("leahgoldberg");
    expect(
      (
        await t.run((ctx) =>
          ctx.db
            .query("postTags")
            .withIndex("by_publication", (q) => q.eq("publicationId", publication!._id))
            .collect(),
        )
      ).map((row) => row.tag),
    ).toContain("painting");
    expect(await t.run((ctx) => ctx.db.query("visitCompanions").collect())).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch("sharedVisits", publication!._id, { companionSelections: [] }));
    expect(await bot.action(api.demoActivity.publish, { activity })).toMatchObject({ status: "unchanged" });
    await expect(
      bot.action(api.demoActivity.publish, { activity: { ...activity, companions: [] } }),
    ).rejects.toMatchObject({ data: { code: "conflict" } });
    expect(await t.run((ctx) => ctx.db.query("demoActivityReceipts").collect())).toHaveLength(1);
  });

  it("rejects self, duplicates, nonfriends and real companions before publication", async () => {
    const { t, bot } = await world();
    await socialUser(t, "realperson");
    for (const companions of [["mayachen"], ["leahgoldberg", "leahgoldberg"], ["alexrivera"], ["realperson"]]) {
      await expect(
        bot.action(api.demoActivity.publish, { activity: await postActivity(t, { companions }) }),
      ).rejects.toThrow(/invalid_activity|not_found/);
    }
    expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toHaveLength(0);
  });

  it("caps posts across authors atomically while duplicates consume no additional allowance", async () => {
    const { t, bot } = await world();
    const posts = [];
    for (let i = 0; i < 13; i++) posts.push(await postActivity(t, { author: i % 2 ? "leahgoldberg" : "mayachen" }));
    // Insert is the final transaction after moderation; use it to isolate weekly caps from hourly rate limits.
    for (const post of posts.slice(0, 11)) await t.mutation(internal.demoActivity.insertPost, post);
    const outcomes = await Promise.allSettled(
      posts.slice(11).map((post) => t.mutation(internal.demoActivity.insertPost, post)),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toHaveLength(12);
    expect(await bot.action(api.demoActivity.publish, { activity: posts[0] })).toMatchObject({ status: "unchanged" });
    expect(await t.run((ctx) => ctx.db.query("demoActivityReceipts").collect())).toHaveLength(12);
  });
});

it("caps comments and likes for the entire cohort and opens the next UTC week", async () => {
  const { t, bot } = await world();
  const post = await postActivity(t);
  await bot.action(api.demoActivity.publish, { activity: post });
  for (let index = 0; index < 8; index++) {
    await t.mutation(internal.demoActivity.insertComment, comment(post.submissionId, { body: `Thought ${index}` }));
  }
  await expect(t.mutation(internal.demoActivity.insertComment, comment(post.submissionId))).rejects.toMatchObject({
    data: { code: "rate_limited" },
  });
  const authors = APPROVED_DEMO_USERNAMES.filter(
    (name) => !["mayachen", "leahgoldberg", "alexrivera"].includes(name),
  ).slice(0, 17);
  for (const username of authors) {
    await t.mutation(internal.demoSeed.seedPerson, {
      username,
      name: username,
      bio: "Art",
      avatar: "vermeer",
      leaderboardVisibility: "global",
      joinedAt: Date.now() - DAY,
      visits: [],
    });
  }
  for (const author of authors.slice(0, 16)) {
    await bot.action(api.demoActivity.publish, { activity: { kind: "like", author, postId: post.submissionId } });
  }
  await expect(
    bot.action(api.demoActivity.publish, {
      activity: { kind: "like", author: authors[16], postId: post.submissionId },
    }),
  ).rejects.toMatchObject({ data: { code: "rate_limited" } });
  const clock = vi.spyOn(Date, "now").mockReturnValue(weekStart(Date.now()) + WEEK_MS + HOUR);
  try {
    await t.mutation(internal.demoActivity.insertComment, comment(post.submissionId, { body: "A different week" }));
    expect(
      await bot.action(api.demoActivity.publish, {
        activity: { kind: "like", author: authors[16], postId: post.submissionId },
      }),
    ).toMatchObject({ status: "created" });
  } finally {
    clock.mockRestore();
  }
});

describe("demo profile walls", () => {
  const layout = { x: 0.05, y: 0.1, width: 0.4, layer: 0, frame: "oak" };
  const wall = () => ({ revision: 0, color: "#CDD0CA", pattern: "stripe", items: [{ key: "post:met:0", layout }] });

  it("uses live styles and publishes a visit photo on the author's actual profile wall", async () => {
    const { t, bot } = await world();
    expect(await bot.query(api.demoActivity.getWallContext, { author: "mayachen" })).toMatchObject({
      revision: 0,
      items: [],
      catalog: {
        patterns: expect.arrayContaining(["plain", "stripe"]),
        frames: expect.arrayContaining([{ value: "oak", border: 9 }]),
        maxItems: LIMITS.wallItems,
      },
      geometry: { wallWidth: 390, fullFrameWidth: 166, sideGap: 0.025, labelGap: 0.16 },
    });
    expect(
      await bot.action(api.demoActivity.publish, { activity: await postActivity(t, { wall: wall() }) }),
    ).toMatchObject({ wallStatus: "updated" });
    const updated = await bot.query(api.demoActivity.getWallContext, { author: "mayachen" });
    expect(updated).toMatchObject({ revision: 1, color: "#CDD0CA", pattern: "stripe" });
    expect(updated.items.find((item) => item.layout)).toMatchObject({
      title: TITLES[0],
      aspectRatio: 1536 / 2048,
      layout,
    });
    const profile = await t.run((ctx) =>
      ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", "mayachen"))
        .unique(),
    );
    expect(profile?.publishedWallCount).toBe(1);
    const publicWall = await t.query(api.walls.getPublic, { profileId: profile!._id });
    expect(publicWall).toMatchObject({ color: "#CDD0CA", pattern: "stripe", artworkCount: 1 });
    expect(publicWall?.items[0].layout).toEqual(layout);
  });

  it("moves, resizes and reframes placements and retries without restoring an older wall", async () => {
    const { t, bot } = await world();
    const first = await postActivity(t, { wall: wall() });
    await bot.action(api.demoActivity.publish, { activity: first });
    const before = await bot.query(api.demoActivity.getWallContext, { author: "mayachen" });
    const placed = before.items.find((item) => item.layout)!;
    const saved = before.items.find((item) => !item.layout)!;
    const moved = { x: 0.5, y: 0.8, width: 0.3, layer: 1, frame: "gilt" };
    const second = await postActivity(t, {
      wall: {
        revision: before.revision,
        color: "#EDECE7",
        pattern: "plain",
        items: [
          { key: placed.key, layout: moved },
          { key: saved.key, layout },
        ],
      },
    });
    await bot.action(api.demoActivity.publish, { activity: second });
    const after = await bot.query(api.demoActivity.getWallContext, { author: "mayachen" });
    expect(after).toMatchObject({ revision: 2, pattern: "plain" });
    expect(after.items.find((item) => item.key === placed.key)?.layout).toEqual(moved);
    expect(await bot.action(api.demoActivity.publish, { activity: first })).toMatchObject({
      status: "unchanged",
      wallStatus: "updated",
    });
    expect(await bot.query(api.demoActivity.getWallContext, { author: "mayachen" })).toEqual(after);
    await expect(
      bot.action(api.demoActivity.publish, { activity: { ...first, wall: { ...wall(), color: "#EDECE7" } } }),
    ).rejects.toMatchObject({ data: { code: "conflict" } });
  });

  it("publishes a visit without overwriting a newer wall or reapplying a retired style", async () => {
    const { t, bot } = await world();
    await bot.action(api.demoActivity.publish, { activity: await postActivity(t, { wall: wall() }) });
    const before = await bot.query(api.demoActivity.getWallContext, { author: "mayachen" });
    expect(
      await bot.action(api.demoActivity.publish, { activity: await postActivity(t, { wall: wall() }) }),
    ).toMatchObject({ status: "created", wallStatus: "stale" });
    expect(
      await bot.action(api.demoActivity.publish, {
        activity: await postActivity(t, { wall: { ...wall(), revision: 1, pattern: "retired" } }),
      }),
    ).toMatchObject({ status: "created", wallStatus: "unavailable" });
    const after = await bot.query(api.demoActivity.getWallContext, { author: "mayachen" });
    expect(after.revision).toBe(before.revision);
    expect(after.items.filter((item) => item.layout)).toEqual(before.items.filter((item) => item.layout));
  });

  it("rejects unauthenticated and real-user wall access and obeys the kill switch", async () => {
    const { t, bot } = await world();
    const real = await socialUser(t, "viewer");
    for (const caller of [t, real.as]) {
      await expect(caller.query(api.demoActivity.getWallContext, { author: "mayachen" })).rejects.toMatchObject({
        data: { code: "unauthenticated" },
      });
    }
    await expect(bot.query(api.demoActivity.getWallContext, { author: "u_viewer" })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    vi.stubEnv("FLAG_DEMO_ACTIVITY", "off");
    await expect(bot.query(api.demoActivity.getWallContext, { author: "mayachen" })).rejects.toMatchObject({
      data: { code: "feature_off" },
    });
  });

  it.each(["foreign", "private", "geometry", "duplicate"])("rejects %s wall selections atomically", async (invalid) => {
    const { t, bot } = await world();
    const plan = wall();
    if (invalid === "foreign") {
      const real = await socialUser(t, "viewer");
      const visit = await socialVisit(t, real);
      plan.items[0].key = `save:${visit.saves[0].localId}`;
    }
    if (invalid === "geometry") plan.items[0].layout = { ...layout, x: 0.9, width: 0.4 };
    if (invalid === "duplicate") plan.items.push(plan.items[0]);
    const wallsBefore = await t.run((ctx) => ctx.db.query("walls").collect());
    const activity = await postActivity(t, {
      wall: plan,
      ...(invalid === "private" ? { audience: "friends" as const } : {}),
    });
    await expect(bot.action(api.demoActivity.publish, { activity })).rejects.toMatchObject({
      data: { code: "invalid_wall" },
    });
    expect(await t.run((ctx) => ctx.db.query("walls").collect())).toEqual(wallsBefore);
    expect(await t.run((ctx) => ctx.db.query("sharedVisits").collect())).toEqual([]);
  });
});

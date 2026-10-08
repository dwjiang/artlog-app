import { afterEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { befriend, setVisitVisibility, socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { seedArtworkWithObject } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
});

async function post(
  t: Harness,
  user: SocialUser,
  reflection: string,
  {
    audience = "public",
    visitedOn,
    saves = 1,
  }: { audience?: "public" | "friends" | "private"; visitedOn?: string; saves?: number } = {},
) {
  const draft = await socialVisit(t, user, saves, visitedOn);
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection }));
  if (audience !== "public") await setVisitVisibility(t, user, draft.visit._id, audience);
  const state = await user.as.action(api.sharedVisits.publish, { ...draft.selection, audience, reflection });
  return { ...draft, postId: state.postId! };
}

async function showCatalogImage(t: Harness, saveId: Id<"collections">, url: string) {
  const { objectId, artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.run((ctx) => ctx.db.patch("collections", saveId, { objectId, artworkId }));
  const source = {
    kind: "catalog" as const,
    url,
    sourceUrl: "https://museum.example/rights",
    rights: "public_domain" as const,
    width: 600,
    height: 400,
  };
  await t.mutation(internal.displayMedia.registerCatalog, {
    saveId,
    objectId,
    source,
    imageRightsEvidence: "Public domain per museum record",
  });
  return source;
}

const publicationOf = (t: Harness, postId: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", postId))
        .unique())!,
  );
const listed = async (viewer: { query: SocialUser["as"]["query"] }, tag: string) =>
  (await viewer.query(api.sharedVisits.listByTag, { tag })).page.map((visit) => visit.postId);
const tagRows = (t: Harness, publicationId: Id<"sharedVisits">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("postTags")
        .withIndex("by_publication", (q) => q.eq("publicationId", publicationId))
        .take(50)
    ).map((row) => row.tag),
  );

it("lists a post under each tag in its notes, newest visit first, whatever the tag's case", async () => {
  const t = harness();
  const author = await socialUser(t);
  const older = await post(t, author, "Morning with the #Monet lilies.", { visitedOn: "2026-09-01" });
  const newer = await post(t, author, "#monet again, then #impressionism and #MONET", { visitedOn: "2026-09-20" });
  expect(await listed(t, "monet")).toEqual([newer.postId, older.postId]);
  expect(await listed(t, "MONET")).toEqual([newer.postId, older.postId]);
  expect(await listed(t, "impressionism")).toEqual([newer.postId]);
  expect(await t.query(api.tags.get, { tag: "Monet" })).toEqual({ tag: "monet", postCount: 2 });
  expect(await listed(t, "renoir")).toEqual([]);
  await expect(t.query(api.sharedVisits.listByTag, { tag: "#1" })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
});

it("pages through a tag with the feed's cursor", async () => {
  const t = harness();
  const author = await socialUser(t);
  const posts = [];
  for (let day = 1; day <= 3; day++) {
    posts.push((await post(t, author, "#sketchsunday", { visitedOn: `2026-09-0${day}` })).postId);
  }
  const first = await t.query(api.sharedVisits.listByTag, { tag: "sketchsunday", limit: 2 });
  const second = await t.query(api.sharedVisits.listByTag, { tag: "sketchsunday", limit: 2, cursor: first.cursor });
  expect([...first.page, ...second.page].map((visit) => visit.postId)).toEqual(posts.toReversed());
  expect(second.isDone).toBe(true);
});

it("follows edits to the notes and drops tags when the post is withdrawn or deleted", async () => {
  const t = harness();
  const author = await socialUser(t);
  const shared = await post(t, author, "#monet #renoir");
  const reflection = "Only #renoir now";
  await t.run((ctx) => ctx.db.patch("visits", shared.visit._id, { reflection }));
  await author.as.action(api.sharedVisits.publish, { ...shared.selection, revision: 1, reflection });
  expect(await listed(t, "monet")).toEqual([]);
  expect(await t.query(api.tags.get, { tag: "monet" })).toEqual({ tag: "monet", postCount: 0 });
  expect(await listed(t, "renoir")).toEqual([shared.postId]);

  const publication = await publicationOf(t, shared.postId);
  await t.run((ctx) => ctx.db.patch("sharedVisits", publication._id, { status: "private" }));
  expect(await tagRows(t, publication._id)).toEqual([]);
  expect(await t.query(api.tags.search, { prefix: "ren" })).toEqual([]);
  await t.run((ctx) => ctx.db.patch("sharedVisits", publication._id, { status: "active" }));
  expect(await tagRows(t, publication._id)).toEqual(["renoir"]);
  await t.run((ctx) => ctx.db.delete("sharedVisits", publication._id));
  expect(await tagRows(t, publication._id)).toEqual([]);
  expect(await t.query(api.tags.get, { tag: "renoir" })).toEqual({ tag: "renoir", postCount: 0 });
});

it("shows friends-only posts on a tag page only to friends and never suggests their tags", async () => {
  const t = harness();
  const author = await socialUser(t);
  const friend = await socialUser(t);
  const stranger = await socialUser(t);
  await befriend(author, friend);
  const friendsOnly = await post(t, author, "Party for #mayasbirthday at the #artinstitute", { audience: "friends" });
  const open = await post(t, author, "Back at the #artinstitute");
  expect(await listed(friend.as, "mayasbirthday")).toEqual([friendsOnly.postId]);
  expect(await listed(author.as, "mayasbirthday")).toEqual([friendsOnly.postId]);
  expect(await listed(stranger.as, "mayasbirthday")).toEqual([]);
  expect(await listed(t, "mayasbirthday")).toEqual([]);
  expect(await listed(stranger.as, "artinstitute")).toEqual([open.postId]);
  for (const viewer of [friend.as, stranger.as]) {
    expect(await viewer.query(api.tags.search, { prefix: "may" })).toEqual([]);
    expect(await viewer.query(api.tags.search, { prefix: "art" })).toEqual([{ tag: "artinstitute", postCount: 1 }]);
  }

  await setVisitVisibility(t, author, open.visit._id, "private");
  expect(await listed(author.as, "artinstitute")).toEqual([friendsOnly.postId]);
  expect(await t.query(api.tags.search, { prefix: "art" })).toEqual([]);
  await setVisitVisibility(t, author, friendsOnly.visit._id, "public");
  expect(await listed(stranger.as, "mayasbirthday")).toEqual([friendsOnly.postId]);
  expect(await t.query(api.tags.get, { tag: "mayasbirthday" })).toEqual({ tag: "mayasbirthday", postCount: 1 });
});

it("hides posts from people blocked either way", async () => {
  const t = harness();
  const author = await socialUser(t);
  const viewer = await socialUser(t);
  const shared = await post(t, author, "#ukiyoe prints");
  expect(await listed(viewer.as, "ukiyoe")).toEqual([shared.postId]);
  await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: viewer.profileId });
  expect(await listed(viewer.as, "ukiyoe")).toEqual([]);
});

it("suggests public tags by prefix, busiest first", async () => {
  const t = harness();
  const author = await socialUser(t);
  await post(t, author, "#impasto #impressionism");
  await post(t, author, "#impressionism #Impressionist");
  await post(t, author, "#impressionism");
  expect(await t.query(api.tags.search, { prefix: "#Imp" })).toEqual([
    { tag: "impressionism", postCount: 3 },
    { tag: "impasto", postCount: 1 },
    { tag: "impressionist", postCount: 1 },
  ]);
  expect(await t.query(api.tags.search, { prefix: "impr" })).toHaveLength(2);
  for (const prefix of ["", "#", "two words", "x".repeat(51)]) {
    expect(await t.query(api.tags.search, { prefix })).toEqual([]);
  }
});

it("never gives an offensive tag a page or a suggestion", async () => {
  const t = harness();
  const author = await socialUser(t);
  const shared = await post(t, author, "#monet");
  const publication = await publicationOf(t, shared.postId);
  // Posted text passes moderation first; this stands in for a word the moderation model let through.
  await t.run((ctx) => ctx.db.patch("sharedVisits", publication._id, { reflection: "#monet #fuckthis" }));
  expect(await tagRows(t, publication._id)).toEqual(["monet"]);
  expect(await t.query(api.tags.get, { tag: "fuckthis" })).toBeNull();
  expect(await t.query(api.tags.search, { prefix: "fuck" })).toEqual([]);
});

it("withdraws a removed profile's posts from tag discovery without changing other authors' counts", async () => {
  const t = harness({ transactionLimits: true });
  const author = await socialUser(t);
  const reporter = await socialUser(t);
  await post(t, author, "#monet #removedauthor");
  const remaining = await post(t, reporter, "#monet");
  const { reportId } = await reporter.as.mutation(api.reports.submit, {
    target: { kind: "profile", profileId: author.profileId },
    reason: "other",
    details: "Remove this profile",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "reviewer",
    decision: "remove",
    reason: "Remove this profile",
  });
  expect(await listed(t, "monet")).toEqual([remaining.postId]);
  expect(await t.query(api.tags.search, { prefix: "removed" })).toEqual([]);
  expect(await t.query(api.tags.get, { tag: "monet" })).toEqual({ tag: "monet", postCount: 1 });
});

it("finishes removing tags across multiple bounded batches", async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const author = await socialUser(t);
  const shared = await post(t, author, Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" "));
  const publication = await publicationOf(t, shared.postId);
  const { _id, _creationTime, ...fields } = publication;
  for (let i = 0; i < 25; i++) {
    await t.run((ctx) => ctx.db.insert("sharedVisits", { ...fields, postId: crypto.randomUUID() }));
  }
  await t.run((ctx) => ctx.db.patch("profiles", author.profileId, { active: false }));
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
  expect(await t.query(api.tags.search, { prefix: "tag" })).toEqual([]);
  expect(await t.query(api.tags.get, { tag: "tag0" })).toEqual({ tag: "tag0", postCount: 0 });
  // A later journal update must not restore tags from a withdrawn post.
  await t.run((ctx) => ctx.db.patch("sharedVisits", _id, { visitedOn: "2026-09-21" }));
  expect(await tagRows(t, _id)).toEqual([]);
});

it("picks the tags with the most public posts of all time, keeping their counts live until the next pick", async () => {
  const t = harness();
  const author = await socialUser(t);
  for (let i = 0; i < 3; i++) {
    await post(t, author, "#renoir #cassatt #degas #monet #morisot", { visitedOn: "2026-01-01" });
  }
  await post(t, author, "#renoir #cassatt #degas #monet");
  await post(t, author, "#renoir #cassatt #degas");
  await post(t, author, "#renoir #cassatt");
  await post(t, author, "#renoir");
  await post(t, author, "#hidden #hidden2 #hidden3", { audience: "friends" });
  const sargent = await post(t, author, "#sargent", { visitedOn: "2026-10-01" });
  const popular = async () => (await t.query(api.tags.popular, {})).map(({ tag, postCount }) => [tag, postCount]);
  expect(await popular()).toEqual([]);

  await t.action(internal.tags.refreshPopular, {});
  expect(await popular()).toEqual([
    ["renoir", 7],
    ["cassatt", 6],
    ["degas", 5],
    ["monet", 4],
    ["morisot", 3],
    ["sargent", 1],
  ]);
  await setVisitVisibility(t, author, sargent.visit._id, "private");
  for (let i = 0; i < 4; i++) await post(t, author, "#hopper");
  expect(await popular()).toEqual([
    ["renoir", 7],
    ["cassatt", 6],
    ["degas", 5],
    ["monet", 4],
    ["morisot", 3],
  ]);
  await t.action(internal.tags.refreshPopular, {});
  expect(await popular()).toEqual([
    ["renoir", 7],
    ["cassatt", 6],
    ["degas", 5],
    ["hopper", 4],
    ["monet", 4],
    ["morisot", 3],
  ]);
});

it("covers each popular tag with a catalog image from its most-liked public post", async () => {
  const t = harness();
  const author = await socialUser(t);
  const fans = [await socialUser(t), await socialUser(t), await socialUser(t)];
  const like = async (postId: string, count: number) => {
    for (const fan of fans.slice(0, count)) await fan.as.mutation(api.visitReactions.setLike, { postId, liked: true });
  };
  const liked = await post(t, author, "#impressionism #monet", { visitedOn: "2026-09-01", saves: 2 });
  const lilies = await showCatalogImage(t, liked.saves[0].id, "https://museum.example/lilies.jpg");
  const wheat = await showCatalogImage(t, liked.saves[1].id, "https://museum.example/wheat.jpg");
  const newer = await post(t, author, "#impressionism #monet", { visitedOn: "2026-09-10" });
  await showCatalogImage(t, newer.saves[0].id, "https://museum.example/noon.jpg");
  const pictureless = await post(t, author, "#impressionism", { visitedOn: "2026-09-20" });
  await like(liked.postId, 2);
  await like(pictureless.postId, 3);
  const covers = async () =>
    Object.fromEntries((await t.query(api.tags.popular, {})).map(({ tag, cover }) => [tag, cover?.url]));

  await t.action(internal.tags.refreshPopular, {});
  expect(await covers()).toEqual({ impressionism: lilies.url, monet: wheat.url });
  // A takedown or revocation hides the image at once rather than at the next pick.
  await t.run(async (ctx) => {
    const asset = await ctx.db
      .query("mediaAssets")
      .withIndex("by_save_kind", (q) => q.eq("saveId", liked.saves[0].id))
      .first();
    await ctx.db.patch("mediaAssets", asset!._id, { revokedAt: Date.now() });
  });
  expect(await covers()).toEqual({ impressionism: undefined, monet: wheat.url });
});

it.each([
  { scenario: "many post lookups", tags: ["cassatt", "degas", "monet", "morisot", "renoir", "sargent"], saves: 1 },
  { scenario: "large save records", tags: ["monet"], saves: 3 },
])("refreshes tags without catalog images within transaction limits: $scenario", async ({ tags, saves }) => {
  const t = harness({ transactionLimits: true });
  const reflection = tags.map((tag) => `#${tag}`).join(" ");
  for (let authorNumber = 0; authorNumber < 4; authorNumber++) {
    const author = await socialUser(t);
    for (let i = 0; i < 25; i++) {
      const draft = await post(t, author, reflection, { saves });
      if (saves > 1) {
        await t.run(async (ctx) => {
          for (const save of draft.saves) {
            await ctx.db.patch("collections", save.id, {
              snapshot: { title: "画".repeat(10_000), artist: "画".repeat(10_000) },
            });
          }
        });
      }
    }
  }

  await t.action(internal.tags.refreshPopular, {});

  expect(await t.query(api.tags.popular, {})).toEqual(tags.map((tag) => ({ tag, postCount: 100 })));
});

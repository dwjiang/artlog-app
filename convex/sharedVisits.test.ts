import type { FunctionReturnType } from "convex/server";
import { expect, it } from "vitest";

import { LIMITS, utf8Bytes } from "../shared/journal/limits";
import { DEFAULT_WALL_COLOR } from "../shared/wall/defaults";
import { api, internal } from "./_generated/api";
import { compareHistory, PAGE_BYTES } from "./lib/sharedPublications";
import { befriend, setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

const notFound = { data: { code: "not_found" } };
const conflict = { data: { code: "conflict" } };

it("publishes in the chosen order without private fields", async () => {
  const t = harness();
  const a = await socialUser(t);
  const draft = await socialVisit(t, a);
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection: "Shared words" }));
  const selection = {
    ...draft.selection,
    saveLocalIds: draft.selection.saveLocalIds.toReversed(),
    reflection: "Shared words",
  };
  const state = await a.as.mutation(api.sharedVisits.publish, selection);
  const post = await a.as.query(api.sharedVisits.get, {
    postId: state.postId!,
  });
  expect(post.artworks.page.map((x) => x.artwork.title)).toEqual(["Work 1", "Work 0"]);
  expect(JSON.stringify(post)).not.toMatch(/PRIVATE|saveLocalId|visitLocalId|accountId|storageId|scanId/);
  expect(Object.keys(post).sort()).toEqual([
    "artworkCount",
    "artworks",
    "audience",
    "author",
    "color",
    "pattern",
    "postId",
    "publishedAt",
    "reflection",
    "revision",
    "venue",
    "visitedOn",
  ]);
});

it("rejects forged selections, private visits, duplicate UUIDs, and missing shared text", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const draft = await socialVisit(t, a);
  const other = await socialVisit(t, b);
  for (const input of [
    { ...draft.selection, saveLocalIds: [other.saves[0].localId] },
    { ...draft.selection, visitLocalId: other.visit.localId },
    { ...draft.selection, saveLocalIds: [crypto.randomUUID()] },
  ]) {
    await expect(a.as.mutation(api.sharedVisits.publish, input)).rejects.toMatchObject(notFound);
  }
  const anotherVisit = await socialVisit(t, a);
  await expect(
    a.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      saveLocalIds: [anotherVisit.saves[0].localId],
    }),
  ).rejects.toMatchObject(notFound);
  for (const input of [
    {
      ...draft.selection,
      saveLocalIds: [draft.saves[0].localId, draft.saves[0].localId],
    },
    { ...draft.selection, reflection: "x".repeat(20_001) },
  ]) {
    await expect(a.as.mutation(api.sharedVisits.publish, input)).rejects.toMatchObject({
      data: { code: "invalid_post" },
    });
  }
  const { reflection: _reflection, ...missingText } = draft.selection;
  await expect(a.as.mutation(api.sharedVisits.publish, missingText as never)).rejects.toThrow(
    "Validator error: Missing required field `reflection` in object",
  );
  await a.as.mutation(api.collections.remove, {
    scope: a.scope,
    localId: draft.saves[0].localId,
  });
  await expect(a.as.mutation(api.sharedVisits.publish, draft.selection)).rejects.toMatchObject(notFound);
});

it("shows the chosen wallpaper on the post, its feed card, and the owner's next share", async () => {
  const t = harness();
  const a = await socialUser(t);
  const draft = await socialVisit(t, a);
  expect((await a.as.query(api.sharedVisits.getState, { visitLocalId: draft.visit.localId })).color).toBeUndefined();
  await expect(a.as.mutation(api.sharedVisits.publish, { ...draft.selection, color: "forest" })).rejects.toMatchObject({
    data: { code: "invalid_post" },
  });
  const { postId } = await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    color: "#45524b",
    pattern: "trellis",
  });
  const wallpaper = { color: "#45524B", pattern: "trellis" };
  expect(await a.as.query(api.sharedVisits.get, { postId: postId! })).toMatchObject(wallpaper);
  expect((await t.query(api.sharedVisits.listPublic, {})).page[0]).toMatchObject(wallpaper);
  expect(await a.as.query(api.sharedVisits.getState, { visitLocalId: draft.visit.localId })).toMatchObject(wallpaper);
  await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    revision: 1,
    color: "#FCFCF9",
    pattern: undefined,
  });
  expect(await a.as.query(api.sharedVisits.get, { postId: postId! })).not.toHaveProperty("pattern");
  const publication = await t.run((ctx) =>
    ctx.db
      .query("sharedVisits")
      .withIndex("by_postId", (q) => q.eq("postId", postId!))
      .unique(),
  );
  await t.run((ctx) => ctx.db.patch("sharedVisits", publication!._id, { color: undefined }));
  expect((await a.as.query(api.sharedVisits.get, { postId: postId! })).color).toBe(DEFAULT_WALL_COLOR);
});

it("allows empty posts and preserves identity and first publication time through edit and reshare", async () => {
  const t = harness();
  const a = await socialUser(t);
  const draft = await socialVisit(t, a, 0);
  const first = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const post = await a.as.query(api.sharedVisits.get, {
    postId: first.postId!,
  });
  expect(post.artworks.page).toEqual([]);
  expect(post.reflection).toBe("");
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection: "Edited" }));
  const edited = await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    revision: 1,
    reflection: "Edited",
  });
  expect(edited.postId).toBe(first.postId);
  expect(await setVisitVisibility(t, a, draft.visit._id, "private")).toMatchObject({
    audience: "private",
    status: "active",
    revision: 2,
  });
  await expect(t.query(api.sharedVisits.get, { postId: first.postId! })).rejects.toMatchObject(notFound);
  await expect(
    a.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      revision: 1,
    }),
  ).rejects.toMatchObject(conflict);
  await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    audience: "private",
    reflection: "Edited",
    revision: 2,
  });
  expect(await setVisitVisibility(t, a, draft.visit._id, "public")).toMatchObject({
    audience: "public",
    status: "active",
    revision: 3,
  });
  expect(await a.as.query(api.sharedVisits.get, { postId: first.postId! })).toMatchObject({
    postId: first.postId,
    publishedAt: post.publishedAt,
  });
});

it("lists only the caller’s active, unremoved shared visits", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  await befriend(a, b);
  const shared = await socialVisit(t, a);
  const unshared = await socialVisit(t, a);
  const removed = await socialVisit(t, a);
  const theirs = await socialVisit(t, b);
  for (const draft of [shared, unshared, removed]) {
    await a.as.mutation(api.sharedVisits.publish, draft.selection);
  }
  const post = await b.as.mutation(api.sharedVisits.publish, theirs.selection);
  await setVisitVisibility(t, a, unshared.visit._id, "private");
  const flagged = await a.as.query(api.sharedVisits.getState, {
    visitLocalId: removed.visit.localId,
  });
  const { reportId } = await b.as.mutation(api.reports.submit, {
    target: { kind: "sharedVisit", postId: flagged.postId! },
    reason: "harassment",
  });
  await t.mutation(internal.review.decideReport, {
    reportId,
    operator: "operator@example.test",
    decision: "remove",
    reason: "Confirmed",
  });
  expect(await a.as.query(api.sharedVisits.listShared, {})).toEqual([shared.visit.localId]);
  expect(await b.as.query(api.sharedVisits.listShared, {})).toEqual([theirs.visit.localId]);
  expect(post.postId).not.toBeNull();
  await expect(t.query(api.sharedVisits.listShared, {})).rejects.toThrow("unauthenticated");
});

it("refuses an audience the visit no longer has and serializes concurrent publication writes", async () => {
  const t = harness();
  const a = await socialUser(t);
  const draft = await socialVisit(t, a, 0);
  await setVisitVisibility(t, a, draft.visit._id, "private");
  await expect(a.as.mutation(api.sharedVisits.publish, draft.selection)).rejects.toMatchObject(conflict);
  await setVisitVisibility(t, a, draft.visit._id, "public");
  const results = await Promise.allSettled([0, 1].map(() => a.as.mutation(api.sharedVisits.publish, draft.selection)));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rows = await t.run((ctx) => ctx.db.query("sharedVisits").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].publishedAt).toBeGreaterThan(0);
});

it("allows public access before friendship and revokes detail, artwork, and feed together after blocking", async () => {
  const t = harness();
  const a = await socialUser(t);
  const b = await socialUser(t);
  const draft = await socialVisit(t, a);
  const state = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = state.postId!;
  const ownerPost = await a.as.query(api.sharedVisits.get, { postId });
  const { itemId } = ownerPost.artworks.page[0];
  expect(await b.as.query(api.sharedVisits.get, { postId })).toMatchObject({
    postId,
  });
  expect((await b.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  await expect(b.as.query(api.sharedVisits.get, { postId: crypto.randomUUID() })).rejects.toMatchObject(notFound);
  await expect(
    b.as.query(api.sharedVisits.getState, {
      visitLocalId: draft.visit.localId,
    }),
  ).rejects.toMatchObject(notFound);
  expect((await a.as.query(api.sharedVisits.listFeed, {})).page.map((p) => p.postId)).toEqual([postId]);
  await befriend(a, b);
  expect((await b.as.query(api.sharedVisits.listFeed, {})).page.map((p) => p.postId)).toEqual([postId]);
  expect(
    (
      await a.as.query(api.sharedVisits.listByProfile, {
        profileId: a.profileId,
      })
    ).page,
  ).toHaveLength(1);
  expect(await b.as.query(api.sharedVisits.getArtwork, { postId, itemId })).toMatchObject({
    itemId,
  });
  const other = await socialVisit(t, a);
  const otherPost = await a.as.mutation(api.sharedVisits.publish, other.selection);
  await expect(
    b.as.query(api.sharedVisits.getArtwork, {
      postId: otherPost.postId!,
      itemId,
    }),
  ).rejects.toMatchObject(notFound);
  await b.as.mutation(api.friendships.block, {
    scope: b.scope,
    profileId: a.profileId,
  });
  await expect(b.as.query(api.sharedVisits.getArtwork, { postId, itemId })).rejects.toMatchObject(notFound);
  await expect(b.as.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
  expect((await b.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect(await a.as.query(api.sharedVisits.get, { postId })).toMatchObject({
    postId,
  });
});

it("updates dates atomically, leaves shared text unchanged, and retains a post after its last save is deleted", async () => {
  const t = harness();
  const a = await socialUser(t);
  const draft = await socialVisit(t, a, 1);
  await t.run((ctx) => ctx.db.patch("visits", draft.visit._id, { reflection: "Shared text" }));
  const state = await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    reflection: "Shared text",
  });
  await a.as.mutation(api.visits.upsertJournal, {
    scope: a.scope,
    visit: {
      visibility: "public" as const,
      localId: draft.visit.localId,
      venueId: draft.visit.venueId,
      timeZone: "UTC",
      visitedOn: "2026-08-01",
      reflection: "UNPUBLISHED EDIT",
    },
  });
  expect(await a.as.query(api.sharedVisits.get, { postId: state.postId! })).toMatchObject({
    visitedOn: "2026-08-01",
    reflection: "Shared text",
    revision: 2,
  });
  await a.as.mutation(api.collections.remove, {
    scope: a.scope,
    localId: draft.saves[0].localId,
  });
  const post = await a.as.query(api.sharedVisits.get, {
    postId: state.postId!,
  });
  expect(post.artworks.page).toEqual([]);
  expect(post.revision).toBe(3);
  expect(await t.run((ctx) => ctx.db.get("visits", draft.visit._id))).not.toBeNull();
});

it("merges date and post-ID keysets across friends without losing tied records or accepting foreign cursors", async () => {
  const t = harness();
  const viewer = await socialUser(t);
  const a = await socialUser(t);
  const b = await socialUser(t);
  await befriend(viewer, a);
  await befriend(viewer, b);
  const expected = [];
  for (const user of [a, b]) {
    for (const date of ["2026-09-01", "2026-08-31", "2026-09-01"]) {
      const draft = await socialVisit(t, user, 0, date);
      const result = await user.as.mutation(api.sharedVisits.publish, draft.selection);
      expected.push({ visitedOn: date, postId: result.postId! });
    }
  }
  let cursor: string | null = null;
  const seen = [];
  const feedCursors: string[] = [];
  do {
    const result: FunctionReturnType<typeof api.sharedVisits.listFeed> = await viewer.as.query(
      api.sharedVisits.listFeed,
      { limit: 2, cursor },
    );
    seen.push(...result.page.map((p) => ({ visitedOn: p.visitedOn, postId: p.postId })));
    cursor = result.cursor;
    if (cursor) feedCursors.push(cursor);
  } while (cursor);
  expect(seen).toEqual(expected.sort((a, b) => -compareHistory(a, b)));
  for (const feedCursor of feedCursors) {
    await expect(
      viewer.as.query(api.sharedVisits.listByProfile, {
        profileId: a.profileId,
        cursor: feedCursor,
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_pagination" } });
  }
  for (const args of [{ cursor: "{}" }, { cursor: "bad" }, { cursor: "x".repeat(8193) }, { limit: 51 }]) {
    await expect(viewer.as.query(api.sharedVisits.listFeed, args)).rejects.toMatchObject({
      data: { code: "invalid_pagination" },
    });
  }
});

it("bounds maximum-size artwork responses with continuation pages and revision-bound cursors", async () => {
  const t = harness({ transactionLimits: true });
  const a = await socialUser(t);
  const draft = await socialVisit(t, a, LIMITS.selectedSaves);
  for (const save of draft.saves) {
    await t.run((ctx) =>
      ctx.db.patch("collections", save.id, {
        snapshot: {
          title: "界".repeat(LIMITS.snapshot),
          artist: "界".repeat(LIMITS.snapshot),
          date: "界".repeat(LIMITS.snapshot),
          medium: "界".repeat(LIMITS.snapshot),
          institution: "界".repeat(LIMITS.snapshot),
        },
        note: "界".repeat(LIMITS.note),
        venueName: "界".repeat(LIMITS.snapshot),
        gallery: "界".repeat(LIMITS.snapshot),
      }),
    );
  }
  const state = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const seen = [];
  let cursor: string | null = null;
  do {
    const post: FunctionReturnType<typeof api.sharedVisits.get> = await a.as.query(api.sharedVisits.get, {
      postId: state.postId!,
      limit: 50,
      cursor,
    });
    expect(utf8Bytes(post.artworks.page)).toBeLessThanOrEqual(PAGE_BYTES);
    expect(post.artworks.page.length).toBeGreaterThan(0);
    seen.push(...post.artworks.page.map((x) => x.itemId));
    cursor = post.artworks.cursor;
  } while (cursor);
  expect(new Set(seen).size).toBe(LIMITS.selectedSaves);
  const first = await a.as.query(api.sharedVisits.get, {
    postId: state.postId!,
    limit: 1,
  });
  await a.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    revision: 1,
    saveLocalIds: draft.selection.saveLocalIds.toReversed(),
  });
  await expect(
    a.as.query(api.sharedVisits.get, {
      postId: state.postId!,
      cursor: first.artworks.cursor,
    }),
  ).rejects.toMatchObject(conflict);
});

it("shares the publication quota across account devices while allowing a Private save after exhaustion", async () => {
  const { seedDevice } = await import("./lib/testFactories");
  const t = harness();
  const a = await socialUser(t);
  const sibling = await seedDevice(t);
  const draft = await socialVisit(t, a, 0);
  await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: a.accountId }));
  for (let revision = 0; revision < 30; revision++) {
    await a.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      revision,
    });
  }
  await expect(
    sibling.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      revision: 30,
    }),
  ).rejects.toMatchObject({
    data: { code: "rate_limited", name: "publishVisit" },
  });
  expect(await setVisitVisibility(t, { ...sibling, scope: a.scope }, draft.visit._id, "private")).toMatchObject({
    audience: "private",
    revision: 30,
  });
});

it("merges 200 friend streams under transaction limits and honors short-page cursors", async () => {
  const { canonicalPair } = await import("./lib/friendships");
  const t = harness({ transactionLimits: true });
  const viewer = await socialUser(t);
  const expected = await t.run(async (ctx) => {
    const venueId = await ctx.db.insert("museums", {
      key: "stress",
      name: "Museum",
      lat: 0,
      lng: 0,
      seedSource: "manual",
      region: "US",
      optOut: false,
      contributionRevision: 0,
    });
    const postIds = [];
    for (let i = 0; i < LIMITS.friends; i++) {
      const accountId = await ctx.db.insert("accounts", {
        provider: "apple",
        providerUserId: `stress-${i}`,
      });
      const profileId = await ctx.db.insert("profiles", {
        accountId,
        username: `stress_${i}`,
        name: "Friend",
        searchText: "friend",
        active: true,
        leaderboardVisibility: "global",
        publishedWallCount: 0,
        updatedAt: 1,
      });
      const owner = { kind: "account" as const, accountId };
      const visitLocalId = crypto.randomUUID();
      const postId = crypto.randomUUID();
      const visitId = await ctx.db.insert("visits", {
        visibility: "public" as const,
        owner,
        localId: visitLocalId,
        venueId,
        venueName: "Museum",
        visitedOn: "2026-09-01",
        timeZone: "UTC",
        updatedAt: 1,
        updatedBy: viewer.deviceId,
        changeVersion: 1,
      });
      const publicationId = await ctx.db.insert("sharedVisits", {
        audience: "public",
        postId,
        profileId,
        visitId,
        visitLocalId,
        visitedOn: "2026-09-01",
        status: "active",
        reflection: "",
        publishedAt: 1,
        updatedAt: 1,
        publicationRevision: 1,
      });
      for (let position = 0; position < 3; position++) {
        const localId = crypto.randomUUID();
        const saveId = await ctx.db.insert("collections", {
          owner,
          localId,
          visitId,
          visitLocalId,
          venueId,
          snapshot: { title: "Work", artist: "Artist" },
          savedAt: 1,
          updatedAt: 1,
          updatedBy: viewer.deviceId,
          changeVersion: 1,
        });
        await ctx.db.insert("sharedVisitItems", {
          publicationId,
          saveId,
          saveLocalId: localId,
          position,
          highlighted: true,
        });
      }
      const [firstProfileId, secondProfileId] = canonicalPair(viewer.profileId, profileId);
      await ctx.db.insert("friendships", {
        firstProfileId,
        secondProfileId,
        requesterId: viewer.profileId,
        state: "accepted",
        revision: 2,
        updatedAt: 1,
      });
      postIds.push(postId);
    }
    return postIds;
  });
  let cursor: string | null = null;
  const seen = [];
  do {
    const result: FunctionReturnType<typeof api.sharedVisits.listFeed> = await viewer.as.query(
      api.sharedVisits.listFeed,
      { limit: 50, cursor },
    );
    expect(result.page.length).toBeGreaterThan(0);
    expect(result.page.length).toBeLessThan(50);
    expect(result.page.reduce((sum, p) => sum + p.artworks.page.length, 0)).toBeLessThanOrEqual(50);
    expect(utf8Bytes(result)).toBeLessThan(PAGE_BYTES);
    seen.push(...result.page.map((p) => p.postId));
    cursor = result.cursor;
  } while (cursor);
  expect(seen).toEqual(expected.sort().reverse());
}, 30_000);

it("publishes artworks in the chosen order and leads feed cards with the first three", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const draft = await socialVisit(t, owner, 4);
  const order = [3, 1, 0, 2].map((i) => draft.saves[i].localId);
  const published = await owner.as.mutation(api.sharedVisits.publish, { ...draft.selection, saveLocalIds: order });
  expect(published.saveLocalIds).toEqual(order);
  const post = await t.query(api.sharedVisits.get, { postId: published.postId! });
  expect(post.artworks.page.map((item) => item.artwork.title)).toEqual(["Work 3", "Work 1", "Work 0", "Work 2"]);
  const [card] = (await t.query(api.sharedVisits.listPublic, {})).page;
  expect(card.artworks.page.map((item) => item.artwork.title)).toEqual(["Work 3", "Work 1", "Work 0"]);
  const reordered = [order[3], ...order.slice(0, 3)];
  await owner.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    saveLocalIds: reordered,
    revision: published.revision,
  });
  const [updated] = (await t.query(api.sharedVisits.listPublic, {})).page;
  expect(updated.artworks.page.map((item) => item.artwork.title)).toEqual(["Work 2", "Work 3", "Work 1"]);
});

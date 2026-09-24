import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

const notFound = { data: { code: "not_found" } };

it("exposes only published visits and revokes detail, artwork, and media access when made private", async () => {
  const t = harness();
  const author = await socialUser(t);
  const friend = await socialUser(t);
  const privateVisit = await socialVisit(t, author);
  const publicVisit = await socialVisit(t, author);
  await setVisitVisibility(t, author, privateVisit.visit._id, "private");
  const media = await socialDerivative(t, author, publicVisit.saves[0].id);
  const published = await author.as.mutation(api.sharedVisits.publish, {
    ...publicVisit.selection,
    audience: "public",
  });
  const feed = await t.query(api.sharedVisits.listPublic, {});
  expect(feed.page.map((post) => post.postId)).toEqual([published.postId]);
  const post = await t.query(api.sharedVisits.get, {
    postId: published.postId!,
  });
  expect(post.audience).toBe("public");
  expect(JSON.stringify(post)).not.toMatch(/PRIVATE|accountId|storageId|saveLocalId|visitLocalId/);
  const { itemId } = post.artworks.page[0];
  const context = { kind: "sharedVisit" as const, postId: post.postId, itemId };
  expect(await t.query(internal.sharedMedia.authorize, { context })).toBe(media.storageId);
  expect(
    (
      await t.query(api.sharedVisits.listByProfile, {
        profileId: author.profileId,
      })
    ).page.map((item) => item.postId),
  ).toEqual([post.postId]);
  expect(await t.query(api.sharedVisits.getArtwork, { postId: post.postId, itemId })).toMatchObject({ itemId });
  await setVisitVisibility(t, author, publicVisit.visit._id, "private");
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  await expect(t.query(internal.sharedMedia.authorize, { context })).rejects.toMatchObject(notFound);
  await expect(t.query(api.sharedVisits.get, { postId: post.postId })).rejects.toMatchObject(notFound);
  await expect(t.query(api.sharedVisits.getArtwork, { postId: post.postId, itemId })).rejects.toMatchObject(notFound);
  await befriend(author, friend);
  await expect(friend.as.query(api.sharedVisits.get, { postId: post.postId })).rejects.toMatchObject(notFound);
});

it("paginates public visits with tied dates, filters blocked authors, and honors unsharing", async () => {
  const t = harness();
  const author = await socialUser(t);
  const viewer = await socialUser(t);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const draft = await socialVisit(t, author);
    const state = await author.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      audience: "public",
    });
    ids.push(state.postId!);
  }
  const first = await t.query(api.sharedVisits.listPublic, { limit: 1 });
  const second = await t.query(api.sharedVisits.listPublic, {
    limit: 2,
    cursor: first.cursor,
  });
  expect([...first.page, ...second.page].map((post) => post.postId)).toEqual(ids.sort().reverse());
  await viewer.as.mutation(api.friendships.block, {
    profileId: author.profileId,
    revision: 0,
    blockRevision: 0,
  });
  expect((await viewer.as.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  await expect(viewer.as.query(api.sharedVisits.get, { postId: ids[0] })).rejects.toMatchObject(notFound);
  const blocked = await socialUser(t);
  await author.as.mutation(api.friendships.block, {
    profileId: blocked.profileId,
    revision: 0,
    blockRevision: 0,
  });
  for (const user of [viewer, blocked]) {
    expect(
      await user.as.query(api.sharedVisits.listByProfile, {
        profileId: author.profileId,
        limit: 1,
      }),
    ).toEqual({ page: [], cursor: null, isDone: true });
  }
  const draft = await socialVisit(t, author);
  const state = await author.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    audience: "public",
  });
  await setVisitVisibility(t, author, draft.visit._id, "private");
  await expect(t.query(api.sharedVisits.get, { postId: state.postId! })).rejects.toMatchObject(notFound);
});

it("does not reveal private history through public profile pagination cursors", async () => {
  const t = harness();
  const author = await socialUser(t);
  const draft = await socialVisit(t, author, 0);
  await setVisitVisibility(t, author, draft.visit._id, "private");
  await t.run(async (ctx) => {
    for (let i = 0; i < 55; i++) {
      const localId = crypto.randomUUID();
      const { _id: _visitId, _creationTime: _created, ...visit } = draft.visit;
      const visitId = await ctx.db.insert("visits", { ...visit, localId });
      await ctx.db.insert("sharedVisits", {
        profileId: author.profileId,
        postId: crypto.randomUUID(),
        visitId,
        visitLocalId: localId,
        visitedOn: draft.visit.visitedOn,
        audience: "public",
        status: "private",
        reflection: "",
        publishedAt: 1,
        updatedAt: 1,
        publicationRevision: 1,
      });
    }
  });
  expect(
    await t.query(api.sharedVisits.listByProfile, {
      profileId: author.profileId,
      limit: 1,
    }),
  ).toEqual({ page: [], cursor: null, isDone: true });
});

it("rejects Friends-only preview and publication requests", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const draft = await socialVisit(t, owner);
  const input = { ...draft.selection, audience: "friends" as never };
  await expect(owner.as.query(api.sharedVisits.preview, input)).rejects.toThrow(
    "Validator error: Expected `public`, got `friends`",
  );
  await expect(owner.as.mutation(api.sharedVisits.publish, input)).rejects.toThrow(
    "Validator error: Expected `public`, got `friends`",
  );
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
});

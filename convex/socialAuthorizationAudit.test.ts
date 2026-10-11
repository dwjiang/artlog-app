import { expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { befriend, setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness, type Harness } from "./test.helpers";

const denied = (request: Promise<unknown>, code = "not_found") =>
  expect(request).rejects.toMatchObject({ data: { code } });

async function hiddenPost(client: Pick<Harness, "query">, postId: string, itemId: Id<"sharedVisitItems">) {
  await denied(client.query(api.sharedVisits.get, { postId }));
  await denied(client.query(api.sharedVisits.getArtwork, { postId, itemId }));
  await denied(client.query(api.visitReactions.getSummary, { postId }));
  await denied(client.query(api.visitReactions.listLikes, { postId }));
  await denied(client.query(api.visitReactions.listComments, { postId }));
}

it("rejects anonymous reads and mutations across private journal and social state", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const { visit, saves, selection } = await socialVisit(t, owner, 1);
  const { scope } = owner;
  const { localId } = saves[0];
  const requests = [
    () => t.query(api.visits.detail, { scope, localId: visit.localId }),
    () => t.query(api.visits.history, { scope }),
    () => t.query(api.visits.savedWorks, { scope, localId: visit.localId }),
    () => t.query(api.collections.listMine, { scope }),
    () => t.query(api.photoVisibility.forArtwork, { scope, savedLocalId: localId }),
    () => t.query(api.sharedVisits.getState, { visitLocalId: visit.localId }),
    () => t.query(api.sharedVisits.listShared, {}),
    () => t.query(api.sharedVisits.listFeed, {}),
    () => t.query(api.profiles.mine, {}),
    () => t.query(api.profiles.friends, { profileId: owner.profileId }),
    () => t.query(api.profiles.requests, {}),
    () => t.query(api.profiles.usernameAvailable, { username: "available" }),
    () => t.query(api.profiles.suggestUsername, { name: "Available" }),
    () => t.query(api.friendships.getState, { profileId: owner.profileId }),
    () => t.query(api.friendships.listBlocked, {}),
    () => t.query(api.walls.getMine, {}),
    () => t.query(api.notifications.list, {}),
    () => t.query(api.notifications.unseen, {}),
    () => t.query(api.leaderboards.preference, {}),
    () => t.mutation(api.notifications.markSeen, { through: 0 }),
    () => t.mutation(api.leaderboards.setPreference, { visibility: "off" }),
    () => t.mutation(api.collections.remove, { scope, localId }),
    () => t.mutation(api.artworkAlbums.sync, { scope, since: 0, photos: [], encounters: [] }),
    () => t.mutation(api.artworkAlbums.merge, { scope, sourceLocalId: localId, targetLocalId: crypto.randomUUID() }),
    () => t.mutation(api.sync.syncJournal, { scope, since: 0, visits: [], saves: [] }),
    () => t.mutation(api.journalClaims.resume, { scope }),
    () => t.mutation(api.visitCompanions.leave, { postId: crypto.randomUUID() }),
    () => t.action(api.sharedVisits.publish, selection),
  ];
  for (const request of requests) {
    await expect(request()).rejects.toMatchObject({ data: { code: "unauthenticated" } });
  }
});

it("never treats another owner's scope or local IDs as authority to read or attach journal data", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await socialUser(t);
  const { visit, saves, selection } = await socialVisit(t, owner, 1);
  const { localId } = saves[0];
  const { scope } = other;
  await denied(other.as.query(api.visits.detail, { scope: owner.scope, localId: visit.localId }), "sync_scope_changed");
  await denied(other.as.query(api.collections.listMine, { scope: owner.scope }), "sync_scope_changed");
  await denied(
    other.as.mutation(api.sync.syncJournal, { scope: owner.scope, since: 0, visits: [], saves: [] }),
    "sync_scope_changed",
  );
  await denied(other.as.mutation(api.journalClaims.resume, { scope: owner.scope }), "sync_scope_changed");
  await denied(other.as.query(api.visits.detail, { scope, localId: visit.localId }));
  await denied(other.as.query(api.visits.savedWorks, { scope, localId: visit.localId }));
  await denied(other.as.query(api.sharedVisits.getState, { visitLocalId: visit.localId }));
  await denied(other.as.mutation(api.collections.remove, { scope, localId }));
  await denied(
    other.as.mutation(api.collections.saveToCollection, {
      scope,
      localId: crypto.randomUUID(),
      visitLocalId: visit.localId,
      savedAt: 1,
      snapshot: { title: "Foreign visit", artist: "Artist" },
      suggested: null,
    }),
  );
  await denied(
    other.as.mutation(api.artworkAlbums.sync, {
      scope,
      since: 0,
      photos: [{ localId: crypto.randomUUID(), savedLocalId: localId, kind: "full", capturedAt: 1 }],
      encounters: [],
    }),
  );
  await denied(other.as.action(api.sharedVisits.publish, selection));
  expect(await other.as.query(api.photoVisibility.forArtwork, { scope, savedLocalId: localId })).toEqual([]);
  expect((await other.as.query(api.visits.history, { scope })).page).toEqual([]);
  expect((await other.as.query(api.collections.listMine, { scope })).page).toEqual([]);
  const sync = await other.as.mutation(api.sync.syncJournal, { scope, since: 0, visits: [], saves: [] });
  expect(sync.visits).toEqual([]);
  expect(sync.saves).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get("collections", saves[0].id))).not.toHaveProperty("deletedAt");
});

it("revokes every post and reaction boundary immediately after friendship removal", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  const outsider = await socialUser(t);
  await befriend(owner, friend);
  const { visit, selection } = await socialVisit(t, owner, 1);
  await setVisitVisibility(t, owner, visit._id, "friends");
  const published = await owner.as.action(api.sharedVisits.publish, { ...selection, audience: "friends" });
  const postId = published.postId!;
  const { itemId } = (await friend.as.query(api.sharedVisits.get, { postId })).artworks.page[0];
  const commentId = await friend.as.action(api.visitReactions.addComment, {
    postId,
    body: "A private conversation",
    requestId: crypto.randomUUID(),
  });
  await friend.as.mutation(api.visitReactions.setLike, { postId, liked: true });
  await hiddenPost(t, postId, itemId);
  await hiddenPost(outsider.as, postId, itemId);
  const edge = await owner.as.query(api.friendships.getState, { profileId: friend.profileId });
  await owner.as.mutation(api.friendships.remove, { profileId: friend.profileId, revision: edge.revision });
  await hiddenPost(friend.as, postId, itemId);
  await denied(friend.as.mutation(api.visitReactions.setLike, { postId, liked: true }));
  await denied(friend.as.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: true }));
  await denied(
    friend.as.action(api.visitReactions.addComment, {
      postId,
      body: "No longer allowed",
      requestId: crypto.randomUUID(),
    }),
  );
  expect((await friend.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect((await friend.as.query(api.sharedVisits.listByProfile, { profileId: owner.profileId })).page).toEqual([]);
  expect(await friend.as.query(api.mentions.suggest, { query: "", place: { kind: "comment", postId } })).toEqual([]);
  expect((await owner.as.query(api.sharedVisits.get, { postId })).artworks.page).toHaveLength(1);
});

it("requires publication before exposing a visit and removes access when it becomes private", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  await befriend(owner, friend);
  const { visit, selection } = await socialVisit(t, owner, 1);
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect((await friend.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect((await t.query(api.sharedVisits.listByProfile, { profileId: owner.profileId })).page).toEqual([]);
  await denied(t.query(api.sharedVisits.get, { postId: visit.localId }));
  const published = await owner.as.action(api.sharedVisits.publish, selection);
  const postId = published.postId!;
  const { itemId } = (await t.query(api.sharedVisits.get, { postId })).artworks.page[0];
  await setVisitVisibility(t, owner, visit._id, "private");
  await hiddenPost(t, postId, itemId);
  await hiddenPost(friend.as, postId, itemId);
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect((await friend.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect(
    (await friend.as.query(api.sharedVisits.listByProfile, { profileId: owner.profileId, audience: "private" })).page,
  ).toEqual([]);
  expect((await owner.as.query(api.sharedVisits.get, { postId })).artworks.page).toHaveLength(1);
});

it("checks comment ownership and its post instead of accepting a readable post as authority", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const other = await socialUser(t);
  const first = await socialVisit(t, owner, 0);
  const second = await socialVisit(t, owner, 0);
  const firstPost = (await owner.as.action(api.sharedVisits.publish, first.selection)).postId!;
  const secondPost = (await owner.as.action(api.sharedVisits.publish, second.selection)).postId!;
  const commentId = await owner.as.action(api.visitReactions.addComment, {
    postId: firstPost,
    body: "Keep this comment",
    requestId: crypto.randomUUID(),
  });
  await denied(other.as.mutation(api.visitReactions.deleteComment, { postId: firstPost, commentId }));
  await denied(other.as.mutation(api.visitReactions.setCommentLike, { postId: secondPost, commentId, liked: true }));
  await denied(owner.as.mutation(api.visitReactions.deleteComment, { postId: secondPost, commentId }));
  expect(
    (await t.query(api.visitReactions.listComments, { postId: firstPost })).page.map((comment) => comment.body),
  ).toEqual(["Keep this comment"]);
});

it("hides deleted saves and accounts even when callers retain former public item IDs", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const { saves, selection } = await socialVisit(t, owner, 1);
  const postId = (await owner.as.action(api.sharedVisits.publish, selection)).postId!;
  const { itemId } = (await t.query(api.sharedVisits.get, { postId })).artworks.page[0];
  await owner.as.mutation(api.collections.remove, { scope: owner.scope, localId: saves[0].localId });
  await denied(t.query(api.sharedVisits.getArtwork, { postId, itemId }));
  expect((await t.query(api.sharedVisits.get, { postId })).artworks.page).toEqual([]);
  await t.run((ctx) => ctx.db.delete("accounts", owner.accountId));
  await hiddenPost(t, postId, itemId);
  expect(await t.query(api.profiles.getPublic, { profileId: owner.profileId })).toBeNull();
  expect(await t.query(api.walls.getPublic, { profileId: owner.profileId })).toBeNull();
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
});

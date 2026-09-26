import { expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { befriend, setVisitVisibility, socialDerivative, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

const notFound = { data: { code: "not_found" } };

it("saves a visibility without publishing and publishes only to the visit's current visibility", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const stranger = await socialUser(t);
  const draft = await socialVisit(t, owner, 0);
  const input = {
    localId: draft.visit.localId,
    venueId: draft.visit.venueId,
    visitedOn: draft.visit.visitedOn,
    timeZone: "UTC",
  };
  const save = (visibility: "public" | "private") =>
    owner.as.mutation(api.visits.upsertJournal, {
      scope: owner.scope,
      visit: { ...input, visibility },
    });
  expect(await save("public")).toMatchObject({ visibility: "public" });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  await save("private");
  await expect(owner.as.mutation(api.sharedVisits.publish, draft.selection)).rejects.toMatchObject({
    data: { code: "conflict" },
  });
  const published = await owner.as.mutation(api.sharedVisits.publish, { ...draft.selection, audience: "private" });
  expect(published).toMatchObject({ status: "active", audience: "private" });
  const postId = published.postId!;
  await expect(owner.as.query(api.sharedVisits.get, { postId })).resolves.toMatchObject({ audience: "private" });
  for (const viewer of [t, stranger.as]) {
    await expect(viewer.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
  }
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(await owner.as.query(api.sharedVisits.listShared, {})).toEqual([]);
});

it("keeps a Private publication for its owner alone and shares it again when the visit opens up", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  await befriend(owner, friend);
  const draft = await socialVisit(t, owner, 1);
  const published = await owner.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = published.postId!;
  const visible = await t.query(api.sharedVisits.get, { postId });
  const [{ itemId }] = visible.artworks.page;
  const hidden = await setVisitVisibility(t, owner, draft.visit._id, "private");
  expect(hidden).toMatchObject({ status: "active", audience: "private", revision: published.revision });
  for (const viewer of [t, friend.as]) {
    await expect(viewer.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
    await expect(viewer.query(api.sharedVisits.getArtwork, { postId, itemId })).rejects.toMatchObject(notFound);
    expect((await viewer.query(api.sharedVisits.listByProfile, { profileId: owner.profileId })).page).toEqual([]);
  }
  expect((await friend.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(await owner.as.query(api.sharedVisits.listShared, {})).toEqual([]);
  expect((await owner.as.query(api.sharedVisits.listByProfile, { profileId: owner.profileId })).page).toHaveLength(1);
  await expect(owner.as.query(api.sharedVisits.getArtwork, { postId, itemId })).resolves.toMatchObject({ itemId });
  await setVisitVisibility(t, owner, draft.visit._id, "public");
  await expect(t.query(api.sharedVisits.get, { postId })).resolves.toMatchObject({ audience: "public" });
  expect(await owner.as.query(api.sharedVisits.listShared, {})).toEqual([draft.visit.localId]);
});

it("shows a Friends visit only to the owner and accepted friends", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const friend = await socialUser(t);
  const stranger = await socialUser(t);
  await befriend(owner, friend);
  const draft = await socialVisit(t, owner);
  const media = await socialDerivative(t, owner, draft.saves[0].id);
  expect(await setVisitVisibility(t, owner, draft.visit._id, "friends")).toMatchObject({ audience: "friends" });
  const { postId } = await owner.as.mutation(api.sharedVisits.publish, { ...draft.selection, audience: "friends" });
  const post = await friend.as.query(api.sharedVisits.get, { postId: postId! });
  expect(post.audience).toBe("friends");
  await expect(owner.as.query(api.sharedVisits.get, { postId: postId! })).resolves.toMatchObject({ postId });
  expect((await friend.as.query(api.sharedVisits.listFeed, {})).page.map((row) => row.postId)).toEqual([postId]);
  const byProfile = { profileId: owner.profileId };
  expect((await friend.as.query(api.sharedVisits.listByProfile, byProfile)).page).toHaveLength(1);
  const context = { kind: "sharedVisit" as const, postId: postId!, itemId: post.artworks.page[0].itemId };
  expect(await friend.as.query(internal.sharedMedia.authorize, { context })).toBe(media.storageId);
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect((await friend.as.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect((await t.query(api.sharedVisits.listByProfile, byProfile)).page).toEqual([]);
  expect((await stranger.as.query(api.sharedVisits.listByProfile, byProfile)).page).toEqual([]);
  for (const viewer of [t, stranger.as]) {
    await expect(viewer.query(api.sharedVisits.get, { postId: postId! })).rejects.toMatchObject(notFound);
    await expect(viewer.query(internal.sharedMedia.authorize, { context })).rejects.toMatchObject(notFound);
  }
});

it("moves a published visit between Friends and Public without republishing", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const draft = await socialVisit(t, owner);
  const published = await owner.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = published.postId!;
  const hidden = await setVisitVisibility(t, owner, draft.visit._id, "friends");
  expect(hidden).toMatchObject({ audience: "friends", status: "active", revision: published.revision });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  await expect(t.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
  expect(await setVisitVisibility(t, owner, draft.visit._id, "public")).toMatchObject({ audience: "public" });
  expect((await t.query(api.sharedVisits.listPublic, {})).page.map((row) => row.postId)).toEqual([postId]);
  expect((await t.query(api.sharedVisits.get, { postId })).audience).toBe("public");
});

it("offers the visit's current visibility as the audience", async () => {
  const t = harness();
  const owner = await socialUser(t);
  const draft = await socialVisit(t, owner);
  expect(await setVisitVisibility(t, owner, draft.visit._id, "private")).toMatchObject({ audience: "private" });
  expect(await setVisitVisibility(t, owner, draft.visit._id, "friends")).toMatchObject({ audience: "friends" });
  expect(await setVisitVisibility(t, owner, draft.visit._id, "public")).toMatchObject({ audience: "public" });
});

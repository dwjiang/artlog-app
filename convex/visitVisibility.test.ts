import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { harness } from "./test.helpers";
import { socialUser, socialVisit } from "./lib/socialTestFixtures";

it("saves Public without publishing and prevents publication while Private", async () => {
  const t = harness(),
    owner = await socialUser(t),
    draft = await socialVisit(t, owner, 0);
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
  const privateVisit = await save("private");
  expect(privateVisit.visibility).toBe("private");
  await expect(owner.as.query(api.sharedVisits.preview, draft.selection)).resolves.toMatchObject({
    visitedOn: privateVisit.visitedOn,
  });
  await expect(owner.as.mutation(api.sharedVisits.publish, draft.selection)).rejects.toMatchObject({
    data: { code: "visit_private" },
  });
  await save("public");
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(await owner.as.mutation(api.sharedVisits.publish, draft.selection)).toMatchObject({
    status: "active",
  });
});

it("syncing Private withdraws the entire publication and Public does not restore it until republished", async () => {
  const t = harness(),
    owner = await socialUser(t),
    draft = await socialVisit(t, owner, 1);
  const published = await owner.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = published.postId!;
  const visible = await t.query(api.sharedVisits.get, { postId });
  const input = {
    localId: draft.visit.localId,
    venueId: draft.visit.venueId,
    visitedOn: draft.visit.visitedOn,
    timeZone: "UTC",
    reflection: "My notes",
  };
  await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: { ...input, visibility: "private" },
  });
  const hidden = await owner.as.query(api.sharedVisits.getState, {
    visitLocalId: draft.visit.localId,
  });
  expect(hidden).toMatchObject({
    status: "private",
    revision: published.revision + 1,
  });
  await expect(t.query(api.sharedVisits.get, { postId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await expect(
    t.query(api.sharedVisits.getArtwork, {
      postId,
      itemId: visible.artworks.page[0].itemId,
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(
    (
      await t.query(api.sharedVisits.listByProfile, {
        profileId: owner.profileId,
      })
    ).page,
  ).toEqual([]);
  expect(await owner.as.query(api.sharedVisits.listShared, {})).toEqual([]);
  await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: { ...input, visibility: "public" },
  });
  await expect(t.query(api.sharedVisits.get, { postId })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  await expect(
    owner.as.mutation(api.sharedVisits.publish, {
      ...draft.selection,
      reflection: input.reflection,
      revision: published.revision,
    }),
  ).rejects.toMatchObject({ data: { code: "conflict" } });
  await owner.as.mutation(api.sharedVisits.publish, {
    ...draft.selection,
    reflection: input.reflection,
    revision: hidden.revision,
  });
  expect((await t.query(api.sharedVisits.get, { postId })).reflection).toBe(input.reflection);
});

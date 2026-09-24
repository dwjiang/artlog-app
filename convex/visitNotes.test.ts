import { expect, it } from "vitest";
import { api } from "./_generated/api";
import { harness } from "./test.helpers";
import { setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";

it("defaults publishing to public and exposes notes only after publishing the visit", async () => {
  const t = harness(),
    owner = await socialUser(t),
    draft = await socialVisit(t, owner, 0);
  const input = {
    visibility: "public" as const,
    localId: draft.visit.localId,
    venueId: draft.visit.venueId,
    visitedOn: draft.visit.visitedOn,
    timeZone: "UTC",
    reflection: "The afternoon light",
  };
  const visit = await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: input,
  });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  const state = await owner.as.query(api.sharedVisits.getState, {
    visitLocalId: visit.localId,
  });
  expect(state).toMatchObject({ audience: "public", status: "private" });
  expect(state.reflection).toBe(input.reflection);
  const selection = {
    ...draft.selection,
    audience: "public" as const,
    reflection: state.reflection,
  };
  expect((await owner.as.query(api.sharedVisits.preview, selection)).reflection).toBe(input.reflection);
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  const published = await owner.as.mutation(api.sharedVisits.publish, selection);
  expect((await t.query(api.sharedVisits.get, { postId: published.postId! })).reflection).toBe(input.reflection);
});

it("makes the whole visit private, hiding its notes and artworks from detail, profile history, and feeds", async () => {
  const t = harness(),
    owner = await socialUser(t),
    draft = await socialVisit(t, owner, 1);
  await t.run((ctx) => ctx.db.patch(draft.visit._id, { reflection: "Visit memory" }));
  const selection = {
    ...draft.selection,
    audience: "public" as const,
    reflection: "Visit memory",
  };
  expect((await owner.as.query(api.sharedVisits.preview, selection)).reflection).toBe("Visit memory");
  const published = await owner.as.mutation(api.sharedVisits.publish, selection);
  const visible = await t.query(api.sharedVisits.get, {
    postId: published.postId!,
  });
  expect(visible.reflection).toBe("Visit memory");
  expect(visible.artworks.page).toHaveLength(1);
  expect((await t.query(api.sharedVisits.listPublic, {})).page[0].reflection).toBe("Visit memory");
  expect(
    (
      await t.query(api.sharedVisits.listByProfile, {
        profileId: owner.profileId,
      })
    ).page[0].reflection,
  ).toBe("Visit memory");
  const hidden = await setVisitVisibility(t, owner, draft.visit._id, "private");
  expect(hidden.status).toBe("private");
  await expect(t.query(api.sharedVisits.get, { postId: published.postId! })).rejects.toMatchObject({
    data: { code: "not_found" },
  });
  expect((await t.query(api.sharedVisits.listPublic, {})).page).toEqual([]);
  expect(
    (
      await t.query(api.sharedVisits.listByProfile, {
        profileId: owner.profileId,
      })
    ).page,
  ).toEqual([]);
  expect(
    (
      await owner.as.query(api.sharedVisits.getState, {
        visitLocalId: draft.visit.localId,
      })
    ).reflection,
  ).toBe("Visit memory");
  await setVisitVisibility(t, owner, draft.visit._id, "public");
  await owner.as.mutation(api.sharedVisits.publish, {
    ...selection,
    revision: hidden.revision,
  });
  expect((await t.query(api.sharedVisits.get, { postId: published.postId! })).reflection).toBe("Visit memory");
});

it("refuses a stale note preview and keeps edits unpublished until an updated publish", async () => {
  const t = harness(),
    owner = await socialUser(t),
    draft = await socialVisit(t, owner, 0);
  const input = {
    visibility: "public" as const,
    localId: draft.visit.localId,
    venueId: draft.visit.venueId,
    visitedOn: draft.visit.visitedOn,
    timeZone: "UTC",
    reflection: "First draft",
  };
  await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: input,
  });
  const selection = {
    ...draft.selection,
    audience: "public" as const,
    reflection: input.reflection,
  };
  await owner.as.query(api.sharedVisits.preview, selection);
  await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: { ...input, reflection: "Edited draft" },
  });
  await expect(owner.as.mutation(api.sharedVisits.publish, selection)).rejects.toMatchObject({
    data: { code: "conflict" },
  });
  const published = await owner.as.mutation(api.sharedVisits.publish, {
    ...selection,
    reflection: "Edited draft",
  });
  await owner.as.mutation(api.visits.upsertJournal, {
    scope: owner.scope,
    visit: { ...input, reflection: "Unpublished edit" },
  });
  expect((await t.query(api.sharedVisits.get, { postId: published.postId! })).reflection).toBe("Edited draft");
});

import { afterEach, describe, expect, it, vi } from "vitest";

import type { VisitVisibility } from "../shared/journal/contracts";
import { api, internal } from "./_generated/api";
import { befriend, setVisitVisibility, socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

async function post(t: Harness, author: SocialUser, companions: SocialUser[], audience: VisitVisibility = "friends") {
  const visit = await socialVisit(t, author);
  await t.run((ctx) => ctx.db.patch("visits", visit.visit._id, { visibility: audience }));
  const state = await author.as.action(api.sharedVisits.publish, {
    ...visit.selection,
    audience,
    companionIds: companions.map((person) => person.profileId),
  });
  return { ...visit, postId: state.postId!, state };
}
const profileVisits = async (viewer: SocialUser | Harness, profile: SocialUser) => {
  const args = { profileId: profile.profileId };
  const result =
    "as" in viewer
      ? await viewer.as.query(api.sharedVisits.listByProfile, args)
      : await viewer.query(api.sharedVisits.listByProfile, args);
  return result.page.map((visit) => visit.postId);
};
const companionNames = async (viewer: SocialUser, postId: string) =>
  (await viewer.as.query(api.sharedVisits.get, { postId })).companions.map((person) => person.name);
const notices = async (user: SocialUser) =>
  (await user.as.query(api.notifications.list, {})).page
    .filter((item) => item.kind === "visitCompanion")
    .map((item) => [item.actor.name, item.kind === "visitCompanion" ? item.venue : ""]);
async function visitScore(t: Harness, user: SocialUser) {
  const board = await t.query(api.leaderboards.list, { audience: "global", metric: "visits" });
  return board.rows.find((row) => row.profile.profileId === user.profileId)?.score;
}

async function companionPosts(t: Harness, author: SocialUser, companion: SocialUser, count: number) {
  const source = await socialVisit(t, author, 0);
  const { _id, _creationTime, ...visitFields } = source.visit;
  const { revision } = await author.as.query(api.friendships.getState, { profileId: companion.profileId });
  const posts = [];
  for (let batch = 0; batch < count; batch += 25) {
    posts.push(
      ...(await t.run(async (ctx) => {
        const created = [];
        for (let index = batch; index < Math.min(batch + 25, count); index++) {
          const localId = crypto.randomUUID();
          const visitId = await ctx.db.insert("visits", { ...visitFields, localId });
          const postId = crypto.randomUUID();
          await ctx.db.insert("sharedVisits", {
            profileId: author.profileId,
            visitId,
            visitLocalId: localId,
            postId,
            status: "active",
            audience: "public",
            reflection: "",
            publicationRevision: 1,
            publishedAt: 1,
            updatedAt: 1,
            visitedOn: source.visit.visitedOn,
            color: "#CDD0CA",
            companionSelections: [{ profileId: companion.profileId, friendshipRevision: revision }],
          });
          created.push({ postId, localId });
        }
        return created;
      })),
    );
  }
  return posts;
}

describe("went with", () => {
  it.each(["remove", "block"] as const)(
    "can %s a friend with 500 companion posts",
    async (operation) => {
      vi.useFakeTimers();
      const t = harness({ transactionLimits: true });
      const ana = await socialUser(t, "Ana");
      const ben = await socialUser(t, "Ben");
      const viewer = await socialUser(t, "Viewer");
      await befriend(ana, ben);
      const posts = await companionPosts(t, ana, ben, 500);
      expect(await visitScore(t, ben)).toBe(1);

      const { revision } = await ben.as.query(api.friendships.getState, { profileId: ana.profileId });
      const result =
        operation === "block"
          ? await ben.as.mutation(api.friendships.block, { profileId: ana.profileId, scope: ben.scope })
          : await ben.as.mutation(api.friendships.remove, { profileId: ana.profileId, revision });
      expect(result).toMatchObject({ state: "none", blocked: operation === "block" });
      expect(await companionNames(viewer, posts[0].postId)).toEqual([]);
      expect(await profileVisits(viewer, ben)).toEqual([]);
      expect(await notices(ben)).toEqual([]);
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
      expect(await visitScore(t, ben)).toBe(0);
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("visitCompanions")
            .withIndex("by_profile_history", (q) => q.eq("profileId", ben.profileId))
            .first(),
        ),
      ).toBeNull();
    },
    30_000,
  );

  it("keeps an explicitly renewed tag when an old friendship cleanup runs later", async () => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    await companionPosts(t, ana, ben, 25);
    const { revision } = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });
    await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision });
    const pending = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("visitCompanions")
        .withIndex("by_profile_history", (q) => q.eq("profileId", ben.profileId))
        .first();
      return ctx.db.get("sharedVisits", row!.publicationId);
    });
    await befriend(ana, ben);
    expect(await companionNames(ben, pending!.postId)).toEqual([]);
    expect(await profileVisits(ben, ben)).toEqual([]);
    expect(await notices(ben)).toEqual([]);
    await ana.as.action(api.sharedVisits.publish, {
      visitLocalId: pending!.visitLocalId,
      audience: "public",
      saveLocalIds: [],
      reflection: "",
      revision: pending!.publicationRevision,
      color: "#CDD0CA",
      companionIds: [ben.profileId],
    });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));

    expect(await companionNames(ben, pending!.postId)).toEqual(["Ben"]);
    expect(await profileVisits(ben, ben)).toEqual([pending!.postId]);
    expect(await notices(ben)).toHaveLength(1);
    expect(await visitScore(t, ben)).toBe(1);
  });

  it.each(["remove", "block", "deactivate"] as const)(
    "preserves unrelated credit when %s removes multiple posts for the same museum day",
    async (operation) => {
      const t = harness();
      const ana = await socialUser(t, "Ana");
      const ben = await socialUser(t, "Ben");
      await befriend(ana, ben);
      const venueId = await t.run((ctx) => seedMuseum(ctx));
      await ben.as.mutation(api.visits.upsertJournal, {
        scope: ben.scope,
        visit: {
          localId: crypto.randomUUID(),
          venueId,
          visitedOn: "2026-08-01",
          timeZone: "UTC",
          visibility: "private",
        },
      });
      const first = await socialVisit(t, ana, 0);
      const second = await socialVisit(t, ana, 0);
      await t.run((ctx) => ctx.db.patch("visits", second.visit._id, { venueId: first.visit.venueId }));
      for (const visit of [first, second]) {
        await ana.as.action(api.sharedVisits.publish, { ...visit.selection, companionIds: [ben.profileId] });
      }
      expect(await visitScore(t, ben)).toBe(2);

      if (operation === "deactivate") {
        await t.run((ctx) => ctx.db.patch("profiles", ana.profileId, { active: false }));
      } else if (operation === "block") {
        await ben.as.mutation(api.friendships.block, { profileId: ana.profileId, scope: ben.scope });
      } else {
        const relationship = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });
        await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision: relationship.revision });
      }
      expect(await visitScore(t, ben)).toBe(1);
    },
  );

  it.each(["private", "public"] as const)(
    "does not restore old %s tags when a friendship restarts",
    async (audience) => {
      const t = harness();
      const ana = await socialUser(t, "Ana");
      const ben = await socialUser(t, "Ben");
      await befriend(ana, ben);
      const visit = await post(t, ana, [ben], audience);
      const relationship = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });
      await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision: relationship.revision });
      await befriend(ana, ben);
      await setVisitVisibility(t, ana, visit.visit._id, "public");

      expect(await companionNames(ana, visit.postId)).toEqual([]);
      expect(await profileVisits(ben, ben)).toEqual([]);
      expect(await notices(ben)).toEqual([]);
      expect(await visitScore(t, ben)).toBe(0);

      const state = await ana.as.query(api.sharedVisits.getState, { visitLocalId: visit.visit.localId });
      await ana.as.action(api.sharedVisits.publish, {
        ...visit.selection,
        audience: "public",
        revision: state.revision,
        companionIds: [ben.profileId],
      });
      expect(await companionNames(ben, visit.postId)).toEqual(["Ben"]);
      expect(await profileVisits(ben, ben)).toEqual([visit.postId]);
      expect(await notices(ben)).toHaveLength(1);
      expect(await visitScore(t, ben)).toBe(1);
    },
  );

  it("names friends on the post, lists it on their profiles, and tells them", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const stranger = await socialUser(t, "Cy");
    await befriend(ana, ben);
    const { postId, state } = await post(t, ana, [ben, stranger, ana]);

    expect(state.companions.map((person) => person.name)).toEqual(["Ben"]);
    expect(await companionNames(ben, postId)).toEqual(["Ben"]);
    expect(await profileVisits(ben, ben)).toEqual([postId]);
    expect(await profileVisits(ana, ben)).toEqual([postId]);
    expect(await notices(ben)).toEqual([["Ana", "Test Museum"]]);
    expect(await notices(stranger)).toEqual([]);
  });

  it("keeps a private post off companions' profiles until it is shared with friends", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { postId, visit } = await post(t, ana, [ben], "private");

    expect(await profileVisits(ben, ben)).toEqual([]);
    expect(await notices(ben)).toEqual([]);
    expect(await visitScore(t, ben)).toBe(0);

    await setVisitVisibility(t, ana, visit._id, "friends");
    expect(await profileVisits(ben, ben)).toEqual([postId]);
    expect(await notices(ben)).toHaveLength(1);
    expect(await visitScore(t, ben)).toBe(1);
  });

  it("shows a companion's listed visit to others only when they can read the author's post", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cara = await socialUser(t, "Cara");
    await befriend(ana, ben);
    await befriend(ben, cara);
    const friendsOnly = await post(t, ana, [ben]);
    const everyone = await post(t, ana, [ben], "public");

    expect(await profileVisits(ben, ben)).toEqual(expect.arrayContaining([friendsOnly.postId, everyone.postId]));
    expect(await profileVisits(cara, ben)).toEqual([everyone.postId]);
    expect(await profileVisits(t, ben)).toEqual([everyone.postId]);
  });

  it("hides a companion from a viewer either of them has blocked", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cara = await socialUser(t, "Cara");
    await befriend(ana, ben);
    const { postId } = await post(t, ana, [ben], "public");
    await cara.as.mutation(api.friendships.block, { scope: cara.scope, profileId: ben.profileId });

    expect(await companionNames(cara, postId)).toEqual([]);
    expect(await companionNames(ana, postId)).toEqual(["Ben"]);
  });

  it("counts a museum day once, whether the companion logged it too or only went along", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { postId, visit } = await post(t, ana, [ben]);
    expect(await visitScore(t, ben)).toBe(1);

    const own = {
      visibility: "private" as const,
      localId: crypto.randomUUID(),
      venueId: visit.venueId,
      visitedOn: visit.visitedOn,
      timeZone: "UTC",
    };
    await ben.as.mutation(api.visits.upsertJournal, { scope: ben.scope, visit: own });
    expect(await visitScore(t, ben)).toBe(1);

    await ben.as.mutation(api.visitCompanions.leave, { postId });
    expect(await visitScore(t, ben)).toBe(1);
    expect(await profileVisits(ben, ben)).toEqual([]);
  });

  it("lets a companion leave, which drops the listing, the notice, and the credit", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { postId } = await post(t, ana, [ben]);

    await ben.as.mutation(api.visitCompanions.leave, { postId });

    expect(await companionNames(ana, postId)).toEqual([]);
    expect(await profileVisits(ben, ben)).toEqual([]);
    expect(await notices(ben)).toEqual([]);
    expect(await visitScore(t, ben)).toBe(0);
  });

  it("keeps a companion's removal when an already prepared update finishes", async () => {
    vi.useFakeTimers();
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { postId, selection, state } = await post(t, ana, [ben], "public");
    const update = { ...selection, revision: state.revision, companionIds: [ben.profileId], color: "#FFFFFF" };
    await ana.as.mutation(internal.sharedVisits.preparePublication, update);

    await ben.as.mutation(api.visitCompanions.leave, { postId });

    await expect(ana.as.mutation(internal.sharedVisits.savePublication, update)).rejects.toThrow("conflict");
    expect(await companionNames(ana, postId)).toEqual([]);
    expect(await profileVisits(ben, ben)).toEqual([]);
    expect(await notices(ben)).toEqual([]);
    expect(await visitScore(t, ben)).toBe(0);

    const fresh = await ana.as.query(api.sharedVisits.getState, { visitLocalId: selection.visitLocalId });
    await ana.as.action(api.sharedVisits.publish, { ...update, revision: fresh.revision });
    expect(await companionNames(ben, postId)).toEqual(["Ben"]);
  });

  it("deletes artwork shared across 80 visits with ten companions without changing their credit", async () => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const author = await socialUser(t, "Author");
    const companions = [];
    const selections: { profileId: SocialUser["profileId"]; friendshipRevision: number }[] = [];
    for (let index = 0; index < 10; index++) {
      const person = await socialUser(t, `Friend${String.fromCharCode(65 + index)}`);
      await befriend(author, person);
      const { revision } = await author.as.query(api.friendships.getState, { profileId: person.profileId });
      companions.push(person);
      selections.push({ profileId: person.profileId, friendshipRevision: revision });
    }
    const source = await socialVisit(t, author, 1);
    const { _id, _creationTime, ...visitFields } = source.visit;
    const [save] = source.saves;
    for (let index = 0; index < 80; index++) {
      await t.run(async (ctx) => {
        const localId = crypto.randomUUID();
        const visitId = await ctx.db.insert("visits", { ...visitFields, localId });
        await ctx.db.insert("artworkEncounters", {
          owner: visitFields.owner,
          savedLocalId: save.localId,
          saveId: save.id,
          visitLocalId: localId,
          visitId,
          updatedAt: 1,
          changeVersion: index + 10,
        });
        const publicationId = await ctx.db.insert("sharedVisits", {
          profileId: author.profileId,
          visitId,
          visitLocalId: localId,
          postId: crypto.randomUUID(),
          status: "active",
          audience: "public",
          reflection: "",
          publicationRevision: 1,
          publishedAt: 1,
          updatedAt: 1,
          visitedOn: visitFields.visitedOn,
          color: "#CDD0CA",
          companionSelections: selections,
        });
        await ctx.db.insert("sharedVisitItems", {
          publicationId,
          saveId: save.id,
          saveLocalId: save.localId,
          position: 0,
          highlighted: true,
        });
      });
    }

    await author.as.mutation(api.collections.remove, { scope: author.scope, localId: save.localId });

    expect(await t.run(async (ctx) => (await ctx.db.get("collections", save.id))?.deletedAt)).toBeDefined();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("sharedVisitItems")
          .withIndex("by_saveId", (q) => q.eq("saveId", save.id))
          .first(),
      ),
    ).toBeNull();
    for (const person of companions) {
      expect(await visitScore(t, person)).toBe(1);
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("visitCompanions")
            .withIndex("by_profile_history", (q) => q.eq("profileId", person.profileId))
            .take(81),
        ),
      ).toHaveLength(80);
    }
  }, 30_000);

  it("drops companions when the friendship ends", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { postId } = await post(t, ana, [ben], "public");
    const state = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });

    await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision: state.revision });

    expect(await companionNames(ana, postId)).toEqual([]);
    expect(await profileVisits(ben, ben)).toEqual([]);
    expect(await visitScore(t, ben)).toBe(0);
  });

  it.each(["museum", "day"] as const)("follows the visit to another %s without notifying again", async (change) => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const { visit } = await post(t, ana, [ben]);
    const moved = await t.run((ctx) => seedMuseum(ctx));
    const own = {
      visibility: "private" as const,
      localId: crypto.randomUUID(),
      venueId: visit.venueId,
      visitedOn: visit.visitedOn,
      timeZone: "UTC",
    };
    await ben.as.mutation(api.visits.upsertJournal, { scope: ben.scope, visit: own });
    expect(await visitScore(t, ben)).toBe(1);

    const journal = (await t.run((ctx) => ctx.db.get("visits", visit._id)))!;
    await ana.as.mutation(api.visits.upsertJournal, {
      scope: ana.scope,
      visit: {
        visibility: journal.visibility,
        localId: journal.localId,
        venueId: change === "museum" ? moved : journal.venueId,
        visitedOn: change === "day" ? "2026-09-02" : journal.visitedOn,
        timeZone: journal.timeZone,
        reflection: journal.reflection,
      },
    });

    expect(await visitScore(t, ben)).toBe(2);
    expect(await notices(ben)).toHaveLength(1);
  });
});

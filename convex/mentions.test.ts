import { describe, expect, it } from "vitest";

import type { VisitVisibility } from "../shared/journal/contracts";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { befriend, setVisitVisibility, socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { harness, type Harness } from "./test.helpers";

async function post(
  t: Harness,
  author: SocialUser,
  notes: string,
  { audience = "friends", companions = [] }: { audience?: VisitVisibility; companions?: SocialUser[] } = {},
) {
  const visit = await socialVisit(t, author);
  await t.run((ctx) => ctx.db.patch("visits", visit.visit._id, { visibility: audience, reflection: notes }));
  const state = await author.as.action(api.sharedVisits.publish, {
    ...visit.selection,
    audience,
    reflection: notes,
    companionIds: companions.map((person) => person.profileId),
  });
  const republish = async (next: string) => {
    await t.run((ctx) => ctx.db.patch("visits", visit.visit._id, { reflection: next }));
    const current = await author.as.query(api.sharedVisits.getState, { visitLocalId: visit.visit.localId });
    await author.as.action(api.sharedVisits.publish, {
      ...visit.selection,
      audience: current.audience,
      reflection: next,
      revision: current.revision,
      companionIds: companions.map((person) => person.profileId),
    });
  };
  return { ...visit, postId: state.postId!, republish };
}
const linked = async (viewer: SocialUser, postId: string) =>
  (await viewer.as.query(api.sharedVisits.get, { postId })).mentions.map((row) => row.username);
const inbox = async (user: SocialUser) =>
  (await user.as.query(api.notifications.list, {})).page
    .filter((item) => item.kind !== "friendRequest" && item.kind !== "friendAccepted")
    .map((item) => [item.kind, item.actor.name]);
const comment = (user: SocialUser, postId: string, body: string) =>
  user.as.action(api.visitReactions.addComment, { postId, body, requestId: crypto.randomUUID() });
const suggested = async (user: SocialUser, query: string, place: Parameters<typeof suggestArgs>[1]) =>
  (await user.as.query(api.mentions.suggest, suggestArgs(query, place))).map(
    (row) => `${row.profile.name}${row.role ? ` (${row.role})` : ""}`,
  );
function suggestArgs(
  query: string,
  place:
    | { kind: "comment"; postId: string }
    | { kind: "visit"; audience: VisitVisibility; companionIds: Id<"profiles">[] }
    | { kind: "profile" },
) {
  return { query, place };
}

describe("mentions", () => {
  it("links and notifies the people a post's notes name only while they can read it", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cleo = await socialUser(t, "Cleo");
    await befriend(ana, ben);
    const visit = await post(t, ana, "Saw the Seurat with @u_ben and @U_Cleo. #seurat");

    expect(await linked(ben, visit.postId)).toEqual(["u_ben"]);
    expect(await linked(ana, visit.postId)).toEqual(["u_ben"]);
    expect(await inbox(ben)).toEqual([["visitMention", "Ana"]]);
    expect(
      (await ben.as.query(api.notifications.list, {})).page.find((item) => item.kind === "visitMention"),
    ).toMatchObject({
      body: "Saw the Seurat with @u_ben and @U_Cleo. #seurat",
      venue: expect.any(String),
    });
    expect(await inbox(cleo)).toEqual([]);

    await setVisitVisibility(t, ana, visit.visit._id, "public");
    expect(await linked(cleo, visit.postId)).toEqual(["u_ben", "u_cleo"]);
    expect(await inbox(cleo)).toEqual([["visitMention", "Ana"]]);

    await setVisitVisibility(t, ana, visit.visit._id, "private");
    expect(await linked(ana, visit.postId)).toEqual(["u_ben"]);
    expect(await inbox(ben)).toEqual([]);
    expect(await inbox(cleo)).toEqual([]);
  });

  it("notifies only newly named people on an edit and keeps a renamed handle linked", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const dan = await socialUser(t, "Dan");
    await befriend(ana, ben);
    await befriend(ana, dan);
    const visit = await post(t, ana, "With @u_ben.");
    await t.run((ctx) => ctx.db.patch("profiles", ben.profileId, { username: "ben_renamed" }));

    await visit.republish("With @u_ben and @u_dan.");
    const { mentions } = await ana.as.query(api.sharedVisits.get, { postId: visit.postId });
    expect(mentions).toEqual([
      { username: "u_ben", profileId: ben.profileId },
      { username: "u_dan", profileId: dan.profileId },
    ]);
    expect(await inbox(ben)).toEqual([["visitMention", "Ana"]]);
    expect(await inbox(dan)).toEqual([["visitMention", "Ana"]]);

    await visit.republish("Only @u_dan this time.");
    expect(await inbox(ben)).toEqual([]);
    expect(await inbox(dan)).toEqual([["visitMention", "Ana"]]);
  });

  it("tells a Went with companion they were added, not also that they were mentioned", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    await post(t, ana, "With @u_ben.", { companions: [ben] });
    expect(await inbox(ben)).toEqual([["visitCompanion", "Ana"]]);
  });

  it.each(["blocked", "unfriended"] as const)(
    "withdraws a removed mention while %s so a later mention is new",
    async (revocation) => {
      const t = harness();
      const ana = await socialUser(t, "Ana");
      const ben = await socialUser(t, "Ben");
      await befriend(ana, ben);
      const visit = await post(t, ana, "With @u_ben.");
      const original = (await ben.as.query(api.notifications.list, {})).page.find(
        (item) => item.kind === "visitMention",
      )!;
      await ben.as.mutation(api.notifications.markSeen, { through: original.createdAt });

      if (revocation === "blocked") {
        await ana.as.mutation(api.friendships.block, { scope: ana.scope, profileId: ben.profileId });
      } else {
        const { revision } = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });
        await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision });
      }
      await visit.republish("Nobody named.");
      expect(await t.run((ctx) => ctx.db.get("notifications", original.id))).toBeNull();

      if (revocation === "blocked") {
        const { blockRevision } = await ana.as.query(api.friendships.getState, { profileId: ben.profileId });
        await ana.as.mutation(api.friendships.unblock, { scope: ana.scope, profileId: ben.profileId, blockRevision });
      }
      await befriend(ana, ben);
      await visit.republish("Again with @u_ben.");
      const mentions = (await ben.as.query(api.notifications.unseen, {})).page.filter(
        (item) => item.kind === "visitMention",
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0].id).not.toBe(original.id);
      expect(mentions[0].body).toBe("Again with @u_ben.");
    },
  );

  it("notifies people a comment names, except the visit's author, who hears about the comment", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cleo = await socialUser(t, "Cleo");
    const visit = await post(t, ana, "", { audience: "public" });
    const commentId = await comment(ben, visit.postId, "@u_ana @u_cleo the Caillebotte is two rooms over.");

    expect(await inbox(ana)).toEqual([["visitComment", "Ben"]]);
    expect(await inbox(cleo)).toEqual([["commentMention", "Ben"]]);
    expect((await cleo.as.query(api.notifications.list, {})).page[0]).toMatchObject({
      owner: { name: "Ana" },
      body: "@u_ana @u_cleo the Caillebotte is two rooms over.",
    });
    const [listed] = (await cleo.as.query(api.visitReactions.listComments, { postId: visit.postId })).page;
    expect(listed.mentions.map((row) => row.username)).toEqual(["u_ana", "u_cleo"]);

    await ben.as.mutation(api.visitReactions.deleteComment, { postId: visit.postId, commentId });
    expect(await inbox(cleo)).toEqual([]);
  });

  it("leaves blocked people as plain text and never notifies them", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cleo = await socialUser(t, "Cleo");
    const visit = await post(t, ana, "", { audience: "public" });
    await cleo.as.mutation(api.friendships.block, { scope: cleo.scope, profileId: ben.profileId });
    await comment(ben, visit.postId, "@u_cleo look.");

    const [listed] = (await ana.as.query(api.visitReactions.listComments, { postId: visit.postId })).page;
    expect(listed.mentions).toEqual([]);
    expect(await inbox(cleo)).toEqual([]);
  });

  it("links handles in a bio without notifying anyone", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await ana.as.action(api.profilePhotos.save, { name: "Ana", bio: "Sundays with @u_ben and @nobody_here." });

    expect((await ben.as.query(api.profiles.getPublic, { profileId: ana.profileId }))!.bioMentions).toEqual([
      { username: "u_ben", profileId: ben.profileId },
    ]);
    expect((await ana.as.query(api.profiles.mine, {})).bioMentions).toHaveLength(1);
    expect(await inbox(ben)).toEqual([]);
  });

  it("suggests the people around a comment first, and only people who can read the visit", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const cleo = await socialUser(t, "Cleo");
    const amos = await socialUser(t, "Amos");
    const stranger = await socialUser(t, "Abe");
    await befriend(ana, ben);
    await befriend(ana, cleo);
    await befriend(ana, amos);
    await befriend(ben, amos);
    const visit = await post(t, ana, "");
    await comment(cleo, visit.postId, "Lovely.");

    const place = { kind: "comment" as const, postId: visit.postId };
    expect(await suggested(ben, "", place)).toEqual(["Ana (author)", "Cleo", "Amos"]);
    expect(await suggested(ben, "a", place)).toEqual(["Ana (author)", "Amos"]);
    expect(await suggested(stranger, "a", place)).toEqual([]);
  });

  it("suggests Went with people first, then friends, and strangers only for public visits", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    const bea = await socialUser(t, "Bea");
    await socialUser(t, "Bo");
    await befriend(ana, ben);
    await befriend(ana, bea);

    const friends = { kind: "visit" as const, audience: "friends" as const, companionIds: [ben.profileId] };
    expect(await suggested(ana, "", friends)).toEqual(["Ben (companion)", "Bea"]);
    expect(await suggested(ana, "b", friends)).toEqual(["Ben (companion)", "Bea"]);
    expect(await suggested(ana, "b", { ...friends, audience: "public" })).toEqual(["Ben (companion)", "Bea", "Bo"]);
    expect(await suggested(ana, "u_b", { kind: "profile" })).toEqual(["Bea", "Ben", "Bo"]);
  });
});

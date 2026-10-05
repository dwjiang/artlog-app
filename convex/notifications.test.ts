import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vitest";

import { groupNotifications } from "../shared/social/notifications";
import { api } from "./_generated/api";
import { purgeSocialBatch } from "./lib/socialCleanup";
import { befriend, socialUser, socialVisit, type SocialUser } from "./lib/socialTestFixtures";
import { harness, type Harness } from "./test.helpers";

async function publishedVisit(t: Harness, author: SocialUser) {
  const visit = await socialVisit(t, author);
  return (await author.as.action(api.sharedVisits.publish, visit.selection)).postId!;
}
const kinds = async (user: SocialUser) =>
  (await user.as.query(api.notifications.list, {})).page.map((item) => [item.kind, item.actor.name]);

async function unseenCount(user: SocialUser) {
  const items: FunctionReturnType<typeof api.notifications.unseen>["page"] = [];
  let cursor: string | null = null;
  do {
    const result: FunctionReturnType<typeof api.notifications.unseen> = await user.as.query(api.notifications.unseen, {
      cursor,
      limit: 1,
    });
    items.push(...result.page);
    cursor = result.cursor;
  } while (cursor);
  return groupNotifications(items).length;
}

describe("notifications", () => {
  it("shows an incoming request until it is answered and tells the requester when it is accepted", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await ana.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 0 });
    expect(await kinds(ana)).toEqual([]);
    const [request] = (await ben.as.query(api.notifications.list, {})).page;
    expect(request).toMatchObject({
      kind: "friendRequest",
      actor: { name: "Ana" },
      relationship: { state: "pending", requesterId: ana.profileId },
    });

    await ben.as.mutation(api.friendships.decline, { profileId: ana.profileId, revision: 1 });
    expect(await kinds(ben)).toEqual([]);
    await ana.as.mutation(api.friendships.request, { profileId: ben.profileId, revision: 2 });
    expect(await kinds(ben)).toEqual([["friendRequest", "Ana"]]);

    await ben.as.mutation(api.friendships.accept, { profileId: ana.profileId, revision: 3 });
    expect((await ben.as.query(api.notifications.list, {})).page).toEqual([
      expect.objectContaining({ kind: "friendRequest", relationship: expect.objectContaining({ state: "accepted" }) }),
    ]);
    expect(await kinds(ana)).toEqual([["friendAccepted", "Ben"]]);

    await ana.as.mutation(api.friendships.remove, { profileId: ben.profileId, revision: 4 });
    expect(await kinds(ana)).toEqual([]);
    expect(await kinds(ben)).toEqual([]);
  });

  it("collapses likes on one visit in the unseen count and withdraws a like when it is taken back", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const [ana, ben] = [await socialUser(t, "Ana"), await socialUser(t, "Ben")];
    const postId = await publishedVisit(t, author);
    await author.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    for (const user of [ana, ben]) await user.as.mutation(api.visitReactions.setLike, { postId, liked: true });

    const { page: items, seenAt } = await author.as.query(api.notifications.list, {});
    expect(seenAt).toBe(0);
    expect(items.map((item) => [item.kind, item.actor.name])).toEqual([
      ["visitLike", "Ben"],
      ["visitLike", "Ana"],
    ]);
    expect(items[0]).toMatchObject({ postId, venue: expect.any(String), media: { kind: "placeholder" } });
    expect(await unseenCount(author)).toBe(1);

    await author.as.mutation(api.notifications.markSeen, { through: items[0].createdAt });
    expect(await unseenCount(author)).toBe(0);
    await ben.as.mutation(api.visitReactions.setLike, { postId, liked: false });
    expect(await kinds(author)).toEqual([["visitLike", "Ana"]]);
  });

  it("quotes a comment, drops it when deleted, and hides people the reader has blocked", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const [ana, ben] = [await socialUser(t, "Ana"), await socialUser(t, "Ben")];
    const postId = await publishedVisit(t, author);
    const commentId = await ana.as.action(api.visitReactions.addComment, {
      postId,
      body: "The Seurat is huge.",
      requestId: crypto.randomUUID(),
    });
    await ben.as.action(api.visitReactions.addComment, {
      postId,
      body: "Wish I'd gone.",
      requestId: crypto.randomUUID(),
    });
    expect((await author.as.query(api.notifications.list, {})).page).toEqual([
      expect.objectContaining({ kind: "visitComment", actor: expect.objectContaining({ name: "Ben" }) }),
      expect.objectContaining({ kind: "visitComment", body: "The Seurat is huge." }),
    ]);

    await ana.as.mutation(api.visitReactions.deleteComment, { postId, commentId });
    await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: ben.profileId });
    expect(await kinds(author)).toEqual([]);
    expect(await unseenCount(author)).toBe(0);
  });

  it("keeps each person's notifications to themselves", async () => {
    const t = harness();
    const ana = await socialUser(t, "Ana");
    const ben = await socialUser(t, "Ben");
    await befriend(ana, ben);
    const postId = await publishedVisit(t, ana);
    await ben.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    expect(await kinds(ana)).toEqual([
      ["visitLike", "Ben"],
      ["friendAccepted", "Ben"],
    ]);
    expect(await kinds(ben)).toEqual([["friendRequest", "Ana"]]);
    await expect(t.query(api.notifications.list, {})).rejects.toMatchObject({ data: { code: "unauthenticated" } });
    await expect(t.query(api.notifications.unseen, {})).rejects.toMatchObject({ data: { code: "unauthenticated" } });
  });

  it("acknowledges only the displayed snapshot and never moves the read cursor backwards", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const commenter = await socialUser(t, "Commenter");
    const postId = await publishedVisit(t, author);
    const comment = (body: string) =>
      commenter.as.action(api.visitReactions.addComment, { postId, body, requestId: crypto.randomUUID() });
    await comment("First");
    const first = (await author.as.query(api.notifications.list, {})).page[0].createdAt;
    await comment("Arrived after the snapshot");
    const latest = (await author.as.query(api.notifications.list, {})).page[0].createdAt;

    await author.as.mutation(api.notifications.markSeen, { through: first });
    expect(await unseenCount(author)).toBe(1);
    await author.as.mutation(api.notifications.markSeen, { through: latest });
    await author.as.mutation(api.notifications.markSeen, { through: first });
    expect(await unseenCount(author)).toBe(0);
    expect((await author.as.query(api.notifications.list, {})).seenAt).toBe(latest);
    expect((await commenter.as.query(api.notifications.list, {})).seenAt).toBe(0);
  });

  it("rejects invalid read cursors and prevents a future timestamp from swallowing later arrivals", async () => {
    const t = harness();
    const author = await socialUser(t, "Author");
    const commenter = await socialUser(t, "Commenter");
    for (const through of [-1, NaN, Infinity]) {
      await expect(author.as.mutation(api.notifications.markSeen, { through })).rejects.toMatchObject({
        data: { code: "invalid_notification" },
      });
    }
    await expect(t.mutation(api.notifications.markSeen, { through: 0 })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    const postId = await publishedVisit(t, author);
    await commenter.as.mutation(api.visitReactions.setLike, { postId, liked: true });
    const latest = (await author.as.query(api.notifications.list, {})).page[0].createdAt;
    await author.as.mutation(api.notifications.markSeen, { through: latest + 60_000 });
    expect((await author.as.query(api.notifications.list, {})).seenAt).toBe(latest);
    await commenter.as.action(api.visitReactions.addComment, {
      postId,
      body: "Arrived later",
      requestId: crypto.randomUUID(),
    });
    expect(await unseenCount(author)).toBe(1);
  });

  it("keeps an unread request reachable beyond 100 blocked comments", async () => {
    const t = harness({ transactionLimits: true });
    const author = await socialUser(t, "Author");
    const friend = await socialUser(t, "Friend");
    const commenter = await socialUser(t, "Commenter");
    await friend.as.mutation(api.friendships.request, { profileId: author.profileId, revision: 0 });
    const postId = await publishedVisit(t, author);
    const publication = await t.run((ctx) =>
      ctx.db
        .query("sharedVisits")
        .withIndex("by_postId", (q) => q.eq("postId", postId))
        .unique(),
    );
    for (let batch = 0; batch < 2; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 50; i++) {
          await ctx.db.insert("visitComments", {
            publicationId: publication!._id,
            profileId: commenter.profileId,
            body: "A comment",
            requestId: crypto.randomUUID(),
          });
        }
      });
    }
    await author.as.mutation(api.friendships.block, { scope: author.scope, profileId: commenter.profileId });
    for (const query of [api.notifications.list, api.notifications.unseen]) {
      let result = await author.as.query(query, { limit: 50 });
      for (let page = 0; page < 2; page++) {
        expect(result).toMatchObject({ page: [], isDone: false, cursor: expect.any(String) });
        result = await author.as.query(query, { limit: 50, cursor: result.cursor });
      }
      expect(result).toMatchObject({
        page: [expect.objectContaining({ kind: "friendRequest", actor: expect.objectContaining({ name: "Friend" }) })],
        isDone: true,
        cursor: null,
      });
    }
    expect(await unseenCount(author)).toBe(1);
  });

  it.each(["author", "commenter"] as const)(
    "finishes %s cleanup with 700 retained comments between a pair",
    async (role) => {
      const t = harness({ transactionLimits: true });
      const author = await socialUser(t, "Author");
      const commenter = await socialUser(t, "Commenter");
      const postId = await publishedVisit(t, author);
      const publication = await t.run((ctx) =>
        ctx.db
          .query("sharedVisits")
          .withIndex("by_postId", (q) => q.eq("postId", postId))
          .unique(),
      );
      for (let batch = 0; batch < 7; batch++) {
        await t.run(async (ctx) => {
          for (let i = 0; i < 100; i++) {
            await ctx.db.insert("visitComments", {
              publicationId: publication!._id,
              profileId: commenter.profileId,
              body: "A comment",
              requestId: crypto.randomUUID(),
            });
          }
        });
      }
      const removed = role === "author" ? author : commenter;
      let more = true;
      for (let batch = 0; more && batch < 30; batch++) {
        more = await t.run((ctx) => purgeSocialBatch(ctx, removed.accountId));
      }
      expect(more).toBe(false);
      await t.run(async (ctx) => {
        expect(await ctx.db.get("profiles", removed.profileId)).toBeNull();
        expect(await ctx.db.query("visitComments").first()).toBeNull();
        expect(await ctx.db.query("notifications").first()).toBeNull();
      });
    },
  );
});

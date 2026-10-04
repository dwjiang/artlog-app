import type { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { purgeSocialBatch } from "./lib/socialCleanup";
import { setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { seedArtworkWithObject, seedDevice } from "./lib/testFactories";
import { harness } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = harness();
  const author = await socialUser(t, "Author");
  const visitor = await socialUser(t, "Visitor");
  const visit = await socialVisit(t, author);
  const publication = await author.as.action(api.sharedVisits.publish, visit.selection);
  return { t, author, visitor, visit, postId: publication.postId! };
}

describe("visit reactions", () => {
  it.each([false, true])("limits moderation across account devices even when rejected=%s", async (flagged) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, visitor, postId } = await fixture();
    const sibling = await seedDevice(t);
    await t.run((ctx) => ctx.db.patch("devices", sibling.deviceId, { accountId: visitor.accountId }));
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ results: [{ flagged }] }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { postId, body: "A beautiful work", requestId: crypto.randomUUID() };
    for (let i = 0; i < 20; i++) {
      const pending = visitor.as.action(api.visitReactions.addComment, {
        ...input,
        requestId: i === 0 ? input.requestId : crypto.randomUUID(),
      });
      const outcome = await pending.then(
        () => "saved",
        (error: ConvexError<{ code: string }>) => error.data.code,
      );
      expect(outcome).toBe(flagged ? "comment_not_allowed" : "saved");
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);
    fetchMock.mockClear();
    for (let i = 0; i < 3; i++) {
      await expect(
        sibling.as.action(api.visitReactions.addComment, { ...input, requestId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ data: { code: "rate_limited", name: "commentVisit" } });
    }
    const retry = await sibling.as.action(api.visitReactions.addComment, input).then(
      () => "saved",
      (error: ConvexError<{ code: string }>) => error.data.code,
    );
    expect(retry).toBe(flagged ? "rate_limited" : "saved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid comment text and request IDs before moderation", async () => {
    const { visitor, postId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ results: [{ flagged: false }] }));
    vi.stubGlobal("fetch", fetchMock);
    for (const input of [
      { body: " ", requestId: crypto.randomUUID() },
      { body: "x".repeat(1001), requestId: crypto.randomUUID() },
      { body: "A beautiful work", requestId: "invalid" },
    ]) {
      await expect(visitor.as.action(api.visitReactions.addComment, { postId, ...input })).rejects.toMatchObject({
        data: { code: "invalid_comment" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps likes unique and makes repeated like/unlike requests safe", async () => {
    const { t, visitor, postId } = await fixture();
    for (let i = 0; i < 2; i++) {
      await visitor.as.mutation(api.visitReactions.setLike, {
        postId,
        liked: true,
      });
    }
    expect(await visitor.as.query(api.visitReactions.getSummary, { postId })).toEqual({
      likeCount: 1,
      commentCount: 0,
      liked: true,
      latestComment: null,
    });
    expect((await t.query(api.visitReactions.listLikes, { postId })).page.map((p) => p.name)).toEqual(["Visitor"]);
    for (let i = 0; i < 2; i++) {
      await visitor.as.mutation(api.visitReactions.setLike, {
        postId,
        liked: false,
      });
    }
    expect(await t.query(api.visitReactions.getSummary, { postId })).toEqual({
      likeCount: 0,
      commentCount: 0,
      liked: false,
      latestComment: null,
    });
  });

  it("posts once on retry, paginates comments, and only lets the writer delete", async () => {
    const { t, author, visitor, postId } = await fixture();
    const requestId = crypto.randomUUID();
    const id = await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "  Beautiful work.  ",
      requestId,
    });
    expect(
      await visitor.as.action(api.visitReactions.addComment, {
        postId,
        body: "Beautiful work.",
        requestId,
      }),
    ).toBe(id);
    await author.as.action(api.visitReactions.addComment, {
      postId,
      body: "Thank you!",
      requestId: crypto.randomUUID(),
    });
    const first = await t.query(api.visitReactions.listComments, {
      postId,
      limit: 1,
    });
    expect(first.page[0]).toMatchObject({
      commentId: id,
      body: "Beautiful work.",
      author: { name: "Visitor" },
      isAuthor: false,
    });
    const next = await t.query(api.visitReactions.listComments, {
      postId,
      limit: 1,
      cursor: first.cursor,
    });
    expect(next.page[0]).toMatchObject({ body: "Thank you!", isAuthor: true });
    await expect(
      author.as.mutation(api.visitReactions.deleteComment, {
        postId,
        commentId: id,
      }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
    await visitor.as.mutation(api.visitReactions.deleteComment, {
      postId,
      commentId: id,
    });
    await visitor.as.mutation(api.visitReactions.deleteComment, {
      postId,
      commentId: id,
    });
    expect((await t.query(api.visitReactions.getSummary, { postId })).commentCount).toBe(1);
  });

  it("hearts a comment once per person, shows each reader their own heart, and drops hearts with the comment", async () => {
    vi.useFakeTimers();
    const { t, author, visitor, postId } = await fixture();
    const commentId = await author.as.action(api.visitReactions.addComment, {
      postId,
      body: "Thanks for coming.",
      requestId: crypto.randomUUID(),
    });
    const third = await socialUser(t, "Third");
    for (const reader of [visitor, visitor, third]) {
      await reader.as.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: true });
    }
    expect((await visitor.as.query(api.visitReactions.listComments, { postId })).page[0]).toMatchObject({
      likeCount: 2,
      liked: true,
    });
    expect((await author.as.query(api.visitReactions.listComments, { postId })).page[0]).toMatchObject({
      likeCount: 2,
      liked: false,
    });
    await visitor.as.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: false });
    expect((await visitor.as.query(api.visitReactions.listComments, { postId })).page[0]).toMatchObject({
      likeCount: 1,
      liked: false,
    });
    await expect(t.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: true })).rejects.toThrow(
      "unauthenticated",
    );
    await author.as.mutation(api.visitReactions.deleteComment, { postId, commentId });
    await expect(
      visitor.as.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: true }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      for (const table of ["commentLikes", "commentLikeCounts"] as const) {
        expect(await ctx.db.query(table).take(1)).toEqual([]);
      }
    });
  });

  it("previews the newest comment each reader can see", async () => {
    const { t, author, visitor, postId } = await fixture();
    const third = await socialUser(t, "Third");
    await author.as.action(api.visitReactions.addComment, {
      postId,
      body: "First.",
      requestId: crypto.randomUUID(),
    });
    const newest = await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "Newest.",
      requestId: crypto.randomUUID(),
    });
    expect((await t.query(api.visitReactions.getSummary, { postId })).latestComment).toEqual({
      commentId: newest,
      authorName: "Visitor",
      body: "Newest.",
    });
    await third.as.mutation(api.friendships.block, { scope: third.scope, profileId: visitor.profileId });
    expect((await third.as.query(api.visitReactions.getSummary, { postId })).latestComment).toMatchObject({
      authorName: "Author",
      body: "First.",
    });
  });

  it("refuses hearts on a comment from someone the reader blocked", async () => {
    const { t, visitor, postId } = await fixture();
    const third = await socialUser(t, "Third");
    const commentId = await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    await third.as.mutation(api.friendships.block, { scope: third.scope, profileId: visitor.profileId });
    await expect(
      third.as.mutation(api.visitReactions.setCommentLike, { postId, commentId, liked: true }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
  });

  it("rejects guest writes and invalid comments", async () => {
    const { t, visitor, postId } = await fixture();
    await expect(t.mutation(api.visitReactions.setLike, { postId, liked: true })).rejects.toThrow("unauthenticated");
    await expect(
      t.action(api.visitReactions.addComment, {
        postId,
        body: "Hello",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("unauthenticated");
    for (const body of ["  ", "x".repeat(1001)]) {
      await expect(
        visitor.as.action(api.visitReactions.addComment, {
          postId,
          body,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ data: { code: "invalid_comment" } });
    }
  });

  it("rejects offensive comments without posting them", async () => {
    const { t, visitor, postId } = await fixture();
    await expect(
      visitor.as.action(api.visitReactions.addComment, {
        postId,
        body: "What a load of shit",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "comment_not_allowed" } });
    await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "It hangs next to The Rape of Europa.",
      requestId: crypto.randomUUID(),
    });
    expect((await t.query(api.visitReactions.listComments, { postId })).page.map((c) => c.body)).toEqual([
      "It hangs next to The Rape of Europa.",
    ]);
  });

  it("lets a comment name the post's museum-titled artwork", async () => {
    const { t, visitor, visit, postId } = await fixture();
    const record = { title: "Pay Attention Motherfuckers", artist: "Bruce Nauman" };
    await t.run(async (ctx) => {
      const { artworkId } = await seedArtworkWithObject(ctx, { artwork: record });
      await ctx.db.patch("collections", visit.saves[0].id, { artworkId, snapshot: record });
    });
    const body = "Pay Attention Motherfuckers is still loud in person";
    await visitor.as.action(api.visitReactions.addComment, { postId, body, requestId: crypto.randomUUID() });
    await t.run((ctx) => ctx.db.patch("collections", visit.saves[0].id, { snapshot: { ...record, title: "Loud" } }));
    await expect(
      visitor.as.action(api.visitReactions.addComment, { postId, body, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ data: { code: "comment_not_allowed" } });
  });

  it("hides reactions and rejects writes after the visit becomes private", async () => {
    const { t, author, visitor, visit, postId } = await fixture();
    await visitor.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await setVisitVisibility(t, author, visit.visit._id, "private");
    for (const query of [
      api.visitReactions.getSummary,
      api.visitReactions.listLikes,
      api.visitReactions.listComments,
    ]) {
      await expect(t.query(query, { postId })).rejects.toMatchObject({
        data: { code: "not_found" },
      });
    }
    await expect(visitor.as.mutation(api.visitReactions.setLike, { postId, liked: false })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    await expect(
      visitor.as.action(api.visitReactions.addComment, {
        postId,
        body: "Hello",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "not_found" } });
  });

  it("enforces blocks for the visit and filters blocked participants from lists", async () => {
    const { t, author, visitor, postId } = await fixture();
    const third = await socialUser(t, "Third");
    await visitor.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    await third.as.mutation(api.friendships.block, {
      scope: third.scope,
      profileId: visitor.profileId,
    });
    expect((await third.as.query(api.visitReactions.listComments, { postId })).page).toEqual([]);
    expect((await third.as.query(api.visitReactions.listLikes, { postId })).page).toEqual([]);
    await author.as.mutation(api.friendships.block, {
      scope: author.scope,
      profileId: visitor.profileId,
    });
    await expect(visitor.as.query(api.visitReactions.getSummary, { postId })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
    await expect(visitor.as.mutation(api.visitReactions.setLike, { postId, liked: false })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
  });

  it("hides reactions from everyone once the visit’s author and the participant are blocked", async () => {
    const { t, author, visitor, postId } = await fixture();
    const third = await socialUser(t, "Third");
    await visitor.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    await author.as.mutation(api.friendships.block, {
      scope: author.scope,
      profileId: visitor.profileId,
    });
    for (const reader of [t, third.as, author.as]) {
      expect((await reader.query(api.visitReactions.listComments, { postId })).page).toEqual([]);
      expect((await reader.query(api.visitReactions.listLikes, { postId })).page).toEqual([]);
    }
  });

  it("removes a deleted account’s reactions and publication children", async () => {
    vi.useFakeTimers();
    const { t, author, visitor, postId } = await fixture();
    await visitor.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await visitor.as.action(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    const authorComment = await author.as.action(api.visitReactions.addComment, {
      postId,
      body: "Thanks",
      requestId: crypto.randomUUID(),
    });
    await visitor.as.mutation(api.visitReactions.setCommentLike, { postId, commentId: authorComment, liked: true });
    while (await t.run((ctx) => purgeSocialBatch(ctx, visitor.accountId))) {
      /* drain bounded batches */
    }
    expect(await t.query(api.visitReactions.getSummary, { postId })).toMatchObject({
      likeCount: 0,
      commentCount: 1,
    });
    expect((await t.query(api.visitReactions.listComments, { postId })).page[0]).toMatchObject({ likeCount: 0 });
    await author.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await author.as.action(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    while (await t.run((ctx) => purgeSocialBatch(ctx, author.accountId))) {
      /* drain bounded batches */
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      for (const table of [
        "visitLikes",
        "visitComments",
        "visitEngagement",
        "commentLikes",
        "commentLikeCounts",
        "notifications",
      ] as const) {
        expect(await ctx.db.query(table).take(1)).toEqual([]);
      }
    });
  });

  it.each(["writer", "visit owner"] as const)(
    "finishes the %s’s account purge with heavily liked comments within transaction limits",
    async (deletedAccount) => {
      vi.useFakeTimers();
      const t = harness({ transactionLimits: true });
      const author = await socialUser(t, "Author");
      const writer = await socialUser(t, "Writer");
      const visit = await socialVisit(t, author);
      const { postId } = await author.as.action(api.sharedVisits.publish, visit.selection);
      const publicationId = await t.run(async (ctx) => {
        const publication = await ctx.db
          .query("sharedVisits")
          .withIndex("by_postId", (q) => q.eq("postId", postId!))
          .unique();
        return publication!._id;
      });
      const likers = await t.run(async (ctx) => {
        const ids = [];
        for (let i = 0; i < 350; i++) {
          const accountId = await ctx.db.insert("accounts", { provider: "apple", providerUserId: `liker-${i}` });
          ids.push(
            await ctx.db.insert("profiles", {
              accountId,
              username: `liker_${i}`,
              name: `Liker ${i}`,
              searchText: `liker ${i}`,
              active: true,
              leaderboardVisibility: "off",
              publishedWallCount: 0,
              updatedAt: Date.now(),
            }),
          );
        }
        return ids;
      });
      for (let i = 0; i < 50; i++) {
        await t.run(async (ctx) => {
          const commentId = await ctx.db.insert("visitComments", {
            publicationId,
            profileId: writer.profileId,
            body: `Comment ${i}`,
            requestId: crypto.randomUUID(),
          });
          for (const profileId of likers) await ctx.db.insert("commentLikes", { commentId, profileId });
          await ctx.db.insert("commentLikeCounts", { commentId, likeCount: likers.length });
        });
      }
      await t.run((ctx) => ctx.db.insert("visitEngagement", { publicationId, likeCount: 0, commentCount: 50 }));
      const account = deletedAccount === "writer" ? writer : author;
      while (await t.run((ctx) => purgeSocialBatch(ctx, account.accountId))) {
        /* drain bounded batches */
      }
      await t.run(async (ctx) => {
        expect(await ctx.db.get("profiles", account.profileId)).toBeNull();
        expect(await ctx.db.query("visitComments").take(1)).toEqual([]);
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await t.run(async (ctx) => {
        expect(await ctx.db.query("commentLikes").take(1)).toEqual([]);
        expect(await ctx.db.query("commentLikeCounts").take(1)).toEqual([]);
      });
    },
  );
});

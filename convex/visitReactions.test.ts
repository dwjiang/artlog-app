import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { purgeSocialBatch } from "./lib/socialCleanup";
import { setVisitVisibility, socialUser, socialVisit } from "./lib/socialTestFixtures";
import { harness } from "./test.helpers";

async function fixture() {
  const t = harness();
  const author = await socialUser(t, "Author");
  const visitor = await socialUser(t, "Visitor");
  const visit = await socialVisit(t, author);
  const publication = await author.as.mutation(api.sharedVisits.publish, visit.selection);
  return { t, author, visitor, visit, postId: publication.postId! };
}

describe("visit reactions", () => {
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
    });
  });

  it("posts once on retry, paginates comments, and only lets the writer delete", async () => {
    const { t, author, visitor, postId } = await fixture();
    const requestId = crypto.randomUUID();
    const id = await visitor.as.mutation(api.visitReactions.addComment, {
      postId,
      body: "  Beautiful work.  ",
      requestId,
    });
    expect(
      await visitor.as.mutation(api.visitReactions.addComment, {
        postId,
        body: "Beautiful work.",
        requestId,
      }),
    ).toBe(id);
    await author.as.mutation(api.visitReactions.addComment, {
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

  it("rejects guest writes and invalid comments", async () => {
    const { t, visitor, postId } = await fixture();
    await expect(t.mutation(api.visitReactions.setLike, { postId, liked: true })).rejects.toThrow("unauthenticated");
    await expect(
      t.mutation(api.visitReactions.addComment, {
        postId,
        body: "Hello",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("unauthenticated");
    for (const body of ["  ", "x".repeat(1001)]) {
      await expect(
        visitor.as.mutation(api.visitReactions.addComment, {
          postId,
          body,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ data: { code: "invalid_comment" } });
    }
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
      visitor.as.mutation(api.visitReactions.addComment, {
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
    await visitor.as.mutation(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    await third.as.mutation(api.friendships.block, {
      profileId: visitor.profileId,
      revision: 0,
      blockRevision: 0,
    });
    expect((await third.as.query(api.visitReactions.listComments, { postId })).page).toEqual([]);
    expect((await third.as.query(api.visitReactions.listLikes, { postId })).page).toEqual([]);
    await author.as.mutation(api.friendships.block, {
      profileId: visitor.profileId,
      revision: 0,
      blockRevision: 0,
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
    await visitor.as.mutation(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    await author.as.mutation(api.friendships.block, {
      profileId: visitor.profileId,
      revision: 0,
      blockRevision: 0,
    });
    for (const reader of [t, third.as, author.as]) {
      expect((await reader.query(api.visitReactions.listComments, { postId })).page).toEqual([]);
      expect((await reader.query(api.visitReactions.listLikes, { postId })).page).toEqual([]);
    }
  });

  it("removes a deleted account’s reactions and publication children", async () => {
    const { t, author, visitor, postId } = await fixture();
    await visitor.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await visitor.as.mutation(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    while (await t.run((ctx) => purgeSocialBatch(ctx, visitor.accountId))) {
      /* drain bounded batches */
    }
    expect(await t.query(api.visitReactions.getSummary, { postId })).toMatchObject({
      likeCount: 0,
      commentCount: 0,
    });
    await author.as.mutation(api.visitReactions.setLike, {
      postId,
      liked: true,
    });
    await author.as.mutation(api.visitReactions.addComment, {
      postId,
      body: "Hello",
      requestId: crypto.randomUUID(),
    });
    while (await t.run((ctx) => purgeSocialBatch(ctx, author.accountId))) {
      /* drain bounded batches */
    }
    await t.run(async (ctx) => {
      for (const table of ["visitLikes", "visitComments", "visitEngagement", "notifications"] as const) {
        expect(await ctx.db.query(table).take(1)).toEqual([]);
      }
    });
  });
});

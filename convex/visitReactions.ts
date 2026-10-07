import { ConvexError, type Infer, v } from "convex/values";

import { pageArgs, pagination } from "../shared/journal/contracts";
import { isUuid } from "../shared/journal/limits";
import { mention, publicProfile } from "../shared/social/contracts";
import { MAX_COMMENT_LENGTH } from "../shared/social/visit-reactions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { linkedMentions, resolveMentions } from "./lib/mentions";
import { flaggedUserTexts } from "./lib/moderation";
import { withErrorReporting } from "./lib/observability";
import { optionalProfile, requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { requireSharedVisit } from "./lib/publicationAccess";
import { limitKey } from "./lib/rateLimits";
import { publicationRecordTitles } from "./lib/sharedPublications";
import {
  changeCommentLikes,
  changeEngagement,
  commentLikeCount,
  engagement,
  insertVisitComment,
  insertVisitLike,
  visibleParticipant,
} from "./lib/visitReactions";

const comment = v.object({
  commentId: v.id("visitComments"),
  author: publicProfile,
  body: v.string(),
  createdAt: v.number(),
  isAuthor: v.boolean(),
  likeCount: v.number(),
  liked: v.boolean(),
  mentions: v.array(mention),
});
const latestComment = v.object({
  commentId: v.id("visitComments"),
  author: v.object({ profileId: v.id("profiles"), name: v.string() }),
  body: v.string(),
  mentions: v.array(mention),
});
// Comments from blocked writers are skipped, so the preview gives up after this many hidden ones.
const LATEST_COMMENT_SCAN = 10;
const COMMENT_LIKE_BATCH = 100;

function viewerCommentLike(ctx: QueryCtx, commentId: Id<"visitComments">, viewerId: Id<"profiles">) {
  return ctx.db
    .query("commentLikes")
    .withIndex("by_comment_profile", (q) => q.eq("commentId", commentId).eq("profileId", viewerId))
    .unique();
}
const pageFields = {
  cursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
};

export const getSummary = query({
  args: { postId: v.string() },
  returns: v.object({
    likeCount: v.number(),
    commentCount: v.number(),
    liked: v.boolean(),
    latestComment: v.union(latestComment, v.null()),
  }),
  handler: async (ctx, { postId }) => {
    const viewer = await optionalProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, postId, viewer?._id);
    const counts = await engagement(ctx, publication._id);
    const like =
      viewer
      && (await ctx.db
        .query("visitLikes")
        .withIndex("by_publication_profile", (q) => q.eq("publicationId", publication._id).eq("profileId", viewer._id))
        .unique());
    let latest = null;
    let scanned = 0;
    for await (const row of ctx.db
      .query("visitComments")
      .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
      .order("desc")) {
      const author = await visibleParticipant(ctx, row.profileId, [viewer?._id, publication.profileId]);
      if (author) {
        latest = {
          commentId: row._id,
          author: { profileId: author._id, name: author.name },
          body: row.body,
          mentions: await linkedMentions(ctx, row.mentions, {
            viewerId: viewer?._id,
            writerId: row.profileId,
            post: publication,
          }),
        };
        break;
      }
      if (++scanned === LATEST_COMMENT_SCAN) break;
    }
    return {
      likeCount: counts?.likeCount ?? 0,
      commentCount: counts?.commentCount ?? 0,
      liked: !!like,
      latestComment: latest,
    };
  },
});

export const setLike = mutation({
  args: { postId: v.string(), liked: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { postId, liked }) => {
    const { profile, accountId } = await requireProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, postId, profile._id);
    const current = await ctx.db
      .query("visitLikes")
      .withIndex("by_publication_profile", (q) => q.eq("publicationId", publication._id).eq("profileId", profile._id))
      .unique();
    if (!!current === liked) return null;
    await limitKey(ctx, "likeVisit", accountId);
    if (current) {
      await ctx.db.delete("visitLikes", current._id);
      await changeEngagement(ctx, publication._id, "likeCount", -1);
    } else {
      await insertVisitLike(ctx, publication._id, profile._id);
    }
    return null;
  },
});

export const listLikes = query({
  args: { postId: v.string(), ...pageArgs },
  returns: v.object({ page: v.array(publicProfile), ...pageFields }),
  handler: async (ctx, input) => {
    const viewer = await optionalProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, input.postId, viewer?._id);
    const result = await ctx.db
      .query("visitLikes")
      .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
      .order("desc")
      .paginate(pagination(input));
    const page = [];
    for (const row of result.page) {
      const profile = await visibleParticipant(ctx, row.profileId, [viewer?._id, publication.profileId]);
      if (profile) page.push(await projectProfile(ctx, profile));
    }
    return {
      page,
      isDone: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const listComments = query({
  args: { postId: v.string(), ...pageArgs },
  returns: v.object({ page: v.array(comment), ...pageFields }),
  handler: async (ctx, input) => {
    const viewer = await optionalProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, input.postId, viewer?._id);
    const result = await ctx.db
      .query("visitComments")
      .withIndex("by_publication", (q) => q.eq("publicationId", publication._id))
      .paginate(pagination(input));
    const page = [];
    for (const row of result.page) {
      const profile = await visibleParticipant(ctx, row.profileId, [viewer?._id, publication.profileId]);
      if (profile) {
        page.push({
          commentId: row._id,
          author: await projectProfile(ctx, profile),
          body: row.body,
          createdAt: row._creationTime,
          isAuthor: row.profileId === publication.profileId,
          likeCount: (await commentLikeCount(ctx, row._id))?.likeCount ?? 0,
          liked: !!viewer && !!(await viewerCommentLike(ctx, row._id, viewer._id)),
          mentions: await linkedMentions(ctx, row.mentions, {
            viewerId: viewer?._id,
            writerId: row.profileId,
            post: publication,
          }),
        });
      }
    }
    return {
      page,
      isDone: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

const commentInput = v.object({ postId: v.string(), body: v.string(), requestId: v.string() });
async function readCommentRequest(ctx: QueryCtx, input: Infer<typeof commentInput>) {
  const { profile, accountId } = await requireProfile(ctx);
  const { publication } = await requireSharedVisit(ctx, input.postId, profile._id);
  const body = input.body.trim();
  if (!body || body.length > MAX_COMMENT_LENGTH || !isUuid(input.requestId)) {
    throw new ConvexError({ code: "invalid_comment" });
  }
  const existing = await ctx.db
    .query("visitComments")
    .withIndex("by_profile_request", (q) => q.eq("profileId", profile._id).eq("requestId", input.requestId))
    .unique();
  if (existing && (existing.publicationId !== publication._id || existing.body !== body)) {
    throw new ConvexError({ code: "invalid_comment" });
  }
  return { profile, accountId, publication, body, existing };
}
export const addComment = action({
  args: commentInput.fields,
  returns: v.id("visitComments"),
  handler: (ctx, input): Promise<Id<"visitComments">> =>
    withErrorReporting("visitReactions.addComment", async () => {
      const { commentId, titles } = await ctx.runMutation(internal.visitReactions.prepareComment, input);
      if (commentId) return commentId;
      const [flagged] = await flaggedUserTexts([input.body], titles);
      if (flagged) throw new ConvexError({ code: "comment_not_allowed" });
      return ctx.runMutation(internal.visitReactions.insertComment, input);
    }),
});
export const prepareComment = internalMutation({
  args: commentInput.fields,
  returns: v.object({ commentId: v.union(v.id("visitComments"), v.null()), titles: v.array(v.string()) }),
  handler: async (ctx, input) => {
    const { publication, accountId, existing } = await readCommentRequest(ctx, input);
    if (existing) return { commentId: existing._id, titles: [] };
    // Commit the attempt before moderation, so rejected text also consumes the quota.
    await limitKey(ctx, "commentVisit", accountId);
    return { commentId: null, titles: await publicationRecordTitles(ctx, publication._id) };
  },
});
export const insertComment = internalMutation({
  args: commentInput.fields,
  returns: v.id("visitComments"),
  handler: async (ctx, input) => {
    const { profile, publication, body, existing } = await readCommentRequest(ctx, input);
    if (existing) return existing._id;
    return insertVisitComment(ctx, {
      publicationId: publication._id,
      profileId: profile._id,
      body,
      requestId: input.requestId,
      mentions: await resolveMentions(ctx, body, profile._id),
    });
  },
});

export const setCommentLike = mutation({
  args: { postId: v.string(), commentId: v.id("visitComments"), liked: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { postId, commentId, liked }) => {
    const { profile, accountId } = await requireProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, postId, profile._id);
    const row = await ctx.db.get("visitComments", commentId);
    if (
      !row
      || row.publicationId !== publication._id
      || !(await visibleParticipant(ctx, row.profileId, [profile._id, publication.profileId]))
    ) {
      throw new ConvexError({ code: "not_found" });
    }
    const current = await viewerCommentLike(ctx, commentId, profile._id);
    if (!!current === liked) return null;
    await limitKey(ctx, "likeComment", accountId);
    if (current) {
      await ctx.db.delete("commentLikes", current._id);
    } else {
      await ctx.db.insert("commentLikes", { commentId, profileId: profile._id });
    }
    await changeCommentLikes(ctx, commentId, liked ? 1 : -1);
    return null;
  },
});

export const deleteComment = mutation({
  args: { postId: v.string(), commentId: v.id("visitComments") },
  returns: v.null(),
  handler: async (ctx, { postId, commentId }) => {
    const { profile } = await requireProfile(ctx);
    const { publication } = await requireSharedVisit(ctx, postId, profile._id);
    const row = await ctx.db.get("visitComments", commentId);
    if (!row) return null;
    if (row.publicationId !== publication._id || row.profileId !== profile._id) {
      throw new ConvexError({ code: "not_found" });
    }
    await ctx.db.delete("visitComments", commentId);
    await changeEngagement(ctx, publication._id, "commentCount", -1);
    return null;
  },
});

export const purgeCommentLikesBatch = internalMutation({
  args: { commentId: v.id("visitComments") },
  returns: v.null(),
  handler: async (ctx, { commentId }): Promise<null> => {
    const likes = await ctx.db
      .query("commentLikes")
      .withIndex("by_comment_profile", (q) => q.eq("commentId", commentId))
      .take(COMMENT_LIKE_BATCH);
    for (const like of likes) await ctx.db.delete("commentLikes", like._id);
    if (likes.length === COMMENT_LIKE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.visitReactions.purgeCommentLikes, { commentId });
    }
    return null;
  },
});

export const purgeCommentLikes = internalAction({
  args: { commentId: v.id("visitComments") },
  returns: v.null(),
  handler: (ctx, args): Promise<null> =>
    withErrorReporting("visitReactions.purgeCommentLikes", () =>
      ctx.runMutation(internal.visitReactions.purgeCommentLikesBatch, args),
    ),
});

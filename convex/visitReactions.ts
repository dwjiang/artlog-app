import { ConvexError, v } from "convex/values";

import { pageArgs, pagination } from "../shared/journal/contracts";
import { isUuid } from "../shared/journal/limits";
import { publicProfile } from "../shared/social/contracts";
import { MAX_COMMENT_LENGTH } from "../shared/social/visit-reactions";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { optionalProfile, requireProfile } from "./lib/ownership";
import { projectProfile } from "./lib/projections";
import { requireSharedVisit } from "./lib/publicationAccess";
import { limitKey } from "./lib/rateLimits";
import { changeEngagement, engagement, visibleParticipant } from "./lib/visitReactions";

const comment = v.object({
  commentId: v.id("visitComments"),
  author: publicProfile,
  body: v.string(),
  createdAt: v.number(),
  isAuthor: v.boolean(),
});
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
    return {
      likeCount: counts?.likeCount ?? 0,
      commentCount: counts?.commentCount ?? 0,
      liked: !!like,
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
    } else {
      await ctx.db.insert("visitLikes", {
        publicationId: publication._id,
        profileId: profile._id,
      });
    }
    await changeEngagement(ctx, publication._id, "likeCount", liked ? 1 : -1);
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

export const addComment = mutation({
  args: { postId: v.string(), body: v.string(), requestId: v.string() },
  returns: v.id("visitComments"),
  handler: async (ctx, input) => {
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
    if (existing) {
      if (existing.publicationId !== publication._id || existing.body !== body) {
        throw new ConvexError({ code: "invalid_comment" });
      }
      return existing._id;
    }
    await limitKey(ctx, "commentVisit", accountId);
    const id = await ctx.db.insert("visitComments", {
      publicationId: publication._id,
      profileId: profile._id,
      body,
      requestId: input.requestId,
    });
    await changeEngagement(ctx, publication._id, "commentCount", 1);
    return id;
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

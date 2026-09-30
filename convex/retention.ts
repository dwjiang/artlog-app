import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { feedbackChanged } from "./feedbackReplay";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { withErrorReporting } from "./lib/observability";
import { resetMultiView } from "./revert";
import { deleteEmbedding } from "./scanEmbeddings";

const BATCH = 50;
export const expireBatch = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    let more = false;
    const now = Date.now();
    const narrations = await ctx.db
      .query("narrationFailures")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(BATCH);
    for (const row of narrations) await ctx.db.delete("narrationFailures", row._id);
    more ||= narrations.length === BATCH;
    const challenges = await ctx.db
      .query("attestChallenges")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(BATCH);
    for (const row of challenges) await ctx.db.delete("attestChallenges", row._id);
    more ||= challenges.length === BATCH;
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(BATCH);
    for (const row of scans) {
      await ctx.db.patch("scans", row._id, {
        candidateSignals: undefined,
        runnerUps: undefined,
        labelFlow: row.labelFlow ? { ...row.labelFlow, rawOcr: undefined } : undefined,
        expiresAt: undefined,
      });
    }
    more ||= scans.length === BATCH;
    const feedback = await ctx.db
      .query("feedback")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(BATCH);
    for (const row of feedback) {
      await bumpCounter(ctx, "vectors", -(await resetMultiView(ctx, row)));
      await deleteEmbedding(ctx, row.embeddingId);
      await ctx.db.delete("feedback", row._id);
      await feedbackChanged(ctx, row.rejectedObjectId);
    }
    more ||= feedback.length === BATCH;
    const events = await ctx.db
      .query("feedbackEvents")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(BATCH);
    for (const row of events) {
      await ctx.db.delete("feedbackEvents", row._id);
      await feedbackChanged(ctx, row.objectId);
    }
    more ||= events.length === BATCH;
    const removals = await ctx.db
      .query("deviceRemovals")
      .withIndex("by_expiresAt", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(BATCH);
    for (const row of removals) {
      const dependency = await ctx.db
        .query("removalDependencies")
        .withIndex("by_job", (q) => q.eq("jobId", row._id))
        .first();
      if (row.phase === "complete" && !dependency) await ctx.db.delete("deviceRemovals", row._id);
      else await ctx.db.patch("deviceRemovals", row._id, { expiresAt: now + 24 * 60 * 60_000 });
    }
    more ||= removals.length === BATCH;
    return more;
  },
});

export const expire = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx) =>
    withErrorReporting("retention.expire", async () => {
      if (await ctx.runMutation(internal.retention.expireBatch, {})) {
        await ctx.scheduler.runAfter(0, internal.retention.expire, {});
      }
      return null;
    }),
});

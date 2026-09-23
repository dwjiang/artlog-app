import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { FLAG_MIN_REJECTIONS, FLAG_REJECT_RATIO, PENALTY_STEP } from "./lib/rejectionPenalty";

export async function feedbackChanged(ctx: MutationCtx, objectId: Id<"objects">, rebuild = true) {
  const object = await ctx.db.get(objectId);
  if (!object) return;
  const revision = (object.feedbackRevision ?? 0) + 1;
  await ctx.db.patch(objectId, { feedbackRevision: revision });
  if (
    !rebuild ||
    (await ctx.db
      .query("feedbackRebuilds")
      .withIndex("by_object", (q) => q.eq("objectId", objectId))
      .unique())
  )
    return;
  const jobId = await ctx.db.insert("feedbackRebuilds", {
    objectId,
    revision,
    cursor: null,
    confirmCount: 0,
    rejectCount: 0,
    rejectionPenalty: 0,
    flaggedForReview: false,
  });
  await ctx.scheduler.runAfter(0, internal.feedbackReplay.rebuildPage, { jobId });
}

export const rebuildPage = internalMutation({
  args: { jobId: v.id("feedbackRebuilds") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const object = await ctx.db.get(job.objectId);
    if (!object) {
      await ctx.db.delete(jobId);
      return null;
    }
    const restart = job.revision !== (object.feedbackRevision ?? 0);
    const state = restart
      ? { confirmCount: 0, rejectCount: 0, rejectionPenalty: 0, flaggedForReview: false }
      : {
          confirmCount: job.confirmCount,
          rejectCount: job.rejectCount,
          rejectionPenalty: job.rejectionPenalty,
          flaggedForReview: job.flaggedForReview,
        };
    const page = await ctx.db
      .query("feedbackEvents")
      .withIndex("by_object_created", (q) => q.eq("objectId", object._id))
      .paginate({ cursor: restart ? null : job.cursor, numItems: 50 });
    for (const event of page.page) {
      const device = await ctx.db.get(event.deviceId);
      if (!device || device.banned) continue;
      if (event.kind === "confirmation") state.confirmCount++;
      else {
        const feedback = event.feedbackId ? await ctx.db.get(event.feedbackId) : null;
        if (!feedback || feedback.resolution.kind === "false_rejection") continue;
        state.rejectCount++;
        const flagged =
          state.rejectCount >= FLAG_MIN_REJECTIONS &&
          state.rejectCount / (state.confirmCount + state.rejectCount) >= FLAG_REJECT_RATIO;
        if (flagged) {
          state.flaggedForReview = true;
          state.rejectionPenalty += PENALTY_STEP;
        }
        await ctx.db.patch(feedback._id, { penaltyAdded: flagged ? PENALTY_STEP : 0 });
      }
    }
    if (page.isDone) {
      await ctx.db.patch(object._id, state);
      await ctx.db.delete(jobId);
    } else {
      await ctx.db.patch(jobId, {
        ...state,
        revision: object.feedbackRevision ?? 0,
        cursor: page.continueCursor,
      });
      await ctx.scheduler.runAfter(0, internal.feedbackReplay.rebuildPage, { jobId });
    }
    return null;
  },
});

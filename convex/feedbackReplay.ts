import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { patchContributionState } from "./lib/objectContributionState";
import { FLAG_MIN_REJECTIONS, FLAG_REJECT_RATIO, PENALTY_STEP } from "./lib/rejectionPenalty";

export async function feedbackChanged(ctx: MutationCtx, objectId: Id<"objects">, rebuild = true) {
  const object = await ctx.db.get("objects", objectId);
  if (!object) return;
  const revision = object.feedbackRevision + 1;
  await ctx.db.patch("objects", objectId, { feedbackRevision: revision });
  if (
    !rebuild
    || (await ctx.db
      .query("feedbackRebuilds")
      .withIndex("by_object", (q) => q.eq("objectId", objectId))
      .unique())
  ) {
    return;
  }
  const jobId = await ctx.db.insert("feedbackRebuilds", {
    objectId,
    revision,
    cursor: null,
    confirmCount: 0,
    rejectCount: 0,
    rejectionPenalty: 0,
    flaggedForReview: false,
  });
  await ctx.scheduler.runAfter(0, internal.feedbackReplay.rebuildPage, {
    jobId,
  });
}

export const rebuildPage = internalMutation({
  args: { jobId: v.id("feedbackRebuilds") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("feedbackRebuilds", jobId);
    if (!job) return null;
    const object = await ctx.db.get("objects", job.objectId);
    if (!object) {
      await ctx.db.delete("feedbackRebuilds", jobId);
      return null;
    }
    const restart = job.revision !== object.feedbackRevision;
    const state = restart
      ? {
          confirmCount: 0,
          rejectCount: 0,
          rejectionPenalty: 0,
          flaggedForReview: false,
        }
      : {
          confirmCount: job.confirmCount,
          rejectCount: job.rejectCount,
          rejectionPenalty: job.rejectionPenalty,
          flaggedForReview: job.flaggedForReview,
        };
    const page = await ctx.db
      .query("feedbackEvents")
      .withIndex("by_object", (q) => q.eq("objectId", object._id))
      .paginate({ cursor: restart ? null : job.cursor, numItems: 50 });
    for (const event of page.page) {
      const device = await ctx.db.get("devices", event.deviceId);
      if (!device || device.banned) continue;
      if (event.kind === "confirmation") {
        state.confirmCount++;
      } else {
        const feedback = event.feedbackId ? await ctx.db.get("feedback", event.feedbackId) : null;
        if (!feedback || feedback.resolution.kind === "false_rejection") {
          continue;
        }
        state.rejectCount++;
        const flagged =
          state.rejectCount >= FLAG_MIN_REJECTIONS
          && state.rejectCount / (state.confirmCount + state.rejectCount) >= FLAG_REJECT_RATIO;
        if (flagged) {
          state.flaggedForReview = true;
          state.rejectionPenalty += PENALTY_STEP;
        }
        await ctx.db.patch("feedback", feedback._id, {
          penaltyAdded: flagged ? PENALTY_STEP : 0,
        });
      }
    }
    if (page.isDone) {
      const { flaggedForReview, ...counts } = state;
      await ctx.db.patch("objects", object._id, counts);
      await patchContributionState(ctx, object._id, { flaggedForReview });
      await ctx.db.delete("feedbackRebuilds", jobId);
    } else {
      await ctx.db.patch("feedbackRebuilds", jobId, {
        ...state,
        revision: object.feedbackRevision,
        cursor: page.continueCursor,
      });
      await ctx.scheduler.runAfter(0, internal.feedbackReplay.rebuildPage, {
        jobId,
      });
    }
    return null;
  },
});

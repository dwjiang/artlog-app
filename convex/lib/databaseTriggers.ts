import { Triggers } from "convex-helpers/server/triggers";

import type { DataModel } from "../_generated/dataModel";
import { registerArtists } from "./artists";
import { registerFileReferences } from "./fileReferences";
import { registerNotifications } from "./notifications";
import { registerPostTags } from "./postTags";
import { withdrawProfilePosts } from "./publicationUpdates";
import { CHALLENGE_RETENTION_MS, COMPLETED_REMOVAL_RETENTION_MS, EVIDENCE_RETENTION_MS } from "./retentionPolicy";
import { registerVisitCompanions } from "./visitCompanions";
import { registerCommentLikeCleanup } from "./visitReactions";

export const databaseTriggers = new Triggers<DataModel>();
registerFileReferences(databaseTriggers);
registerNotifications(databaseTriggers);
registerCommentLikeCleanup(databaseTriggers);
registerPostTags(databaseTriggers);
registerVisitCompanions(databaseTriggers);
registerArtists(databaseTriggers);

databaseTriggers.register("attestChallenges", async (ctx, { newDoc, operation }) => {
  if (operation === "insert") {
    await ctx.db.patch("attestChallenges", newDoc._id, { expiresAt: newDoc._creationTime + CHALLENGE_RETENTION_MS });
  }
});
databaseTriggers.register("scans", async (ctx, { newDoc, oldDoc }) => {
  if (newDoc && (!oldDoc || oldDoc.updatedAt !== newDoc.updatedAt)) {
    await ctx.db.patch("scans", newDoc._id, { expiresAt: newDoc.updatedAt + EVIDENCE_RETENTION_MS });
  }
});
databaseTriggers.register("feedback", async (ctx, { newDoc, operation }) => {
  if (operation === "insert") {
    await ctx.db.patch("feedback", newDoc._id, { expiresAt: newDoc._creationTime + EVIDENCE_RETENTION_MS });
  }
});
databaseTriggers.register("feedbackEvents", async (ctx, { newDoc, operation }) => {
  if (operation === "insert") {
    await ctx.db.patch("feedbackEvents", newDoc._id, { expiresAt: newDoc._creationTime + EVIDENCE_RETENTION_MS });
  }
});
databaseTriggers.register("deviceRemovals", async (ctx, { newDoc, oldDoc }) => {
  if (!newDoc || (oldDoc?.phase === newDoc.phase && oldDoc?.completedAt === newDoc.completedAt)) return;
  await ctx.db.patch("deviceRemovals", newDoc._id, {
    expiresAt:
      newDoc.phase === "complete" && newDoc.completedAt !== undefined
        ? newDoc.completedAt + COMPLETED_REMOVAL_RETENTION_MS
        : undefined,
  });
});

databaseTriggers.register("profiles", async (ctx, { newDoc, oldDoc }) => {
  const profile = newDoc ?? oldDoc!;
  if (oldDoc?.active && !oldDoc.removal && (!newDoc?.active || newDoc.removal)) {
    await withdrawProfilePosts(ctx, profile._id);
  }
  const visibility = newDoc?.active && !newDoc.removal ? newDoc.leaderboardVisibility : "off";
  if (
    oldDoc
    && oldDoc.active === newDoc?.active
    && oldDoc.removal === newDoc?.removal
    && oldDoc.leaderboardVisibility === visibility
  ) {
    return;
  }
  for await (const row of ctx.db
    .query("leaderboardScores")
    .withIndex("by_account_metric", (q) => q.eq("accountId", profile.accountId))) {
    if (row.visibility !== visibility) await ctx.db.patch("leaderboardScores", row._id, { visibility });
  }
  if (!oldDoc && newDoc) {
    for (const metric of ["artworks", "visits"] as const) {
      const row = await ctx.db
        .query("leaderboardScores")
        .withIndex("by_account_metric", (q) => q.eq("accountId", profile.accountId).eq("metric", metric))
        .unique();
      if (!row) {
        await ctx.db.insert("leaderboardScores", {
          accountId: profile.accountId,
          metric,
          score: 0,
          visibility,
        });
      }
    }
  }
});

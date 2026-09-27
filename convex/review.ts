import { ConvexError, v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { clearDocent } from "./docent";
import { internalMutation } from "./functions";
import { patchArtworkContent } from "./lib/artworkContent";
import { factSheetEntry } from "./lib/validators";
import { changeEngagement } from "./lib/visitReactions";
import { deactivateWallItem } from "./lib/wallItems";
import schema from "./schema";

const MAX_ROWS = 100;
const REVIEW_PAGE_BYTES = 1024 * 1024;
const cursorArg = v.union(v.string(), v.null());

const contributionFields = schema.tables.contributions.validator.fields;
// Vectors and descriptors stay out of the listing; the dashboard reads JSON.
const contributionReview = v.object({
  _id: v.id("contributions"),
  deviceId: contributionFields.deviceId,
  venueId: contributionFields.venueId,
  scanId: contributionFields.scanId,
  fields: contributionFields.fields,
  evidence: contributionFields.evidence,
  wikidataId: contributionFields.wikidataId,
  status: contributionFields.status,
  rejectedReason: contributionFields.rejectedReason,
  indexedObjectId: contributionFields.indexedObjectId,
  _creationTime: v.number(),
});

// Flagged works and agreed proposals land in a review queue read from the dashboard, e.g.
// `npx convex run review:listFlaggedObjects`.
export const listFlaggedObjects = internalQuery({
  args: {},
  returns: v.array(schema.doc("objects")),
  handler: async (ctx) => {
    const states = await ctx.db
      .query("objectContributionState")
      .withIndex("by_flaggedForReview", (q) => q.eq("flaggedForReview", true))
      .order("desc")
      .take(MAX_ROWS);
    const objects = await Promise.all(states.map((state) => ctx.db.get("objects", state.objectId)));
    return objects.filter((object) => object !== null);
  },
});

export const listContributions = internalQuery({
  args: {
    status: v.optional(contributionFields.status),
    cursor: v.optional(cursorArg),
  },
  returns: v.object({ rows: v.array(contributionReview), cursor: cursorArg }),
  handler: async (ctx, { status, cursor }) => {
    const page = await ctx.db
      .query("contributions")
      .withIndex("by_status", (q) => q.eq("status", status ?? "tentative"))
      .order("desc")
      .paginate({
        cursor: cursor ?? null,
        numItems: MAX_ROWS,
        maximumBytesRead: REVIEW_PAGE_BYTES,
      });
    return {
      rows: page.page.map((row) => ({
        _id: row._id,
        deviceId: row.deviceId,
        venueId: row.venueId,
        scanId: row.scanId,
        fields: row.fields,
        evidence: row.evidence,
        wikidataId: row.wikidataId,
        status: row.status,
        rejectedReason: row.rejectedReason,
        indexedObjectId: row.indexedObjectId,
        _creationTime: row._creationTime,
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const listProposalsReady = internalQuery({
  args: {},
  returns: v.array(schema.doc("placementProposals")),
  handler: (ctx) =>
    ctx.db
      .query("placementProposals")
      .withIndex("by_status_readyForReview", (q) => q.eq("status", "pending").eq("readyForReview", true))
      .order("desc")
      .take(MAX_ROWS),
});

// Dashboard query: `npx convex run review:listFeedback`.
export const listFeedback = internalQuery({
  args: {},
  returns: v.array(schema.doc("appFeedback")),
  handler: (ctx) => ctx.db.query("appFeedback").order("desc").take(MAX_ROWS),
});

// Dashboard query: `npx convex run review:listCorrections`.
export const listCorrections = internalQuery({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
  },
  returns: v.array(schema.doc("factCorrections")),
  handler: (ctx, { status }) =>
    ctx.db
      .query("factCorrections")
      .withIndex("by_status", (q) => q.eq("status", status ?? "open"))
      .order("desc")
      .take(MAX_ROWS),
});

// Only a deliberate review may replace a disputed sheet and resume automatic generation.
export const replaceFactSheet = internalMutation({
  args: {
    artworkId: v.id("artworks"),
    factSheet: v.array(factSheetEntry),
    correctionIds: v.array(v.id("factCorrections")),
  },
  returns: v.null(),
  handler: async (ctx, { artworkId, factSheet, correctionIds }) => {
    if (correctionIds.length > MAX_ROWS) {
      throw new ConvexError({ code: "too_many_corrections" });
    }
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) throw new ConvexError({ code: "artwork_not_found" });
    for (const correctionId of new Set(correctionIds)) {
      const correction = await ctx.db.get("factCorrections", correctionId);
      if (!correction || correction.artworkId !== artworkId) {
        throw new ConvexError({ code: "invalid_correction" });
      }
      await ctx.db.patch("factCorrections", correctionId, { status: "resolved" });
    }
    const outstanding = await ctx.db
      .query("factCorrections")
      .withIndex("by_artworkId_status", (q) => q.eq("artworkId", artworkId).eq("status", "open"))
      .first();
    await clearDocent(ctx, artwork);
    await patchArtworkContent(ctx, artwork, { factSheet });
    await ctx.db.patch("artworks", artworkId, {
      factSheetUpdatedAt: Date.now(),
      factSheetNeedsReview: outstanding ? true : undefined,
    });
    return null;
  },
});

const reportFields = schema.tables.reports.validator.fields;
const reportSummary = v.object({
  reportId: v.id("reports"),
  target: reportFields.target,
  reason: reportFields.reason,
  _creationTime: v.number(),
  status: reportFields.status,
  review: reportFields.review,
});
export const listReports = internalQuery({
  args: {
    status: v.optional(reportFields.status),
    cursor: v.optional(cursorArg),
  },
  returns: v.object({ rows: v.array(reportSummary), cursor: cursorArg }),
  handler: async (ctx, { status, cursor }) => {
    if (cursor && cursor.length > 8192) {
      throw new ConvexError({ code: "invalid_pagination" });
    }
    const result = await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", status ?? "open"))
      .order("desc")
      .paginate({
        cursor: cursor ?? null,
        numItems: MAX_ROWS,
        maximumBytesRead: REVIEW_PAGE_BYTES,
      });
    return {
      rows: result.page.map((report) => ({
        reportId: report._id,
        target: report.target,
        reason: report.reason,
        _creationTime: report._creationTime,
        status: report.status,
        review: report.review,
      })),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});
export const getReport = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.union(schema.doc("reports"), v.null()),
  handler: (ctx, { reportId }) => ctx.db.get("reports", reportId),
});
export const decideReport = internalMutation({
  args: {
    reportId: v.id("reports"),
    operator: v.string(),
    decision: v.union(v.literal("dismiss"), v.literal("remove")),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { reportId, operator, decision, reason }) => {
    if (!operator.trim() || operator.length > 120 || !reason.trim() || reason.length > 2000) {
      throw new ConvexError({ code: "invalid_report" });
    }
    const report = await ctx.db.get("reports", reportId);
    if (!report) throw new ConvexError({ code: "not_found" });
    if (report.status === "resolved") {
      if (
        report.review?.operator === operator
        && report.review.decision === decision
        && report.review.reason === reason
      ) {
        return null;
      }
      throw new ConvexError({ code: "conflict" });
    }
    const now = Date.now();
    const removal = { reportId, removedAt: now };
    if (decision === "remove") {
      const { target } = report;
      if (target.kind === "profile") {
        const profile = await ctx.db.get("profiles", target.profileId);
        if (profile && !profile.removal) {
          await ctx.db.patch("profiles", profile._id, {
            active: false,
            removal,
            publishedWallCount: 0,
            updatedAt: now,
          });
          const wall = await ctx.db
            .query("walls")
            .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
            .unique();
          if (wall) {
            await ctx.db.patch("walls", wall._id, {
              layoutRevision: wall.layoutRevision + 1,
            });
          }
        }
      } else if (target.kind === "wallItem") {
        const item = await ctx.db.get("wallItems", target.itemId);
        if (item && !item.removal) {
          await deactivateWallItem(ctx, item, removal);
        }
      } else if (target.kind === "sharedVisit") {
        const publication = await ctx.db
          .query("sharedVisits")
          .withIndex("by_postId", (q) => q.eq("postId", target.postId))
          .unique();
        if (publication && !publication.removal) {
          await ctx.db.patch("sharedVisits", publication._id, {
            status: "private",
            removal,
            publicationRevision: publication.publicationRevision + 1,
            updatedAt: now,
          });
        }
      } else {
        // The report's evidence keeps the comment's text after the row is gone.
        const comment = await ctx.db.get("visitComments", target.commentId);
        if (comment) {
          await ctx.db.delete("visitComments", comment._id);
          await changeEngagement(ctx, comment.publicationId, "commentCount", -1);
        }
      }
    }
    await ctx.db.patch("reports", reportId, {
      status: "resolved",
      review: { operator, decision, reason, reviewedAt: now },
    });
    return null;
  },
});

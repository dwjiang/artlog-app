import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';
import { clearDocent } from './docent';
import { factSheetEntry } from './lib/validators';
import schema from './schema';

const MAX_ROWS = 100;
const REVIEW_PAGE_BYTES = 1024 * 1024;
const cursorArg = v.union(v.string(), v.null());

const contributionFields = schema.tables.contributions.validator.fields;
// Vectors and descriptors stay out of the listing; the dashboard reads JSON.
const contributionReview = v.object({
  _id: v.id('contributions'), deviceId: contributionFields.deviceId, venueId: contributionFields.venueId,
  scanId: contributionFields.scanId, fields: contributionFields.fields, evidence: contributionFields.evidence,
  wikidataId: contributionFields.wikidataId, status: contributionFields.status, rejectedReason: contributionFields.rejectedReason,
  promotedObjectId: contributionFields.promotedObjectId, promotionNote: contributionFields.promotionNote,
  createdAt: contributionFields.createdAt,
});

// Design §8: flagged works and agreed proposals land in a review queue read from the dashboard, e.g.
// `npx convex run review:listFlaggedObjects`.
export const listFlaggedObjects = internalQuery({
  args: {},
  returns: v.array(schema.doc('objects')),
  handler: (ctx) =>
    ctx.db.query('objects').withIndex('by_flaggedForReview', (q) => q.eq('flaggedForReview', true)).order('desc').take(MAX_ROWS),
});

export const listPendingContributions = internalQuery({
  args: { status: v.optional(contributionFields.status), cursor: v.optional(cursorArg) },
  returns: v.object({ rows: v.array(contributionReview), cursor: cursorArg }),
  handler: async (ctx, { status, cursor }) => {
    const page = await ctx.db.query('contributions')
      .withIndex('by_status', (q) => q.eq('status', status ?? 'pending')).order('desc')
      .paginate({ cursor: cursor ?? null, numItems: MAX_ROWS, maximumBytesRead: REVIEW_PAGE_BYTES });
    return { rows: page.page.map((row) => ({
      _id: row._id, deviceId: row.deviceId, venueId: row.venueId, scanId: row.scanId, fields: row.fields, evidence: row.evidence,
      wikidataId: row.wikidataId, status: row.status, rejectedReason: row.rejectedReason, promotedObjectId: row.promotedObjectId,
      promotionNote: row.promotionNote, createdAt: row.createdAt,
    })), cursor: page.isDone ? null : page.continueCursor };
  },
});

export const listProposalsReady = internalQuery({
  args: {},
  returns: v.array(schema.doc('placementProposals')),
  handler: (ctx) =>
    ctx.db.query('placementProposals').withIndex('by_status', (q) => q.eq('status', 'pending'))
      .filter((q) => q.eq(q.field('readyForReview'), true)).order('desc').take(MAX_ROWS),
});

// Dashboard query: `npx convex run review:listCorrections`.
export const listCorrections = internalQuery({
  args: { status: v.optional(v.union(v.literal('open'), v.literal('resolved'))) },
  returns: v.array(schema.doc('factCorrections')),
  handler: (ctx, { status }) =>
    ctx.db.query('factCorrections').withIndex('by_status', (q) => q.eq('status', status ?? 'open')).order('desc').take(MAX_ROWS),
});

// Only a deliberate review may replace a disputed sheet and resume automatic generation.
export const replaceFactSheet = internalMutation({
  args: { artworkId: v.id('artworks'), factSheet: v.array(factSheetEntry), correctionIds: v.array(v.id('factCorrections')) },
  returns: v.null(),
  handler: async (ctx, { artworkId, factSheet, correctionIds }) => {
    if (correctionIds.length > MAX_ROWS) throw new ConvexError({ code: 'too_many_corrections' });
    const artwork = await ctx.db.get(artworkId);
    if (!artwork) throw new ConvexError({ code: 'artwork_not_found' });
    for (const correctionId of new Set(correctionIds)) {
      const correction = await ctx.db.get(correctionId);
      if (!correction || correction.artworkId !== artworkId) throw new ConvexError({ code: 'invalid_correction' });
      await ctx.db.patch(correctionId, { status: 'resolved' });
    }
    const outstanding = await ctx.db.query('factCorrections')
      .withIndex('by_artworkId_status', (q) => q.eq('artworkId', artworkId).eq('status', 'open')).first();
    await clearDocent(ctx, artwork);
    await ctx.db.patch(artworkId, { factSheet, factSheetUpdatedAt: Date.now(), factSheetNeedsReview: outstanding ? true : undefined });
    return null;
  },
});

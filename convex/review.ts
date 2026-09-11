import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery } from './_generated/server';
import { clearDocent } from './docent';
import { factSheetEntry } from './lib/validators';
import schema from './schema';

const MAX_ROWS = 100;

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

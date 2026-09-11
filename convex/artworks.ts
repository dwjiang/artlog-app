import { v } from 'convex/values';

import { query } from './_generated/server';
import { requireDevice } from './lib/auth';
import { docentSentence, factChip, rightsStatus } from './lib/validators';

// Artwork-level enrichment for a saved work (design §3): the snapshot never changes, this can.
export const enrichment = query({
  args: { artworkId: v.id('artworks') },
  returns: v.union(v.null(), v.object({
    docent: v.optional(v.array(docentSentence)), factSheet: v.optional(v.array(factChip)),
    rightsStatus, thumbnailUrl: v.optional(v.string()),
  })),
  handler: async (ctx, { artworkId }) => {
    await requireDevice(ctx);
    const artwork = await ctx.db.get(artworkId);
    if (!artwork) return null;
    let thumbnailUrl: string | undefined;
    if (artwork.rightsStatus === 'public_domain') {
      for await (const object of ctx.db.query('objects').withIndex('by_artworkId', (q) => q.eq('artworkId', artworkId))) {
        if (object.reverted || object.mergedInto || !object.thumbnailUrl) continue;
        thumbnailUrl = object.thumbnailUrl;
        break;
      }
    }
    return {
      docent: artwork.docent?.en,
      factSheet: artwork.factSheet?.map(({ id, sourceUrl, sourceLabel }) => ({ id, sourceUrl, sourceLabel })),
      rightsStatus: artwork.rightsStatus,
      thumbnailUrl,
    };
  },
});

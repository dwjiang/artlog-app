import { type Infer, v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { currentPlacement } from './lib/placements';
import schema from './schema';

const STALE_CLAIM_MS = 60 * 60 * 1000;
const MAX_LIMIT = 100;
const batchCursor = v.object({
  phase: v.union(v.literal('contributions'), v.literal('artworks')),
  cursor: v.union(v.string(), v.null()),
});
export type BatchCursor = Infer<typeof batchCursor>;

function claimable(artwork: Doc<'artworks'>, now: number): boolean {
  return artwork.factSheetUpdatedAt === undefined && !artwork.factSheetNeedsReview &&
    (artwork.enrichClaimedAt === undefined || artwork.enrichClaimedAt < now - STALE_CLAIM_MS);
}

async function onView(ctx: MutationCtx, artworkId: Id<'artworks'>, now: number): Promise<boolean> {
  for await (const object of ctx.db.query('objects').withIndex('by_artworkId', (q) => q.eq('artworkId', artworkId))) {
    if (object.reverted || object.mergedInto) continue;
    let current: Doc<'placements'> | null = null;
    for await (const placement of ctx.db.query('placements').withIndex('by_objectId', (q) => q.eq('objectId', object._id))) {
      current = currentPlacement(current ? [current, placement] : [placement], now);
    }
    if (current?.onView) return true;
  }
  return false;
}

// One bounded page per transaction. Empty pages still advance `after`; null completes the sweep.
// Contributions are examined before on-view works. Native cursors preserve ties in creation time.
export const claimBatch = internalMutation({
  args: { limit: v.number(), after: v.optional(batchCursor) },
  returns: v.object({ artworks: v.array(schema.doc('artworks')), after: v.union(batchCursor, v.null()) }),
  handler: async (ctx, args): Promise<{ artworks: Doc<'artworks'>[]; after: BatchCursor | null }> => {
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit)));
    const after = args.after ?? { phase: 'contributions', cursor: null };
    const now = Date.now();
    const claimed: Doc<'artworks'>[] = [];
    const take = async (artwork: Doc<'artworks'>) => {
      const fields = { enrichClaimedAt: now, enrichGeneration: (artwork.enrichGeneration ?? 0) + 1 };
      await ctx.db.patch(artwork._id, fields);
      claimed.push({ ...artwork, ...fields });
    };
    if (after.phase === 'contributions') {
      const page = await ctx.db.query('objects').withIndex('by_source', (q) => q.eq('source', 'user'))
        .paginate({ cursor: after.cursor, numItems: limit, maximumBytesRead: 1024 * 1024 });
      for (const object of page.page) {
        if (object.reverted || object.mergedInto) continue;
        const artwork = await ctx.db.get(object.artworkId);
        if (artwork && claimable(artwork, now)) await take(artwork);
      }
      return {
        artworks: claimed,
        after: page.isDone ? { phase: 'artworks', cursor: null } : { phase: 'contributions', cursor: page.continueCursor },
      };
    }
    const page = await ctx.db.query('artworks')
      .withIndex('by_factSheetUpdatedAt', (q) => q.eq('factSheetUpdatedAt', undefined))
      .paginate({ cursor: after.cursor, numItems: limit, maximumBytesRead: 1024 * 1024 });
    for (const artwork of page.page) {
      if (claimable(artwork, now) && await onView(ctx, artwork._id, now)) await take(artwork);
    }
    return { artworks: claimed, after: page.isDone ? null : { phase: 'artworks', cursor: page.continueCursor } };
  },
});

export const releaseClaim = internalMutation({
  args: { artworkId: v.id('artworks'), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { artworkId, generation }) => {
    const artwork = await ctx.db.get(artworkId);
    if (artwork?.enrichGeneration === generation) await ctx.db.patch(artworkId, { enrichClaimedAt: undefined });
    return null;
  },
});

import { ConvexError, type Infer, v } from 'convex/values';
import { ownerKey } from '../shared/journal/contracts';
import { reportEvidence, reportInput, validateReport } from '../shared/social/contracts';
import { mutation } from './_generated/server';
import { activeProfile, requireProfile, resolveOwner } from './lib/ownership';
import { requirePublicWallItem, requireSharedVisit } from './lib/publicationAccess';
import { projectWallArtwork } from './lib/projections';
import { limitKey } from './lib/rateLimits';

export const submit = mutation({
  args: reportInput.fields, returns: v.id('reports'),
  handler: async (ctx, input) => {
    validateReport(input);
    const { owner } = await resolveOwner(ctx);
    let evidence: Infer<typeof reportEvidence>;
    const target = input.target;
    if (target.kind === 'profile') {
      const profile = await activeProfile(ctx, target.profileId);
      if (!profile) throw new ConvexError({ code: 'not_found' });
      evidence = { kind: 'profile', profileId: profile._id, username: profile.username, name: profile.name, bio: profile.bio };
    } else if (target.kind === 'wallItem') {
      const { item, profile, save } = await requirePublicWallItem(ctx, target.itemId);
      const { artwork, note } = projectWallArtwork(item, save);
      evidence = { kind: 'wallItem', profileId: profile._id, itemId: item._id,
        title: artwork.title, artist: artwork.artist, date: artwork.date, medium: artwork.medium, note };
    } else {
      const { profile } = await requireProfile(ctx);
      const { publication } = await requireSharedVisit(ctx, target.postId, profile._id);
      evidence = { kind: 'sharedVisit', profileId: publication.profileId, postId: publication.postId, reflection: publication.reflection };
    }
    const existing = await ctx.db.query('reports').withIndex('by_reporter_target_status',
      (q) => q.eq('reporter', owner).eq('target', target).eq('status', 'open')).unique();
    if (existing) return existing._id;
    await limitKey(ctx, 'report', ownerKey(owner));
    return ctx.db.insert('reports', { reporter: owner, ...input, reason: input.reason.trim(), evidence, createdAt: Date.now(), status: 'open' });
  },
});

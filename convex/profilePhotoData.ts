import { ConvexError, v } from 'convex/values';
import { normalizeSearch } from '../shared/journal/limits';
import { publicProfile, validateProfile } from '../shared/social/contracts';
import { internalMutation, internalQuery } from './_generated/server';
import { requireProfile } from './lib/ownership';
import { projectProfile } from './lib/projections';

export const authorize = internalQuery({
  args: {}, returns: v.id('profiles'),
  handler: async (ctx) => (await requireProfile(ctx)).profile._id,
});

export const save = internalMutation({
  args: { profileId: v.id('profiles'), name: v.string(), bio: v.optional(v.string()), photo: v.optional(v.union(v.id('_storage'), v.null())) },
  returns: publicProfile,
  handler: async (ctx, input) => {
    const { profile } = await requireProfile(ctx);
    if (profile._id !== input.profileId) throw new ConvexError({ code: 'sync_scope_changed' });
    const fields = validateProfile(input);
    const photoStorageId = input.photo === undefined ? profile.photoStorageId : input.photo ?? undefined;
    await ctx.db.patch(profile._id, { ...fields, photoStorageId,
      searchText: normalizeSearch(`${profile.username} ${fields.name}`), updatedAt: Date.now() });
    if (profile.photoStorageId && profile.photoStorageId !== photoStorageId) await ctx.storage.delete(profile.photoStorageId);
    return projectProfile(ctx, { ...profile, ...fields, photoStorageId });
  },
});

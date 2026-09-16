import { ConvexError, v } from 'convex/values';
import { pageArgs, pagination } from '../shared/journal/contracts';
import { LIMITS, normalizeSearch } from '../shared/journal/limits';
import { publicProfile, validateProfile, validateSearch } from '../shared/social/contracts';
import { mutation, query } from './_generated/server';
import { activeProfile, requireAccount, requireProfile } from './lib/ownership';
import { acceptedRelationships, findBlock } from './lib/friendships';
import { projectProfile } from './lib/projections';

export const create = mutation({
  args: { username: v.string(), name: v.string(), bio: v.optional(v.string()) }, returns: publicProfile,
  handler: async (ctx, input) => {
    const { accountId } = await requireAccount(ctx);
    const fields = validateProfile(input);
    const existing = await ctx.db.query('profiles').withIndex('by_accountId', (q) => q.eq('accountId', accountId)).unique();
    if (existing) {
      if (!existing.active || existing.removal) throw new ConvexError({ code: 'profile_required' });
      return projectProfile(ctx, existing);
    }
    if (await ctx.db.query('profiles').withIndex('by_username', (q) => q.eq('username', input.username)).unique()) {
      throw new ConvexError({ code: 'username_taken' });
    }
    const profileId = await ctx.db.insert('profiles', { accountId, username: input.username, ...fields,
      searchText: normalizeSearch(`${input.username} ${fields.name}`), active: true, publishedWallCount: 0,
      createdAt: Date.now(), updatedAt: Date.now() });
    return projectProfile(ctx, (await ctx.db.get(profileId))!);
  },
});
export const getPublic = query({
  args: { profileId: v.id('profiles') }, returns: v.union(publicProfile, v.null()),
  handler: async (ctx, { profileId }) => { const profile = await activeProfile(ctx, profileId); return profile ? projectProfile(ctx, profile) : null; },
});
export const search = query({
  args: { query: v.string(), ...pageArgs },
  returns: v.object({ page: v.array(publicProfile), cursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, input) => {
    const search = validateSearch(input.query);
    const result = await ctx.db.query('profiles').withSearchIndex('search_text', (q) => q.search('searchText', search).eq('active', true))
      .paginate(pagination(input));
    const page = [];
    for (const profile of result.page) if (!profile.removal && await ctx.db.get(profile.accountId)) page.push(await projectProfile(ctx, profile));
    return { page, cursor: result.isDone ? null : result.continueCursor, isDone: result.isDone };
  },
});

export const mine = query({
  args: {}, returns: publicProfile,
  handler: async (ctx) => projectProfile(ctx, (await requireProfile(ctx)).profile),
});
export const friends = query({
  args: {}, returns: v.array(publicProfile),
  handler: async (ctx) => {
    const { profile } = await requireProfile(ctx);
    const edges = (await acceptedRelationships(ctx, profile._id)).slice(0, LIMITS.friends);
    const people = [];
    for (const edge of edges) {
      const id = edge.firstProfileId === profile._id ? edge.secondProfileId : edge.firstProfileId;
      const person = await activeProfile(ctx, id);
      if (person && !(await findBlock(ctx, profile._id, id))?.active && !(await findBlock(ctx, id, profile._id))?.active) {
        people.push(await projectProfile(ctx, person));
      }
    }
    return people.sort((a, b) => a.name.localeCompare(b.name));
  },
});

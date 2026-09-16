import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { leaderboardMetric, leaderboardVisibility, rankScores } from '../shared/social/leaderboard';
import { publicProfile } from '../shared/social/contracts';
import { internal } from './_generated/api';
import { recordContributionScore } from './lib/leaderboard';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { findDeviceForUser } from './lib/auth';
import { activeProfile, requireProfile } from './lib/ownership';
import { acceptedRelationships, findBlock } from './lib/friendships';
import { projectProfile } from './lib/projections';

async function globalViewer(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const device = await findDeviceForUser(ctx, userId);
  if (device?.banned) throw new ConvexError({ code: 'device_banned' });
  if (!device?.accountId || !await ctx.db.get(device.accountId)) return null;
  const profile = await ctx.db.query('profiles').withIndex('by_accountId', (q) => q.eq('accountId', device.accountId!)).unique();
  return profile?.active && !profile.removal ? profile : null;
}

export const preference = query({ args: {}, returns: leaderboardVisibility, handler: async (ctx) => (await requireProfile(ctx)).profile.leaderboardVisibility ?? 'off' });
export const setPreference = mutation({ args: { visibility: leaderboardVisibility }, returns: v.null(), handler: async (ctx, { visibility }) => {
  const { profile } = await requireProfile(ctx);
  await ctx.db.patch(profile._id, { leaderboardVisibility: visibility, updatedAt: Date.now() }); return null;
} });
export const list = query({
  args: { metric: leaderboardMetric, audience: v.union(v.literal('friends'), v.literal('global')), period: v.union(v.literal('month'), v.literal('all')) },
  returns: v.object({ visibility: leaderboardVisibility, rows: v.array(v.object({ profile: publicProfile, score: v.number(), rank: v.number() })) }),
  handler: async (ctx, args) => {
    const viewer = args.audience === 'friends' ? (await requireProfile(ctx)).profile : await globalViewer(ctx);
    const visibility = viewer?.leaderboardVisibility ?? 'off';
    const period = args.period === 'all' ? 'all' : new Date().toISOString().slice(0, 7);
    const edges = args.audience === 'friends' && viewer ? await acceptedRelationships(ctx, viewer._id) : [];
    // The global board reads at most the first 1000 opted-in profiles so it keeps answering as participation grows.
    const candidates = args.audience === 'global'
      ? await ctx.db.query('profiles').withIndex('by_leaderboard', (q) => q.eq('leaderboardVisibility', 'global')).take(1000)
      : viewer ? (await Promise.all([viewer._id, ...edges.map((edge) => edge.firstProfileId === viewer._id ? edge.secondProfileId : edge.firstProfileId)].map((id) => activeProfile(ctx, id)))).filter((row) => row !== null) : [];
    const rows = [];
    for (const person of candidates) {
      if (!person.active || person.removal || !person.leaderboardVisibility || person.leaderboardVisibility === 'off' || !await ctx.db.get(person.accountId)) continue;
      if (viewer && ((await findBlock(ctx, viewer._id, person._id))?.active || (await findBlock(ctx, person._id, viewer._id))?.active)) continue;
      const score = await ctx.db.query('leaderboardScores').withIndex('by_account_metric_period', (q) => q.eq('accountId', person.accountId).eq('metric', args.metric).eq('period', period)).unique();
      rows.push({ profile: await projectProfile(ctx, person), score: score?.score ?? 0, name: person.name, username: person.username });
    }
    return { visibility, rows: rankScores(rows).map(({ profile, score, rank }) => ({ profile, score, rank })) };
  },
});

export const claimContributions = internalMutation({
  args: { deviceId: v.id('devices'), accountId: v.id('accounts'), cursor: v.union(v.string(), v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (device?.accountId !== args.accountId) return null;
    const page = await ctx.db.query('contributions').withIndex('by_device_status', (q) => q.eq('deviceId', args.deviceId).eq('status', 'tentative')).paginate({ cursor: args.cursor, numItems: 20 });
    for (const row of page.page) if (row.indexedObjectId && row.acceptedAt) await recordContributionScore(ctx, row, row.indexedObjectId, row.acceptedAt);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.leaderboards.claimContributions, { ...args, cursor: page.continueCursor });
    return null;
  },
});

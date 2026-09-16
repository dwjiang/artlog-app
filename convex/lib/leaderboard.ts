import type { Id, Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { JournalOwner } from '../../shared/journal/contracts';

async function increment(ctx: MutationCtx, accountId: Id<'accounts'>, metric: 'visits' | 'contributions', day: string, amount: number) {
  for (const period of ['all', day.slice(0, 7)]) {
    const score = await ctx.db.query('leaderboardScores').withIndex('by_account_metric_period', (q) => q.eq('accountId', accountId).eq('metric', metric).eq('period', period)).unique();
    if (score) await ctx.db.patch(score._id, { score: Math.max(0, score.score + amount) });
    else if (amount > 0) await ctx.db.insert('leaderboardScores', { accountId, metric, period, score: amount });
  }
}
export async function recordVisitScore(ctx: MutationCtx, owner: JournalOwner, venueId: Id<'museums'>, day: string, previousDay?: string) {
  if (owner.kind !== 'account' || day === previousDay) return;
  const onDay = (date: string) => ctx.db.query('visits').withIndex('by_owner_venue_history', (q) => q.eq('owner', owner).eq('venueId', venueId).eq('visitedOn', date)).take(2);
  if (previousDay && !(await onDay(previousDay)).length) await increment(ctx, owner.accountId, 'visits', previousDay, -1);
  if ((await onDay(day)).length === 1) await increment(ctx, owner.accountId, 'visits', day, 1);
}
export async function recordContributionScore(ctx: MutationCtx, row: Doc<'contributions'>, objectId: Id<'objects'>, acceptedAt: number) {
  const device = await ctx.db.get(row.deviceId);
  if (!device?.accountId) return;
  const accountId = device.accountId;
  if (row.creditedAccountId && row.creditedAccountId !== accountId) return;
  if (!row.creditedAccountId) await ctx.db.patch(row._id, { creditedAccountId: accountId });
  const prior = await ctx.db.query('leaderboardCredits').withIndex('by_account_object', (q) => q.eq('accountId', accountId).eq('objectId', objectId)).unique();
  if (prior) return;
  await ctx.db.insert('leaderboardCredits', { accountId, objectId, acceptedAt });
  await increment(ctx, accountId, 'contributions', new Date(acceptedAt).toISOString().slice(0, 10), 1);
}

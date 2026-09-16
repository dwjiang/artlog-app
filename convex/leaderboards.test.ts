import { expect, it } from 'vitest';
import { api } from './_generated/api';
import { harness } from './test.helpers';
import { socialUser, befriend } from './lib/socialTestFixtures';
import { seedMuseum, seedArtworkWithObject, seedContribution } from './lib/testFactories';
import { recordContributionScore } from './lib/leaderboard';
import { publishContribution } from './lib/tentativeEntries';
import { rankScores } from '../shared/social/leaderboard';

it('ranks equal totals together, skips following positions, and sorts ties by name', () => {
  expect(rankScores([{ score: 4, name: 'Zoe', username: 'z' }, { score: 8, name: 'Ada', username: 'a' }, { score: 4, name: 'Ben', username: 'b' }, { score: 1, name: 'Cam', username: 'c' }]).map(({ name, rank }) => [name, rank])).toEqual([['Ada', 1], ['Ben', 2], ['Zoe', 2], ['Cam', 4]]);
});
it('keeps participation off by default and enforces friends, global, and block visibility', async () => {
  const t = harness(), a = await socialUser(t, 'Ada'), b = await socialUser(t, 'Ben'), c = await socialUser(t, 'Cam');
  const query = { metric: 'visits' as const, period: 'all' as const, audience: 'friends' as const };
  expect(await a.as.query(api.leaderboards.preference, {})).toBe('off');
  await befriend(a, b);
  await b.as.mutation(api.leaderboards.setPreference, { visibility: 'friends' });
  await c.as.mutation(api.leaderboards.setPreference, { visibility: 'global' });
  expect((await a.as.query(api.leaderboards.list, query)).rows.map((row) => row.profile.name)).toEqual(['Ben']);
  expect((await a.as.query(api.leaderboards.list, { ...query, audience: 'global' })).rows.map((row) => row.profile.name)).toEqual(['Cam']);
  await a.as.mutation(api.friendships.block, { profileId: b.profileId, revision: 2, blockRevision: 0 });
  expect((await a.as.query(api.leaderboards.list, query)).rows).toEqual([]);
});
it('deduplicates museum days and moves backdated totals to the visit’s month', async () => {
  const t = harness(), a = await socialUser(t, 'Ada'), venueId = await t.run(seedMuseum);
  await a.as.mutation(api.leaderboards.setPreference, { visibility: 'global' });
  const month = new Date().toISOString().slice(0, 7), day = `${month}-01`;
  const first = { localId: crypto.randomUUID(), venueId, visitedOn: day, timeZone: 'UTC', reflection: 'PRIVATE reflection' };
  const second = { ...first, localId: crypto.randomUUID() };
  const upsert = (visit: typeof first) => a.as.mutation(api.visits.upsertJournal, { scope: a.scope, visit });
  await upsert(first); await upsert(second); await upsert(first);
  const query = { metric: 'visits' as const, period: 'month' as const, audience: 'global' as const };
  const board = await a.as.query(api.leaderboards.list, query);
  expect(board.rows[0].score).toBe(1);
  expect(JSON.stringify(board)).not.toMatch(/PRIVATE|venueId|visitedOn/);
  await upsert({ ...first, visitedOn: '2020-01-01' });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(1);
  expect((await a.as.query(api.leaderboards.list, { ...query, period: 'all' })).rows[0].score).toBe(2);
  await upsert({ ...second, visitedOn: '2020-01-01' });
  expect((await a.as.query(api.leaderboards.list, query)).rows[0].score).toBe(0);
  expect((await a.as.query(api.leaderboards.list, { ...query, period: 'all' })).rows[0].score).toBe(1);
});
it('credits each accepted physical artwork once, using acceptance time', async () => {
  const t = harness(), a = await socialUser(t, 'Ada');
  await a.as.mutation(api.leaderboards.setPreference, { visibility: 'global' });
  await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx), { objectId } = await seedArtworkWithObject(ctx);
    const id = await seedContribution(ctx, { deviceId: a.deviceId, venueId, status: 'tentative' });
    const row = (await ctx.db.get(id))!;
    await recordContributionScore(ctx, row, objectId, Date.now());
    await recordContributionScore(ctx, row, objectId, Date.now());
  });
  expect((await a.as.query(api.leaderboards.list, { audience: 'global', period: 'month', metric: 'contributions' })).rows[0].score).toBe(1);
});
it('credits a shared tentative entry when it is published', async () => {
  const t = harness(), a = await socialUser(t, 'Ada');
  await a.as.mutation(api.leaderboards.setPreference, { visibility: 'global' });
  const acceptedAt = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const cropStorageId = await ctx.storage.store(new Blob(['crop'], { type: 'image/jpeg' }));
    const id = await seedContribution(ctx, { deviceId: a.deviceId, venueId, cropStorageId });
    await publishContribution(ctx, (await ctx.db.get(id))!);
    return (await ctx.db.get(id))!.acceptedAt;
  });
  expect(acceptedAt).toEqual(expect.any(Number));
  expect((await a.as.query(api.leaderboards.list, { audience: 'global', period: 'all', metric: 'contributions' })).rows[0].score).toBe(1);
});

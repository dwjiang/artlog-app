import { expect, it } from 'vitest';
import { api } from './_generated/api';
import { seedDevice, seedMuseum } from './lib/testFactories';
import { harness } from './test.helpers';

async function fixture() {
  const t = harness(), user = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const visit = { localId: crypto.randomUUID(), venueId, visitedOn: '2026-09-01', timeZone: 'America/Los_Angeles', startedAt: Date.parse('2026-09-01T20:00:00Z') };
  const upsert = (overrides = {}) => user.as.mutation(api.visits.upsertJournal, { scope: user.scope, visit: { ...visit, ...overrides } });
  return { t, user, visit, upsert };
}
it('preserves capture dates, real times, empty visits, and UUID idempotence', async () => {
  const { t, visit, upsert } = await fixture();
  const first = await upsert();
  expect(await upsert()).toEqual(first);
  const endedAt = visit.startedAt + 60_000;
  expect(await upsert({ endedAt })).toMatchObject({ _id: first._id, visitedOn: visit.visitedOn, startedAt: visit.startedAt, endedAt });
  const second = await upsert({ localId: crypto.randomUUID() });
  expect(second._id).not.toBe(first._id);
  expect(await t.run((ctx) => ctx.db.query('visits').collect())).toHaveLength(2);
  expect(await t.run((ctx) => ctx.db.query('collections').collect())).toEqual([]);
});
it('supports a manual visit without inventing timestamps', async () => {
  const { upsert } = await fixture();
  const row = await upsert({ startedAt: undefined });
  expect(row).not.toHaveProperty('startedAt');
});
it.each([{ localId: '' }, { visitedOn: '2026-02-30' }, { visitedOn: '2999-01-01' }, { timeZone: 'Invented/Zone' }, { endedAt: 1 }, { reflection: 'x'.repeat(20_001) }, { startedAt: NaN }])('validates visit input %j', async (invalid) => {
  const { upsert } = await fixture();
  await expect(upsert(invalid)).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
});
it('isolates owners and prevents changing the venue of an existing visit', async () => {
  const { t, user, visit, upsert } = await fixture();
  const first = await upsert();
  const other = await seedDevice(t);
  const second = await other.as.mutation(api.visits.upsertJournal, { scope: other.scope, visit });
  expect(second._id).not.toBe(first._id);
  await expect(other.as.mutation(api.visits.upsertJournal, { scope: user.scope, visit })).rejects.toMatchObject({ data: { code: 'sync_scope_changed' } });
  const venueId = await t.run(seedMuseum);
  await expect(upsert({ venueId })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
});

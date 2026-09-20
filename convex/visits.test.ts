import { expect, it } from 'vitest';
import { api } from './_generated/api';
import { seedDevice, seedMuseum } from './lib/testFactories';
import { harness } from './test.helpers';

async function fixture() {
  const t = harness(), user = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const visit = { visibility: 'public' as const, localId: crypto.randomUUID(), venueId, visitedOn: '2026-09-01', timeZone: 'America/Los_Angeles', startedAt: Date.parse('2026-09-01T20:00:00Z') };
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
it('pages history by calendar date and UUID, including empty repeats and museum filters', async () => {
  const { t, user, visit } = await fixture();
  const secondVenue = await t.run(seedMuseum);
  const ids = Array.from({ length: 23 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  await user.as.mutation(api.sync.syncJournal, { scope: user.scope, since: 0, saves: [], visits: ids.map((localId) => ({ ...visit, localId, startedAt: undefined })) });
  await user.as.mutation(api.visits.upsertJournal, { scope: user.scope, visit: { ...visit, localId: crypto.randomUUID(), venueId: secondVenue, visitedOn: '2026-08-01', startedAt: undefined } });
  const first = await user.as.query(api.visits.history, { scope: user.scope, venueId: visit.venueId });
  expect(first.page.map((row) => row.localId)).toEqual(ids.toReversed().slice(0, 20));
  const last = await user.as.query(api.visits.history, { scope: user.scope, venueId: visit.venueId, cursor: first.cursor });
  expect(last.page.map((row) => row.localId)).toEqual(ids.toReversed().slice(20));
  expect(last).toMatchObject({ cursor: null, isDone: true });
  await expect(user.as.query(api.visits.history, { scope: user.scope, limit: 51 })).rejects.toMatchObject({ data: { code: 'invalid_pagination' } });
});
it('hides foreign detail and membership and keeps a visit after its last save is removed', async () => {
  const { t, user, visit, upsert } = await fixture();
  await upsert();
  const other = await seedDevice(t);
  for (const localId of [visit.localId, crypto.randomUUID()]) {
    await expect(other.as.query(api.visits.detail, { scope: other.scope, localId })).rejects.toMatchObject({ data: { code: 'not_found' } });
    await expect(other.as.query(api.visits.savedWorks, { scope: other.scope, localId })).rejects.toMatchObject({ data: { code: 'not_found' } });
  }
  const saves = Array.from({ length: 3 }, () => ({ localId: crypto.randomUUID(), venueId: visit.venueId, visitLocalId: visit.localId, savedAt: 1, snapshot: { title: 'Painting', artist: 'Artist' } }));
  await user.as.mutation(api.sync.syncJournal, { scope: user.scope, since: 0, visits: [], saves });
  const page = await user.as.query(api.visits.savedWorks, { scope: user.scope, localId: visit.localId, limit: 2 });
  const last = await user.as.query(api.visits.savedWorks, { scope: user.scope, localId: visit.localId, limit: 2, cursor: page.cursor });
  expect([...page.page, ...last.page].map((row) => row.localId).sort()).toEqual(saves.map((row) => row.localId).sort());
  for (const save of saves) await user.as.mutation(api.collections.remove, { scope: user.scope, localId: save.localId });
  expect((await user.as.query(api.visits.savedWorks, { scope: user.scope, localId: visit.localId })).page).toEqual([]);
  expect(await user.as.query(api.visits.detail, { scope: user.scope, localId: visit.localId })).toMatchObject({ localId: visit.localId });
});

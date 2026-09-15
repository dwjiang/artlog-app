import type { Id } from '../../../convex/_generated/dataModel';
import { db } from '../client';
import { visits } from '../schema';
import * as repo from './visits';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));
const venueId = 'museum-1' as Id<'museums'>;
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const visit = { localId: first, venueId, venueName: 'Museum', visitedOn: '2024-02-29', timeZone: 'UTC' };
beforeEach(async () => { await db.delete(visits); });

it('preserves empty, manual and repeat visits and retries the same UUID', async () => {
  await repo.upsertVisit(visit); await repo.upsertVisit(visit);
  await repo.upsertVisit({ ...visit, localId: second });
  expect((await repo.listVisits()).map((v) => v.localId)).toEqual([second, first]);
  expect(await repo.getVisit(first)).toMatchObject({ startedAt: null, endedAt: null, revision: 0 });
});
it.each([{ localId: 'invalid' }, { visitedOn: '2023-02-29' }, { visitedOn: '2999-01-01' },
  { timeZone: 'Unknown/City' }, { reflection: 'x'.repeat(20_001) }, { startedAt: 1 }, { endedAt: 1 }])('rejects invalid creates before persistence: %j', async (fields) => {
  await expect(repo.upsertVisit({ ...visit, ...fields })).rejects.toThrow('invalid_visit');
  expect(await repo.listVisits()).toEqual([]);
});
it('validates merged patches, allows reflection clearing and refuses foreign targets', async () => {
  await repo.upsertVisit({ ...visit, reflection: 'private', startedAt: Date.parse('2024-02-29T12:00Z') });
  await expect(repo.patchVisit(first, { visitedOn: '2024-02-28' })).rejects.toThrow('invalid_visit');
  await expect(repo.patchVisit(first, { reflection: '' }, 'account:other')).rejects.toThrow('not_found');
  await repo.patchVisit(first, { reflection: null });
  expect(await repo.getVisit(first)).toMatchObject({ visitedOn: '2024-02-29', reflection: null });
  await expect(repo.upsertVisit({ ...visit, venueId: 'other' as never })).rejects.toThrow('invalid_visit');
});
it('keeps edits made during sync pending until their own revision is acknowledged', async () => {
  await repo.upsertVisit(visit);
  await repo.patchVisit(first, { reflection: 'newer' });
  await repo.markVisitsSynced([{ localId: first, revision: 0, visitId: 'remote' as never, updatedAt: 10, updatedBy: 'device' as never }]);
  expect(await repo.getVisit(first)).toMatchObject({ reflection: 'newer', syncedAt: null, remoteVisitId: 'remote' });
});
it('accepts a remote visit the server stamped after this device crossed local midnight', async () => {
  jest.useFakeTimers().setSystemTime(Date.parse('2024-02-29T23:59:50Z'));
  try {
    await repo.upsertVisitsFromRemote([{ _id: 'remote' as never, _creationTime: 1, owner: { kind: 'device', deviceId: 'device' as never },
      localId: first, venueId, venueName: 'Museum', visitedOn: '2024-03-01', timeZone: 'UTC',
      updatedAt: Date.parse('2024-03-01T00:00:10Z'), updatedBy: 'device' as never, changeVersion: 1 }]);
    expect(await repo.getVisit(first)).toMatchObject({ visitedOn: '2024-03-01', remoteVisitId: 'remote' });
  } finally {
    jest.useRealTimers();
  }
});

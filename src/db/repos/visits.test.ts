import type { Id } from '../../../convex/_generated/dataModel';
import * as repo from './visits';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));

const venueId = 'museum-1' as Id<'museums'>;

it('upserts visits by local id and lists them newest first', async () => {
  await repo.upsertVisit({ visitedOn: '2026-09-01', timeZone: 'UTC', localId: 'v1', venueId, venueName: 'de Young', startedAt: 100 });
  await repo.upsertVisit({ visitedOn: '2026-09-01', timeZone: 'UTC', localId: 'v2', venueId, venueName: 'Legion of Honor', startedAt: 200 });
  await repo.upsertVisit({ visitedOn: '2026-09-01', timeZone: 'UTC', localId: 'v1', venueId, venueName: 'de Young', startedAt: 100, endedAt: 150, remoteVisitId: 'remote-1' as Id<'visits'> });
  expect((await repo.listVisits()).map((visit) => visit.localId)).toEqual(['v2', 'v1']);
  expect(await repo.getVisit('v1')).toMatchObject({ venueName: 'de Young', endedAt: 150, remoteVisitId: 'remote-1' });
  expect(await repo.getVisit('v2')).toMatchObject({ endedAt: null, remoteVisitId: null });
  expect(await repo.getVisit('missing')).toBeUndefined();
});

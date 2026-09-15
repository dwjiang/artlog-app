import { prepareCaptureVisit } from './capture-visit';
import { getVisit, patchVisit, upsertVisit } from '../../db/repos/visits';
import { db } from '../../db/client';
import { visits } from '../../db/schema';
import { initializeOwner, switchOwner } from '../account/owner-store';
import { calendarDate } from '../../../shared/journal/limits';
jest.mock('../../db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
const venueId = 'museum' as never;
const localId = '00000000-0000-4000-8000-000000000001';
const capturedAt = Date.parse('2024-02-29T20:00Z');
async function startVisit(startedAt: number, timeZone = 'America/New_York') {
  await upsertVisit({ localId, venueId, venueName: 'Museum', timeZone, visitedOn: calendarDate(startedAt, timeZone), startedAt });
  return { venueId, visitLocalId: localId };
}
beforeEach(async () => { await db.delete(visits); initializeOwner('test-installation'); });
it('passes venue-only and empty contexts through without starting a visit', async () => {
  expect(await prepareCaptureVisit({ venueId }, capturedAt)).toEqual({ venueId });
  expect(await prepareCaptureVisit({}, capturedAt)).toEqual({});
  expect(await db.select().from(visits)).toEqual([]);
  await expect(prepareCaptureVisit({ venueId }, -1)).rejects.toThrow('Invalid capture date');
});
it('preserves an explicit ended visit for delayed captures and rejects foreign or mismatched associations', async () => {
  const original = await startVisit(capturedAt);
  await patchVisit(localId, { endedAt: capturedAt + 60_000 });
  expect(await prepareCaptureVisit(original, capturedAt + 120_000)).toEqual(original);
  expect(await getVisit(localId)).toMatchObject({ startedAt: capturedAt, endedAt: capturedAt + 60_000 });
  await expect(prepareCaptureVisit({ ...original, venueId: 'other' as never }, capturedAt)).rejects.toThrow('invalid visit');
  await expect(prepareCaptureVisit({ ...original, visitId: 'remote' as never }, capturedAt)).rejects.toThrow('invalid visit');
  await expect(prepareCaptureVisit({ venueId, visitLocalId: 'missing' }, capturedAt)).rejects.toThrow('invalid visit');
  switchOwner('account:other');
  await expect(prepareCaptureVisit(original, capturedAt)).rejects.toThrow('invalid visit');
});
it('uses the shutter date when location resolution crosses local midnight', async () => {
  const after = Date.parse('2024-03-10T05:00:01Z'), before = after - 2000;
  const context = await startVisit(after);
  expect(await getVisit(localId)).toMatchObject({ visitedOn: '2024-03-10' });
  expect(await prepareCaptureVisit(context, before)).toEqual(context);
  expect(await getVisit(localId)).toMatchObject({ visitedOn: '2024-03-09', startedAt: before });
});
it('does not add timestamps to an explicitly associated manual visit', async () => {
  await upsertVisit({ localId, venueId, venueName: 'Museum', visitedOn: '2024-02-29', timeZone: 'UTC' });
  await prepareCaptureVisit({ venueId, visitLocalId: localId }, capturedAt);
  expect(await getVisit(localId)).toMatchObject({ startedAt: null, endedAt: null });
});

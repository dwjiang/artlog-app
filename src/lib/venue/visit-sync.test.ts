import { getVisit, upsertVisit, markVisitsSynced } from '@/db/repos/visits';
import { db } from '@/db/client';
import { visits } from '@/db/schema';
import { resolveScanVisit } from './visit-sync';
import { initializeOwner, switchOwner } from '@/lib/account/owner-store';
import { isTransientError, SyncUnavailableError } from '@/lib/network-error';
import { ConvexError } from 'convex/values';

const mockFlush = jest.fn();
jest.mock('@/lib/account/collection-sync', () => ({ flushJournal: () => mockFlush() }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
const venueId = 'museum' as never;
beforeEach(async () => { await db.delete(visits); initializeOwner('test-installation'); mockFlush.mockReset(); });
it('synchronizes the original offline visit even after it ended and another visit started', async () => {
  await upsertVisit({ localId: 'old', venueId, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC', startedAt: 1, endedAt: 2 });
  mockFlush.mockImplementation(async () => { await markVisitsSynced([{ localId: 'old', visitId: 'remote' as never, revision: 0, updatedAt: 3, updatedBy: 'device' as never }]); });
  expect(await resolveScanVisit('old', venueId)).toBe('remote');
  expect(await getVisit('old')).toMatchObject({ startedAt: 1, endedAt: 2 });
});
it('rejects missing and mismatched visits before sending anything', async () => {
  await expect(resolveScanVisit('missing', venueId)).rejects.toThrow('invalid visit'); expect(mockFlush).not.toHaveBeenCalled();
});
it('discards an in-flight result after an account switch', async () => {
  await upsertVisit({ localId: 'old', venueId, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  mockFlush.mockImplementation(async () => { switchOwner('account:other'); });
  await expect(resolveScanVisit('old', venueId)).rejects.toThrow('owner changed');
});
it.each([new ConvexError({ code: 'rate_limited' }), new SyncUnavailableError()])('propagates the sync failure %s so the flusher does not count an attempt', async (failure) => {
  await upsertVisit({ localId: 'old', venueId, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  mockFlush.mockRejectedValue(failure);
  const error = await resolveScanVisit('old', venueId).catch((cause: unknown) => cause);
  expect(error).toBe(failure); expect(isTransientError(error)).toBe(true);
});

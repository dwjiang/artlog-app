import type { Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/client';
import { visits } from '@/db/schema';
import { getVisit, patchVisit, upsertVisit } from '@/db/repos/visits';
import { createVisitSync, resolveScanVisit, syncVisits } from './visit-sync';

const mockMutation = jest.fn();
jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock('../../../convex/_generated/api', () => ({ api: { visits: { startVisit: 'start', endVisit: 'end' } } }));

const venueId = 'museum-1' as Id<'museums'>;

beforeEach(async () => {
  await db.delete(visits);
  mockMutation.mockReset();
  mockMutation.mockImplementation(async (ref, args) => ref === 'start' ? { visitId: `remote-${args.localVisitId}` } : null);
});

it('finishes an ended visit before starting a subsequent visit to the same museum', async () => {
  await upsertVisit({ localId: 'old', venueId, venueName: 'Met', startedAt: 10, endedAt: 20 });
  await upsertVisit({ localId: 'new', venueId, venueName: 'Met', startedAt: 30 });
  await createVisitSync()();
  expect(mockMutation.mock.calls).toEqual([
    ['start', { venueId, localVisitId: 'old' }],
    ['end', { visitId: 'remote-old' }],
    ['start', { venueId, localVisitId: 'new' }],
  ]);
  expect(await getVisit('old')).toMatchObject({ remoteVisitId: 'remote-old', endSyncedAt: expect.any(Number) });
  expect(await getVisit('new')).toMatchObject({ remoteVisitId: 'remote-new', endedAt: null });
});

it('remembers an unsent ending across a restart and skips already synchronized visits', async () => {
  await upsertVisit({ localId: 'done', venueId, venueName: 'Met', startedAt: 10, endedAt: 20, remoteVisitId: 'remote-done' as Id<'visits'>, endSyncedAt: 25 });
  await upsertVisit({ localId: 'new', venueId, venueName: 'Met', startedAt: 30, endedAt: 40, remoteVisitId: 'remote-new' as Id<'visits'> });
  mockMutation.mockRejectedValueOnce(new Error('session not ready'));
  await expect(createVisitSync()()).rejects.toThrow('session not ready');
  expect(await getVisit('new')).toMatchObject({ endSyncedAt: null });
  mockMutation.mockClear();
  await createVisitSync()();
  expect(mockMutation.mock.calls).toEqual([['end', { visitId: 'remote-new' }]]);
  expect(await getVisit('new')).toMatchObject({ endSyncedAt: expect.any(Number) });
});

it('closes a visit that ended while its start request was pending without duplicating starts', async () => {
  await upsertVisit({ localId: 'pending', venueId, venueName: 'Met', startedAt: 50 });
  let finish!: (result: { visitId: string }) => void;
  mockMutation.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const sync = createVisitSync();
  const first = sync();
  await Promise.resolve();
  await patchVisit('pending', { endedAt: 60 });
  const second = sync();
  finish({ visitId: 'remote-pending' });
  await Promise.all([first, second]);
  expect(mockMutation.mock.calls).toEqual([
    ['start', { venueId, localVisitId: 'pending' }], ['end', { visitId: 'remote-pending' }],
  ]);
  expect(await getVisit('pending')).toMatchObject({ endedAt: 60, endSyncedAt: expect.any(Number) });
});

it('resolves the original visit of an offline capture after it has ended and another visit starts', async () => {
  await upsertVisit({ localId: 'old', venueId, venueName: 'Met', startedAt: 10, endedAt: 20 });
  await upsertVisit({ localId: 'new', venueId, venueName: 'Met', startedAt: 30 });
  const [remote] = await Promise.all([resolveScanVisit('old', venueId), syncVisits()]);
  expect(remote).toBe('remote-old');
  expect(mockMutation.mock.calls).toEqual([
    ['start', { venueId, localVisitId: 'old' }], ['end', { visitId: 'remote-old' }],
    ['start', { venueId, localVisitId: 'new' }],
  ]);
  mockMutation.mockClear();
  expect(await resolveScanVisit('old', venueId)).toBe('remote-old');
  expect(mockMutation).not.toHaveBeenCalled();
});

it('propagates a failed visit start so a capture can retry instead of losing its visit', async () => {
  await upsertVisit({ localId: 'pending', venueId, venueName: 'Met', startedAt: 10 });
  const offline = new TypeError('Network request failed');
  mockMutation.mockRejectedValueOnce(offline);
  await expect(resolveScanVisit('pending', venueId)).rejects.toBe(offline);
  expect(await resolveScanVisit('pending', venueId)).toBe('remote-pending');
});

it('rejects a missing visit or a visit from another venue before syncing', async () => {
  await upsertVisit({ localId: 'other', venueId: 'museum-2' as Id<'museums'>, venueName: 'Other', startedAt: 10 });
  await expect(resolveScanVisit('missing', venueId)).rejects.toThrow('invalid visit');
  await expect(resolveScanVisit('other', venueId)).rejects.toThrow('invalid visit');
  expect(mockMutation).not.toHaveBeenCalled();
});

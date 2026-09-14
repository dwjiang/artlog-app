import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/client';
import * as saves from '@/db/repos/saved-works';
import * as visits from '@/db/repos/visits';
import { notes, pendingScans, savedWorks, visits as visitTable } from '@/db/schema';
import { getLocalOwner } from './owner-store';
import { syncJournal, type SyncContext, type SyncDependencies } from './sync';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
const context: SyncContext = { scope: 'scope', owner: getLocalOwner(), deviceId: 'a' as Id<'devices'>, accountId: null };
const remoteVisit: Doc<'visits'> = { _id: 'visit' as never, _creationTime: 1, owner: { kind: 'device', deviceId: context.deviceId },
  localId: 'remote-visit', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC',
  updatedAt: 2, updatedBy: context.deviceId, changeVersion: 1 };
const remote: Doc<'collections'> = {
  _id: 'remote-1' as Id<'collections'>, _creationTime: 1, owner: remoteVisit.owner, changeVersion: 2,
  localId: 'remote-work', visitId: remoteVisit._id, visitLocalId: remoteVisit.localId, venueId: remoteVisit.venueId,
  snapshot: { title: 'Remote work', artist: 'Artist' }, savedAt: 1, updatedAt: 2, updatedBy: context.deviceId,
};
let checkpoint: string | undefined;
let deps: SyncDependencies;
const api = jest.fn<ReturnType<SyncDependencies['sync']>, Parameters<SyncDependencies['sync']>>();
const empty = { acceptedVisits: [], acceptedSaves: [], visits: [], saves: [], checkpoint: 20, hasMore: false };
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks); await db.delete(pendingScans); await db.delete(visitTable);
  checkpoint = undefined; api.mockReset();
  deps = { ...saves, ...visits, getCheckpoint: async () => checkpoint, setCheckpoint: async (value) => { checkpoint = value; }, sync: api };
  api.mockImplementation(async (args) => ({ ...empty,
    acceptedVisits: args.visits.map(({ localId }) => ({ localId, visitId: 'visit' as never, updatedAt: 20, updatedBy: context.deviceId })),
    acceptedSaves: args.saves.map(({ localId }) => ({ localId, updatedAt: 20, updatedBy: context.deviceId })),
  }));
});
it('pushes scoped snapshots, applies parents before saves, acknowledges and checkpoints', async () => {
  await saves.insertSavedWork({ localId: 'local', title: 'Local', artist: '', savedAt: 1, photoPath: 'photo.jpg' });
  api.mockResolvedValueOnce({ ...empty, acceptedSaves: [{ localId: 'local', updatedAt: 20, updatedBy: context.deviceId }], visits: [remoteVisit], saves: [remote] });
  await syncJournal(deps, context);
  expect(api.mock.calls[0][0].saves[0]).toMatchObject({ localId: 'local', snapshot: { title: 'Local' } });
  expect(api.mock.calls[0][0].saves[0]).not.toHaveProperty('photoPath');
  expect(await saves.listUnsynced()).toEqual([]);
  expect(await saves.getSavedWork(remote.localId)).toMatchObject({ visitLocalId: remoteVisit.localId });
  expect(checkpoint).toBe('20');
});
it('leaves edits pending and checkpoints unchanged on network or local-write failures', async () => {
  await saves.insertSavedWork({ localId: 'local', title: 'Local', artist: '', savedAt: 1 });
  api.mockRejectedValueOnce(new Error('offline'));
  await expect(syncJournal(deps, context)).rejects.toThrow('offline');
  expect(await saves.listUnsynced()).toHaveLength(1); expect(checkpoint).toBeUndefined();
  api.mockResolvedValueOnce({ ...empty, visits: [remoteVisit], saves: [remote] });
  deps.upsertVisitsFromRemote = async () => { throw new Error('SQLITE_BUSY'); };
  await expect(syncJournal(deps, context)).rejects.toThrow('SQLITE_BUSY'); expect(checkpoint).toBeUndefined();
});
it('resumes at the last applied change after an interrupted pull', async () => {
  api.mockResolvedValueOnce({ ...empty, visits: [remoteVisit], checkpoint: 1, hasMore: true }).mockRejectedValueOnce(new Error('offline'));
  await expect(syncJournal(deps, context)).rejects.toThrow('offline'); expect(checkpoint).toBe('1');
  await syncJournal(deps, context); expect(api.mock.calls[2][0].since).toBe(1);
});
it('discards in-flight responses after account changes', async () => {
  let active = true;
  api.mockImplementationOnce(async () => { active = false; return { ...empty, visits: [remoteVisit], saves: [remote] }; });
  await syncJournal(deps, context, () => active);
  expect(await saves.listSavedWorks()).toEqual([]); expect(await visits.listVisits()).toEqual([]); expect(checkpoint).toBeUndefined();
});
it('sends empty visits before save batches and leaves hidden account work suspended', async () => {
  await visits.upsertVisit({ localId: 'empty', venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC' });
  await db.insert(savedWorks).values(Array.from({ length: 70 }, (_, i) => ({ owner: context.owner, localId: `local-${i}`, title: 'Painting', artist: '', savedAt: i })));
  await saves.insertSavedWork({ localId: 'hidden', title: 'Hidden', artist: '', savedAt: 0 }, 'account:hidden');
  await syncJournal(deps, context);
  expect(api.mock.calls.map(([args]) => args.visits.length + args.saves.length)).toEqual([50, 21]);
  expect(api.mock.calls[0][0].visits).toHaveLength(1);
  expect(await saves.listUnsynced()).toEqual([]); expect(await saves.listUnsynced('account:hidden')).toHaveLength(1);
});

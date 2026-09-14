import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/client';
import * as repo from '@/db/repos/saved-works';
import { notes, savedWorks } from '@/db/schema';
import { syncCollection, type SyncContext, type SyncDependencies } from './sync';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
const context: SyncContext = { scope: 'account:a,b', deviceId: 'a' as Id<'devices'>, accountId: 'account' as Id<'accounts'> };
const remote: Doc<'collections'> = {
  _id: 'remote-1' as Id<'collections'>, _creationTime: 1, deviceId: 'b' as Id<'devices'>,
  localId: 'remote-work', snapshot: { title: 'Remote work', artist: 'Artist' }, savedAt: 1, updatedAt: 2, updatedBy: 'b' as Id<'devices'>,
};
let checkpoint: string | undefined;
let deps: SyncDependencies;
const api = jest.fn<ReturnType<SyncDependencies['sync']>, Parameters<SyncDependencies['sync']>>();
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks);
  checkpoint = undefined; api.mockReset();
  deps = { ...repo, getCheckpoint: async () => checkpoint, setCheckpoint: async (value) => { checkpoint = value; }, sync: api };
  api.mockImplementation(async ({ push }) => ({
    accepted: push.map(({ localId }) => ({ localId, updatedAt: 20, updatedBy: context.deviceId })),
    pulled: [], serverTime: 20, cursor: null,
  }));
});

it('pushes local snapshots, pulls metadata without photos, acknowledges and checkpoints', async () => {
  await repo.insertSavedWork({ localId: 'local', title: 'Local work', artist: 'Artist', savedAt: 1, cropPath: 'crop.jpg', photoPath: 'photo.jpg' });
  api.mockResolvedValueOnce({ accepted: [{ localId: 'local', updatedAt: 20, updatedBy: context.deviceId }], pulled: [remote], serverTime: 20, cursor: null });
  await syncCollection(deps, context);
  const push = api.mock.calls[0][0].push[0];
  expect(push).toMatchObject({ localId: 'local', snapshot: { title: 'Local work' } });
  expect(push).not.toHaveProperty('photoPath'); expect(push).not.toHaveProperty('cropPath');
  expect(await repo.listUnsynced()).toEqual([]);
  expect(await repo.getSavedWork('remote-work')).toMatchObject({ photoPath: null, title: 'Remote work' });
  expect(JSON.parse(checkpoint!)).toMatchObject({ since: 20, scope: context.scope });
});

it('leaves local data pending and the checkpoint unchanged on network failure', async () => {
  await repo.insertSavedWork({ localId: 'local', title: 'Painting', artist: 'Artist', savedAt: 1 });
  api.mockRejectedValueOnce(new Error('offline'));
  await expect(syncCollection(deps, context)).rejects.toThrow('offline');
  expect(await repo.listUnsynced()).toHaveLength(1); expect(checkpoint).toBeUndefined();
});

it('stores an unfinished page cursor and resumes it after a failure without skipping older rows', async () => {
  const cursor = { deviceIndex: 1, page: 'page-two', until: 20, photos: false };
  api.mockResolvedValueOnce({ accepted: [], pulled: [remote], serverTime: 20, cursor }).mockRejectedValueOnce(new Error('offline'));
  await expect(syncCollection(deps, context)).rejects.toThrow('offline');
  expect(JSON.parse(checkpoint!)).toMatchObject({ since: 0, cursor });
  await syncCollection(deps, context);
  expect(api.mock.calls[2][0]).toMatchObject({ since: 0, cursor });
  expect(JSON.parse(checkpoint!)).toMatchObject({ since: 20 });
});

it('restarts the pull window when an older sibling joins the account', async () => {
  checkpoint = JSON.stringify({ ...context, since: 99, scope: 'old-membership' });
  await syncCollection(deps, context);
  expect(api.mock.calls[0][0].since).toBe(0);
});

it('does not apply an in-flight response after sign-out or an account switch', async () => {
  let active = true;
  api.mockImplementationOnce(async () => {
    active = false;
    return { accepted: [], pulled: [remote], serverTime: 20, cursor: null };
  });
  await syncCollection(deps, context, () => active);
  expect(await repo.listSavedWorks()).toEqual([]); expect(checkpoint).toBeUndefined();
});

it('does not acknowledge or checkpoint a failed local write', async () => {
  api.mockResolvedValueOnce({ accepted: [], pulled: [remote], serverTime: 20, cursor: null });
  deps.upsertFromRemote = async () => { throw new Error('SQLITE_BUSY'); };
  await expect(syncCollection(deps, context)).rejects.toThrow('SQLITE_BUSY');
  expect(checkpoint).toBeUndefined();
});

it('uploads more than one batch and leaves no saved works unsynced', async () => {
  await db.insert(savedWorks).values(Array.from({ length: 501 }, (_, index) => ({
    localId: `local-${index}`, title: 'Painting', artist: 'Artist', savedAt: index,
  })));
  await syncCollection(deps, context);
  expect(api.mock.calls.map(([args]) => args.push.length)).toEqual([500, 1]);
  expect(await repo.listUnsynced()).toEqual([]);
});

it('queues cached photos for their new owner when the authenticated device changes', async () => {
  checkpoint = JSON.stringify({ ...context, deviceId: 'old-device', since: 20 });
  await repo.insertSavedWork({ localId: 'local', title: 'Painting', artist: '', savedAt: 1,
    photoPath: 'photo.jpg', photoStorageId: 'previous-owner-file' as Id<'_storage'>, syncedAt: 10 });
  await syncCollection(deps, context);
  expect(await repo.getSavedWork('local')).toMatchObject({ photoPath: 'photo.jpg', photoStorageId: null });
  expect(api.mock.calls[0][0].push).toHaveLength(1);
});

import type { Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/client';
import * as repo from '@/db/repos/saved-works';
import { notes, savedWorks } from '@/db/schema';
import { syncCollectionPhotos, type PhotoSyncDependencies } from './photo-sync';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
let deps: PhotoSyncDependencies;
const upload = jest.fn(), download = jest.fn(), removeDownload = jest.fn();
const photoStorageId = 'cloud-photo' as Id<'_storage'>;
const cropStorageId = 'cloud-crop' as Id<'_storage'>;
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks);
  jest.clearAllMocks(); upload.mockReset(); download.mockReset();
  upload.mockImplementation(async (_localId, kind) => kind === 'photo' ? photoStorageId : cropStorageId);
  download.mockImplementation(async (localId, kind) => `collection-photos/${localId}-${kind}.jpg`);
  deps = { ...repo, upload, download, removeFile: removeDownload };
});

it('backs up both images independently of metadata sync and never uploads them again once acknowledged', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, syncedAt: 1, photoPath: 'photo.jpg', cropPath: 'crop.jpg' });
  await syncCollectionPhotos(deps);
  expect(upload.mock.calls).toEqual([['a', 'crop', 'crop.jpg'], ['a', 'photo', 'photo.jpg']]);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoStorageId, cropStorageId, photoPath: 'photo.jpg', syncedAt: 1 });
  await syncCollectionPhotos(deps);
  expect(upload).toHaveBeenCalledTimes(2);
});

it('retries a failed photo without re-uploading the completed crop or blocking another work', async () => {
  for (const localId of ['a', 'b']) await repo.insertSavedWork({ localId, title: 'Painting', artist: '', savedAt: 1, photoPath: `${localId}.jpg`, cropPath: 'crop.jpg' });
  upload.mockImplementation(async (localId, kind) => {
    if (localId === 'a' && kind === 'photo') throw new Error('offline');
    return kind === 'photo' ? photoStorageId : cropStorageId;
  });
  await expect(syncCollectionPhotos(deps)).rejects.toThrow('offline');
  expect(await repo.getSavedWork('b')).toMatchObject({ photoStorageId, cropStorageId });
  upload.mockClear(); upload.mockResolvedValue(photoStorageId);
  await syncCollectionPhotos(deps);
  expect(upload.mock.calls).toEqual([['a', 'photo', 'a.jpg']]);
});

it('downloads imported photos into persistent local paths and resumes a partial download', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, photoStorageId, cropStorageId });
  download.mockResolvedValueOnce('collection-photos/crop.jpg').mockRejectedValueOnce(new Error('offline'));
  await expect(syncCollectionPhotos(deps)).rejects.toThrow('offline');
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: 'collection-photos/crop.jpg', photoPath: null });
  download.mockClear();
  await syncCollectionPhotos(deps);
  expect(download.mock.calls).toEqual([['a', 'photo', photoStorageId]]);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: 'collection-photos/a-photo.jpg' });
  expect(upload).not.toHaveBeenCalled();
});

it('discards a download completed after sign-out without writing paths or starting another transfer', async () => {
  let active = true;
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, photoStorageId, cropStorageId });
  download.mockImplementationOnce(async () => { active = false; return 'collection-photos/discard.jpg'; });
  await syncCollectionPhotos(deps, () => active);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: null, cropPath: null });
  expect(removeDownload).toHaveBeenCalledWith('collection-photos/discard.jpg');
  expect(download).toHaveBeenCalledTimes(1);
});

it('does not restore a photo when its saved work is deleted during transfer', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, photoStorageId });
  download.mockImplementationOnce(async () => { await repo.softDeleteSavedWork('a'); return 'collection-photos/deleted.jpg'; });
  await syncCollectionPhotos(deps);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: null, deletedAt: expect.any(Number) });
  expect(removeDownload).toHaveBeenCalledWith('collection-photos/deleted.jpg');
});

it('does not acknowledge an upload across an account change', async () => {
  let active = true;
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, photoPath: 'photo.jpg' });
  upload.mockImplementationOnce(async () => { active = false; return photoStorageId; });
  await syncCollectionPhotos(deps, () => active);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoStorageId: null });
});

it('drains more than one batch of queued photos', async () => {
  await db.insert(savedWorks).values(Array.from({ length: 21 }, (_, i) => ({ owner: 'device:test-installation', localId: String(i), title: 'Painting', artist: '', savedAt: i, photoPath: `${i}.jpg` })));
  await syncCollectionPhotos(deps);
  expect(upload).toHaveBeenCalledTimes(21);
  expect(await repo.listPhotoTransfers()).toEqual([]);
});

it('cleans up deleted local photos while keeping a file used by another saved work', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1,
    photoPath: 'shared.jpg', cropPath: 'collection-photos/crop.jpg', deletedAt: 2 });
  await repo.insertSavedWork({ localId: 'b', title: 'Painting', artist: '', savedAt: 1,
    photoPath: 'shared.jpg', photoStorageId });
  await syncCollectionPhotos(deps);
  expect(removeDownload.mock.calls).toEqual([['collection-photos/crop.jpg']]);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: null, cropPath: null });
  expect(await repo.getSavedWork('b')).toMatchObject({ photoPath: 'shared.jpg' });
});

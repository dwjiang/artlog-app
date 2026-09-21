import type { Id } from '../../../convex/_generated/dataModel';
import { db } from '@/db/client';
import * as repo from '@/db/repos/saved-works';
import { notes, savedWorks } from '@/db/schema';
import { syncCollectionPhotos, type PhotoSyncDependencies } from './photo-sync';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
let deps: PhotoSyncDependencies;
const upload = jest.fn(), download = jest.fn(), removeDownload = jest.fn();
const cropStorageId = 'cloud-crop' as Id<'_storage'>;
beforeEach(async () => {
  await db.delete(notes); await db.delete(savedWorks);
  jest.clearAllMocks(); upload.mockReset(); download.mockReset();
  upload.mockImplementation(async () => ({ storageId: cropStorageId, photoUpdatedAt: 1 }));
  download.mockImplementation(async (localId, kind) => `collection-photos/${localId}-${kind}.jpg`);
  deps = { ...repo, upload, download, removeFile: removeDownload };
});

it('backs up only the crop independently of metadata sync and never uploads it again once acknowledged', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, syncedAt: 1, photoPath: 'photo.jpg', cropPath: 'crop.jpg' });
  await syncCollectionPhotos(deps);
  // The full photo is an album row, so it must not be uploaded a second time as the save's photo.
  expect(upload.mock.calls).toEqual([['a', 'crop', 'crop.jpg']]);
  expect(await repo.getSavedWork('a')).toMatchObject({ cropStorageId, photoPath: 'photo.jpg', syncedAt: 1 });
  await syncCollectionPhotos(deps);
  expect(upload).toHaveBeenCalledTimes(1);
});

it('retries a failed crop without blocking another work', async () => {
  for (const localId of ['a', 'b']) await repo.insertSavedWork({ localId, title: 'Painting', artist: '', savedAt: 1, photoPath: `${localId}.jpg`, cropPath: `${localId}-crop.jpg` });
  upload.mockImplementation(async (localId) => {
    if (localId === 'a') throw new Error('offline');
    return { storageId: cropStorageId, photoUpdatedAt: 1 };
  });
  await expect(syncCollectionPhotos(deps)).rejects.toThrow('offline');
  expect(await repo.getSavedWork('b')).toMatchObject({ cropStorageId });
  upload.mockClear(); upload.mockResolvedValue({ storageId: cropStorageId, photoUpdatedAt: 1 });
  await syncCollectionPhotos(deps);
  expect(upload.mock.calls).toEqual([['a', 'crop', 'a-crop.jpg']]);
});

it('downloads an imported crop into a persistent local path and retries after a failed download', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropStorageId });
  download.mockRejectedValueOnce(new Error('offline'));
  await expect(syncCollectionPhotos(deps)).rejects.toThrow('offline');
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: null, photoPath: null });
  download.mockClear();
  await syncCollectionPhotos(deps);
  expect(download.mock.calls).toEqual([['a', 'crop', cropStorageId]]);
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: 'collection-photos/a-crop.jpg', photoPath: null });
  expect(upload).not.toHaveBeenCalled();
});

it('discards a download completed after sign-out without writing paths or starting another transfer', async () => {
  let active = true;
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropStorageId });
  download.mockImplementationOnce(async () => { active = false; return 'collection-photos/discard.jpg'; });
  await syncCollectionPhotos(deps, () => active);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: null, cropPath: null });
  expect(removeDownload).toHaveBeenCalledWith('collection-photos/discard.jpg');
  expect(download).toHaveBeenCalledTimes(1);
});

it('does not restore a crop when its saved work is deleted during transfer', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropStorageId });
  download.mockImplementationOnce(async () => { await repo.softDeleteSavedWork('a'); return 'collection-photos/deleted.jpg'; });
  await syncCollectionPhotos(deps);
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: null, deletedAt: expect.any(Number) });
  expect(removeDownload).toHaveBeenCalledWith('collection-photos/deleted.jpg');
});

it('does not acknowledge an upload across an account change', async () => {
  let active = true;
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropPath: 'crop.jpg' });
  upload.mockImplementationOnce(async () => { active = false; return { storageId: cropStorageId, photoUpdatedAt: 1 }; });
  await syncCollectionPhotos(deps, () => active);
  expect(await repo.getSavedWork('a')).toMatchObject({ cropStorageId: null });
});

it('drains more than one batch of queued crops', async () => {
  await db.insert(savedWorks).values(Array.from({ length: 21 }, (_, i) => ({ owner: 'device:test-installation', localId: String(i), title: 'Painting', artist: '', savedAt: i, cropPath: `${i}.jpg` })));
  await syncCollectionPhotos(deps);
  expect(upload).toHaveBeenCalledTimes(21);
  expect(await repo.listPhotoTransfers()).toEqual([]);
});

it('cleans up deleted local photos while keeping a file used by another saved work', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1,
    photoPath: 'shared.jpg', cropPath: 'collection-photos/crop.jpg', deletedAt: 2 });
  await repo.insertSavedWork({ localId: 'b', title: 'Painting', artist: '', savedAt: 1,
    photoPath: 'shared.jpg' });
  await syncCollectionPhotos(deps);
  expect(removeDownload.mock.calls).toEqual([['collection-photos/crop.jpg']]);
  expect(await repo.getSavedWork('a')).toMatchObject({ photoPath: null, cropPath: null });
  expect(await repo.getSavedWork('b')).toMatchObject({ photoPath: 'shared.jpg' });
});

it('does not acknowledge an old upload over a crop edited during transfer', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropPath: 'old.jpg' });
  upload.mockImplementationOnce(async () => {
    repo.replaceSavedCrop('a', 'new.jpg');
    return { storageId: 'old-storage', photoUpdatedAt: 1 };
  });
  upload.mockResolvedValueOnce({ storageId: 'new-storage', photoUpdatedAt: 2 });
  await syncCollectionPhotos(deps);
  expect(upload.mock.calls).toEqual([['a', 'crop', 'old.jpg'], ['a', 'crop', 'new.jpg']]);
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: 'new.jpg', cropStorageId: 'new-storage', photoUpdatedAt: 2 });
});

it('discards an old download when the user edits the crop during transfer', async () => {
  await repo.insertSavedWork({ localId: 'a', title: 'Painting', artist: '', savedAt: 1, cropStorageId });
  download.mockImplementationOnce(async () => { repo.replaceSavedCrop('a', 'edited.jpg'); return 'obsolete.jpg'; });
  await syncCollectionPhotos(deps);
  expect(removeDownload).toHaveBeenCalledWith('obsolete.jpg');
  expect(await repo.getSavedWork('a')).toMatchObject({ cropPath: 'edited.jpg' });
});

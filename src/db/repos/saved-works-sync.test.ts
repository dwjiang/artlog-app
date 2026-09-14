import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { db } from '../client';
import { notes, savedWorks } from '../schema';
import { getNote, setNote } from './notes';
import * as repo from './saved-works';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));
const deviceId = 'this-device' as Id<'devices'>;
const remote: Doc<'collections'> = {
  _id: 'collection-1' as Id<'collections'>, _creationTime: 1, deviceId: 'sibling' as Id<'devices'>,
  localId: 'work', savedAt: 1, updatedAt: 10, updatedBy: 'sibling' as Id<'devices'>,
  snapshot: { title: 'Water Lilies', artist: 'Monet', institution: 'Museum' }, note: 'Seen together',
};
beforeEach(async () => { await db.delete(notes); await db.delete(savedWorks); });

it('imports metadata and notes without a photo, then deduplicates a replay', async () => {
  await repo.upsertFromRemote([remote]);
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toHaveLength(1);
  expect(await repo.getSavedWork('work')).toMatchObject({
    title: 'Water Lilies', institution: 'Museum', photoPath: null, cropPath: null, syncedAt: 10, syncedBy: 'sibling',
  });
  expect(await getNote('work')).toMatchObject({ text: 'Seen together' });
  expect(await repo.listUnsynced()).toEqual([]);
});

it('keeps an existing photo and immutable snapshot when remote metadata changes', async () => {
  await repo.insertSavedWork({ localId: 'work', title: 'Original', artist: 'Artist', savedAt: 1, photoPath: 'photo.jpg', cropPath: 'crop.jpg', syncedAt: 1 });
  await repo.upsertFromRemote([{ ...remote, deviceId }]);
  expect(await repo.getSavedWork('work')).toMatchObject({ title: 'Original', photoPath: 'photo.jpg', cropPath: 'crop.jpg', syncedAt: 10 });
});

it('keeps an in-flight note edit dirty even if the old upload is acknowledged', async () => {
  await repo.insertSavedWork({ localId: 'work', title: 'Painting', artist: 'Artist', savedAt: 1 });
  const [pending] = await repo.listUnsynced();
  await setNote('work', 'Newer note', 12);
  await repo.markSynced([{ localId: 'work', revision: pending.work.revision, updatedAt: 20, updatedBy: deviceId }]);
  await repo.upsertFromRemote([{ ...remote, deviceId }]);
  expect(await repo.listUnsynced()).toMatchObject([{ work: { localId: 'work', syncedAt: null, revision: 1 }, note: 'Newer note' }]);
});

it('queues deletion after sync and never resurrects a deleted row on remote replay', async () => {
  await repo.upsertFromRemote([remote]);
  await repo.softDeleteSavedWork('work', 12);
  const [pending] = await repo.listUnsynced();
  expect(pending.work.deletedAt).toBe(12);
  await repo.markSynced([{ localId: pending.work.localId, revision: pending.work.revision, updatedAt: 20, updatedBy: deviceId }]);
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toEqual([]);
});

it('preserves saved works, notes and photos when changing sync targets', async () => {
  await repo.upsertFromRemote([remote]);
  await repo.queueAllForSync();
  expect(await repo.listUnsynced()).toMatchObject([{ work: { title: 'Water Lilies', localId: 'work' }, note: 'Seen together' }]);
});

it('applies a server deletion when uploading a stale local note edit', async () => {
  await repo.upsertFromRemote([remote]);
  await setNote('work', 'Offline note');
  const [pending] = await repo.listUnsynced();
  await repo.markSynced([{ localId: pending.work.localId, revision: pending.work.revision, updatedAt: 20, updatedBy: deviceId, deletedAt: 15 }]);
  expect(await repo.listSavedWorks()).toEqual([]);
  expect(await repo.getSavedWork(pending.work.localId)).toMatchObject({ deletedAt: 15, syncedAt: 20 });
});

it('keeps one save when another device returns a copy of the same work', async () => {
  await repo.insertSavedWork({ localId: remote.localId, title: 'Original', artist: 'Artist', savedAt: 1, photoPath: 'photo.jpg', syncedAt: 1 });
  await repo.upsertFromRemote([remote]);
  expect(await repo.listSavedWorks()).toHaveLength(1);
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({ title: 'Original', photoPath: 'photo.jpg' });
});

it('does not replace a newer note with an older device copy on a later page', async () => {
  await repo.upsertFromRemote([{ ...remote, updatedAt: 30, note: 'New note' }]);
  await repo.upsertFromRemote([{ ...remote, updatedAt: 20, note: 'Old note' }]);
  const [saved] = await repo.listSavedWorks();
  expect(await getNote(saved.localId)).toMatchObject({ text: 'New note' });
});

it('applies remote deletion while a local note edit is pending', async () => {
  await repo.upsertFromRemote([remote]);
  const [saved] = await repo.listSavedWorks();
  await setNote(saved.localId, 'Offline edit');
  await repo.upsertFromRemote([{ ...remote, updatedAt: 20, deletedAt: 20 }]);
  expect(await repo.listSavedWorks()).toEqual([]);
  expect(await repo.listUnsynced()).toMatchObject([{ work: { deletedAt: 20 }, note: 'Offline edit' }]);
});

it.each([['a', 'z'], ['z', 'a']])('merges simultaneous edits consistently in %s then %s order', async (first, second) => {
  for (const author of [first, second]) {
    await repo.upsertFromRemote([{ ...remote, updatedBy: author as Id<'devices'>, note: author }]);
  }
  expect(await getNote(remote.localId)).toMatchObject({ text: 'z' });
});

it('does not move the confirmed version backward when an older upload response arrives', async () => {
  await repo.upsertFromRemote([{ ...remote, updatedAt: 30, note: 'Latest note' }]);
  await repo.markSynced([{ localId: remote.localId, revision: 0, updatedAt: 10, updatedBy: deviceId }]);
  await repo.upsertFromRemote([{ ...remote, updatedAt: 20, note: 'Older note' }]);
  expect(await getNote(remote.localId)).toMatchObject({ text: 'Latest note' });
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({ syncedAt: 30 });
});

it('accepts an image reference without replacing a newer local note or original photo', async () => {
  await repo.insertSavedWork({ localId: remote.localId, title: 'Painting', artist: '', savedAt: 1, photoPath: 'original.heic' });
  await setNote(remote.localId, 'Still uploading');
  const photoStorageId = 'cloud-photo' as Id<'_storage'>;
  await repo.upsertFromRemote([{ ...remote, photoStorageId }]);
  expect(await repo.getSavedWork(remote.localId)).toMatchObject({ photoPath: 'original.heic', photoStorageId, syncedAt: null });
  expect(await getNote(remote.localId)).toMatchObject({ text: 'Still uploading' });
});

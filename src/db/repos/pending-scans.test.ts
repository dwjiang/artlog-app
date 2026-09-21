import type { Id } from '../../../convex/_generated/dataModel';
import type { NewPendingScan } from '../schema';
import * as repo from './pending-scans';
import { clearDeletedAlbumPhotoPath, saveArtworkSession } from './artwork-album';
import { softDeleteSavedWork } from './saved-works';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));

const scanId = 'scan-1' as Id<'scans'>;

function row(localId: string, overrides: Partial<NewPendingScan> = {}): NewPendingScan {
  return {
    localId, photoPath: `photos/${localId}.jpg`, cropPath: `crops/${localId}.jpg`,
    vector: [0.12345, -0.5], descriptors: new Uint8Array([1, 2, 3]).buffer, keypoints: new Uint8Array([4, 5]).buffer,
    modelVersion: 'model-v1', attemptModelVersion: 'model-v1', capturedAt: 100, createdAt: 100, ...overrides,
  };
}

async function enqueueAll(...rows: NewPendingScan[]) {
  for (const entry of rows) await repo.enqueuePendingScan(entry);
}

it('stores features intact and lists queued rows oldest first', async () => {
  await enqueueAll(row('later', { capturedAt: 200 }), row('earlier', { capturedAt: 100 }));
  const flushable = await repo.listFlushable('model-v1');
  expect(flushable.map((entry) => entry.localId)).toEqual(['earlier', 'later']);
  const [earlier] = flushable;
  expect(earlier).toMatchObject({ status: 'queued', attempts: 0, lastError: null, scanId: null, vector: [0.12345, -0.5] });
  expect(earlier.descriptors).toBeInstanceOf(ArrayBuffer);
  expect([...new Uint8Array(earlier.descriptors)]).toEqual([1, 2, 3]);
  expect([...new Uint8Array(earlier.keypoints)]).toEqual([4, 5]);
  await repo.deletePendingScan('earlier');
  await repo.deletePendingScan('later');
});

it('walks a row from queued through identifying to identified', async () => {
  await enqueueAll(row('a'));
  await repo.markIdentifying('a');
  expect((await repo.getPendingScan('a'))?.status).toBe('identifying');
  expect(await repo.listFlushable('model-v1')).toEqual([]);
  expect((await repo.pendingScansQuery()).map((entry) => entry.localId)).toEqual(['a']);
  await repo.markIdentified('a', scanId);
  expect(await repo.getPendingScan('a')).toMatchObject({ status: 'identified', scanId, lastError: null });
  expect((await repo.getCaptureForScan(scanId))?.localId).toBe('a');
  expect((await repo.pendingScansQuery()).map((entry) => entry.localId)).toEqual(['a']);
  expect(await repo.listFlushable('model-v1')).toEqual([]);
  await repo.deletePendingScan('a');
});

it('keeps failed and waiting captures that already reference a server scan', async () => {
  await enqueueAll(row('waiting', { scanId }), row('failed', { status: 'failed', scanId }));
  expect((await repo.pendingScansQuery()).map((entry) => entry.localId)).toEqual(['waiting', 'failed']);
  await repo.deletePendingScan('waiting');
  await repo.deletePendingScan('failed');
});

it('shows recent unsaved captures newest first and keeps other owners out', async () => {
  await enqueueAll(row('recent-old'), row('recent-new', { capturedAt: 200, status: 'identified', scanId }));
  await repo.enqueuePendingScan(row('other-owner', { capturedAt: 300 }), 'device:other');
  expect((await repo.pendingScansQuery()).map((entry) => entry.localId)).toEqual(['recent-new', 'recent-old']);
  await repo.deletePendingScan('recent-old');
  await repo.deletePendingScan('recent-new');
  await repo.deletePendingScan('other-owner', 'device:other');
});

it('removes a saved capture from recent scans even after its artwork and album photo are deleted', async () => {
  const owner = 'device:test-installation';
  await enqueueAll(row('saved-capture'));
  saveArtworkSession('saved-work', { localId: 'saved-work', title: 'Study', artist: '', savedAt: 1, photoPath: 'photos/saved-capture.jpg', cropPath: 'crops/saved-capture.jpg' },
    [{ localId: 'saved-capture', savedLocalId: 'saved-work', path: 'photos/saved-capture.jpg', kind: 'full', capturedAt: 1 }], undefined, owner);
  expect(await repo.pendingScansQuery()).toEqual([]);
  await softDeleteSavedWork('saved-work', 2, owner);
  clearDeletedAlbumPhotoPath('saved-capture', owner);
  expect(await repo.pendingScansQuery()).toEqual([]);
  await repo.deletePendingScan('saved-capture');
});

it('counts attempts, gives up at the limit, and lets a manual retry start over', async () => {
  await enqueueAll(row('a'));
  expect(await repo.recordAttemptFailure('a', 'offline', { countAttempt: false })).toEqual({ status: 'queued', attempts: 0 });
  expect(await repo.getPendingScan('a')).toMatchObject({ status: 'queued', attempts: 0, lastError: 'offline' });
  for (let attempt = 1; attempt < repo.MAX_IDENTIFY_ATTEMPTS; attempt++) {
    expect(await repo.recordAttemptFailure('a', 'bad_features', { countAttempt: true })).toEqual({ status: 'queued', attempts: attempt });
  }
  expect(await repo.recordAttemptFailure('a', 'bad_features', { countAttempt: true }))
    .toEqual({ status: 'failed', attempts: repo.MAX_IDENTIFY_ATTEMPTS });
  expect(await repo.listFlushable('model-v1')).toEqual([]);
  expect((await repo.pendingScansQuery()).map((entry) => entry.status)).toEqual(['failed']);
  await repo.retryPendingScan('a');
  expect(await repo.getPendingScan('a')).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  await expect(repo.recordAttemptFailure('missing', 'x', { countAttempt: true })).resolves.toEqual({ status: 'failed', attempts: 0 });
  await repo.deletePendingScan('a');
});

it('gives failed rows another run after a model update', async () => {
  await enqueueAll(row('a'));
  await repo.markFailed('a', 'Update the app to identify.', scanId);
  expect(await repo.getPendingScan('a')).toMatchObject({ status: 'failed', lastError: 'Update the app to identify.', scanId });
  expect(await repo.listFlushable('model-v1')).toEqual([]);
  expect((await repo.listFlushable('model-v2')).map((entry) => entry.localId)).toEqual(['a']);
  await repo.updateFeatures('a', {
    vector: [1], descriptors: new Uint8Array([9]).buffer, keypoints: new Uint8Array([8]).buffer, modelVersion: 'model-v2',
  });
  const updated = await repo.getPendingScan('a');
  expect(updated).toMatchObject({ status: 'queued', attempts: 0, lastError: null, modelVersion: 'model-v2', vector: [1] });
  expect([...new Uint8Array(updated!.descriptors)]).toEqual([9]);
  await repo.deletePendingScan('a');
});

it('returns rows left identifying by a previous process to the queue', async () => {
  await enqueueAll(row('a'), row('b', { status: 'identified', scanId }));
  await repo.markIdentifying('a');
  await repo.requeueInterrupted();
  expect((await repo.getPendingScan('a'))?.status).toBe('queued');
  expect((await repo.getPendingScan('b'))?.status).toBe('identified');
  await repo.deletePendingScan('a');
  await repo.deletePendingScan('b');
});

it('replaces the pending label source and keeps it with the row for the flusher', async () => {
  await enqueueAll(row('a'));
  await repo.setLabelPhoto('a', 'labels/a.jpg');
  expect(await repo.getPendingScan('a')).toMatchObject({ labelPhotoPath: 'labels/a.jpg', qrUrl: null });
  await repo.setQrUrl('a', 'https://museum.example/qr/1');
  expect(await repo.getPendingScan('a')).toMatchObject({ labelPhotoPath: null, qrUrl: 'https://museum.example/qr/1' });
  await repo.deletePendingScan('a');
  expect(await repo.getPendingScan('a')).toBeUndefined();
});

it('keeps a replacement label when an older read completes', async () => {
  await enqueueAll(row('replacement', { status: 'identified', scanId }));
  await repo.setLabelPhoto('replacement', 'labels/first.jpg');
  await repo.setLabelPhoto('replacement', 'labels/second.jpg');
  await repo.clearPendingLabel('replacement', { labelPhotoPath: 'labels/first.jpg' });
  expect(await repo.listPendingLabels()).toEqual([expect.objectContaining({ localId: 'replacement', labelPhotoPath: 'labels/second.jpg' })]);
  await repo.clearPendingLabel('replacement', { labelPhotoPath: 'labels/second.jpg' });
  expect(await repo.listPendingLabels()).toEqual([]);
  await repo.deletePendingScan('replacement');
});

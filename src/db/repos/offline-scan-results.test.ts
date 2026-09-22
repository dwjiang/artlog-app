import type { NewPendingScan } from '../schema';
import { confidentScan } from '@/components/scan/result/__fixtures__/scan';
import { cacheOfflineResult, offlineResultQuery } from './offline-scan-results';
import { deletePendingScan, enqueuePendingScan, updateFeatures } from './pending-scans';
import { claimLocalJournal } from './journal-claim';

jest.mock('../client', () => ({ db: jest.requireActual('../test-db').createTestDatabase() }));
const capture: NewPendingScan = { localId: 'offline', photoPath: 'photos/offline.jpg', cropPath: 'crops/offline.jpg',
  vector: [1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), modelVersion: 'm', attemptModelVersion: 'm', capturedAt: 1, createdAt: 1 };

it('keeps cached results scoped to their owner and follows a claimed journal', async () => {
  await enqueuePendingScan(capture, 'device:offline');
  await cacheOfflineResult(capture.localId, confidentScan, 'device:offline');
  expect(await offlineResultQuery(capture.localId, 'account:someone-else')).toEqual([]);
  await claimLocalJournal('device:offline', 'account:offline', 'claim');
  expect(await offlineResultQuery(capture.localId, 'device:offline')).toEqual([]);
  expect((await offlineResultQuery(capture.localId, 'account:offline'))[0].result).toEqual(confidentScan);
  await deletePendingScan(capture.localId, 'account:offline');
  expect(await offlineResultQuery(capture.localId, 'account:offline')).toEqual([]);
});
it('discards a cached match when a new crop changes the recognition input', async () => {
  await enqueuePendingScan(capture);
  await cacheOfflineResult(capture.localId, confidentScan);
  await updateFeatures(capture.localId, { vector: [0], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), modelVersion: 'm' });
  expect(await offlineResultQuery(capture.localId)).toEqual([]);
});

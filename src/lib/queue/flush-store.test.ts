import { ConvexError } from 'convex/values';

import type { Id } from '../../../convex/_generated/dataModel';
import * as pending from '@/db/repos/pending-scans';
import type { NewPendingScan } from '@/db/schema';
import { createFlusher, type FlushDependencies } from './flush';

jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));

function capture(localId: string, modelVersion = 'v1'): NewPendingScan {
  return {
    localId, modelVersion, attemptModelVersion: modelVersion,
    photoPath: `photos/${localId}.jpg`, cropPath: `crops/${localId}.jpg`,
    vector: [1], descriptors: new ArrayBuffer(4), keypoints: new ArrayBuffer(4),
    capturedAt: Number(localId) || 1, createdAt: Date.now(),
  };
}

function dependencies(modelVersion = 'v1') {
  return {
    modelVersion,
    listFlushable: pending.listFlushable,
    markIdentifying: pending.markIdentifying,
    recordFailure: pending.recordAttemptFailure,
    resetAttemptsForModel: pending.resetAttemptsForModel,
    updateFeatures: pending.updateFeatures,
    recordResult: (localId, response) => pending.markIdentified(localId, response.scanId),
    isOnline: async () => true,
    runLabelFlow: async () => {},
    reembed: jest.fn(async () => ({ vector: [2], descriptors: new ArrayBuffer(4), keypoints: new ArrayBuffer(4) })),
    identify: jest.fn(async ({ localId }) => ({
      scanId: `scan-${localId}` as Id<'scans'>, localId, capturedAt: 1, status: 'identified' as const,
    })),
  } satisfies FlushDependencies;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(async () => {
  for (const row of await pending.pendingScansQuery()) await pending.deletePendingScan(row.localId);
  jest.useRealTimers();
});

it('drains a healthy offline batch through the device quota without spending capture attempts', async () => {
  for (let i = 0; i < 100; i++) await pending.enqueuePendingScan(capture(String(i)));
  const deps = dependencies();
  // Match identify's configured token bucket: capacity 20, refilling 60 tokens per minute.
  let tokens = 20;
  let lastRefill = Date.now();
  deps.identify.mockImplementation(async ({ localId }) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const now = Date.now();
    tokens = Math.min(20, tokens + (now - lastRefill) / 1000);
    lastRefill = now;
    if (tokens < 1) throw new ConvexError({ code: 'rate_limited', retryAfter: (1 - tokens) * 1000 });
    tokens--;
    return { scanId: `scan-${localId}` as Id<'scans'>, localId, capturedAt: 1, status: 'identified' };
  });
  const flusher = createFlusher(deps);
  const started = flusher.start();
  await jest.advanceTimersByTimeAsync(180_000);
  await started;
  flusher.stop();
  expect(await pending.pendingScansQuery()).toEqual([]);
  for (let i = 0; i < 100; i++) {
    expect(await pending.getPendingScan(String(i))).toMatchObject({ status: 'identified', attempts: 0 });
    await pending.deletePendingScan(String(i));
  }
});

it('keeps exhausted re-embeds paused across triggers and restarts until a manual retry', async () => {
  await pending.enqueuePendingScan(capture('old', 'v0'));
  const deps = dependencies();
  deps.reembed.mockRejectedValue(new Error('bad_input'));
  const flusher = createFlusher(deps);
  await flusher.start();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(await pending.getPendingScan('old')).toMatchObject({ status: 'failed', attempts: 5, modelVersion: 'v0' });
  for (let trigger = 0; trigger < 3; trigger++) await flusher.flush();
  flusher.stop();
  await pending.requeueInterrupted();
  const restarted = createFlusher(deps);
  await restarted.start();
  expect(deps.reembed).toHaveBeenCalledTimes(5);
  expect(await pending.listFlushable('v1')).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  await pending.retryPendingScan('old');
  await restarted.flush();
  expect(deps.reembed).toHaveBeenCalledTimes(6);
  expect(await pending.getPendingScan('old')).toMatchObject({ status: 'queued', attempts: 1 });
  restarted.stop();
});

it('gives an exhausted crop a fresh retry budget on each model update', async () => {
  await pending.enqueuePendingScan({ ...capture('old', 'v0'), status: 'failed', attempts: 5 });
  for (const modelVersion of ['v1', 'v2']) {
    const deps = dependencies(modelVersion);
    deps.reembed.mockRejectedValue(new Error('bad_input'));
    const flusher = createFlusher(deps);
    await flusher.start();
    expect(await pending.getPendingScan('old')).toMatchObject({ status: 'queued', attempts: 1, modelVersion: 'v0' });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(deps.reembed).toHaveBeenCalledTimes(5);
    expect(await pending.getPendingScan('old')).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await pending.listFlushable(modelVersion)).toEqual([]);
    flusher.stop();
  }
});

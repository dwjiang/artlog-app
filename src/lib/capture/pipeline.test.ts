import { ConvexError } from 'convex/values';

import { runCapture } from './pipeline';
import type { CaptureDependencies, CaptureInput, CapturePayload, IdentifyResponse } from './stages';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'capture-uuid') }));

const input: CaptureInput = {
  photoUri: 'file:///photo.jpg', quad: null, source: 'camera', capturedAt: 1234,
};
const options = { inputSize: 512, modelVersion: 'test-model' };
const response = {
  scanId: 'scan-id', localId: 'capture-uuid', capturedAt: 1234, status: 'identified',
} as IdentifyResponse;

function dependencies() {
  return {
    warper: { warpAndLetterbox: jest.fn(async () => ({ cropUri: 'file:///crop.jpg' })) },
    triage: { check: jest.fn(async () => ({ ok: true as const })) },
    embedder: { modelVersion: 'test-model', embed: jest.fn(async () => new Float32Array([0.1234567, -0.9876543])) },
    orb: { extract: jest.fn(async () => ({ descriptors: new ArrayBuffer(32), keypoints: new ArrayBuffer(16), count: 1 })) },
    identify: jest.fn(async (_payload: CapturePayload) => response),
    isOnline: jest.fn(() => true),
    store: {
      enqueue: jest.fn(async (_payload: CapturePayload, _status: 'queued' | 'identifying') => {}),
      recordResult: jest.fn(async (_localId: string, _response: IdentifyResponse) => {}),
      requeue: jest.fn(async (_localId: string, _error: string) => {}),
    },
  } satisfies CaptureDependencies;
}

beforeEach(() => { jest.spyOn(console, 'debug').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

it('warps, checks, embeds, extracts and stores the capture before sending rounded features', async () => {
  const deps = dependencies();
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({ kind: 'sent', scanId: 'scan-id', response });
  expect(deps.warper.warpAndLetterbox).toHaveBeenCalledWith(input.photoUri, null, 512);
  expect(deps.triage.check).toHaveBeenCalledWith('file:///crop.jpg');
  expect(deps.embedder.embed).toHaveBeenCalledWith('file:///crop.jpg');
  expect(deps.orb.extract).toHaveBeenCalledWith('file:///crop.jpg');
  const payload = expect.objectContaining({
    localId: 'capture-uuid', vector: [0.12346, -0.98765], modelVersion: 'test-model',
    capturedAt: 1234, photoUri: 'file:///photo.jpg', cropUri: 'file:///crop.jpg',
  });
  expect(deps.store.enqueue).toHaveBeenCalledWith(payload, 'identifying');
  expect(deps.identify).toHaveBeenCalledWith(payload);
  expect(deps.store.recordResult).toHaveBeenCalledWith('capture-uuid', response);
  const calls = [
    deps.warper.warpAndLetterbox, deps.triage.check, deps.embedder.embed, deps.orb.extract,
    deps.store.enqueue, deps.identify, deps.store.recordResult,
  ].map((fn) => fn.mock.invocationCallOrder[0]);
  expect(calls).toEqual([...calls].sort((a, b) => a - b));
  expect(deps.store.requeue).not.toHaveBeenCalled();
  expect(result.timings).toEqual({
    warp: expect.any(Number), triage: expect.any(Number), embed: expect.any(Number), orb: expect.any(Number),
    enqueue: expect.any(Number), identify: expect.any(Number), total: expect.any(Number),
  });
});

it.each(['blur', 'glare'] as const)('returns a retake for %s before extracting features', async (reason) => {
  const deps: CaptureDependencies = dependencies();
  deps.triage.check = jest.fn(async () => ({ ok: false, reason, message: 'Try again' }));
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({ kind: 'retake', reason, message: 'Try again', timings: { triage: expect.any(Number) } });
  expect(deps.embedder.embed).not.toHaveBeenCalled();
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.store.enqueue).not.toHaveBeenCalled();
});

it('queues the crop and binary features when offline', async () => {
  const deps = dependencies();
  deps.isOnline.mockReturnValue(false);
  const result = await runCapture(input, deps, options);
  expect(result).toMatchObject({ kind: 'queued', localId: 'capture-uuid', timings: { enqueue: expect.any(Number) } });
  expect(deps.store.enqueue).toHaveBeenCalledWith(expect.objectContaining({
    cropUri: 'file:///crop.jpg', descriptors: expect.any(ArrayBuffer), keypoints: expect.any(ArrayBuffer),
  }), 'queued');
  expect(deps.identify).not.toHaveBeenCalled();
  expect(deps.store.recordResult).not.toHaveBeenCalled();
});

it.each([
  new Error('Connection lost while action was in flight'),
  new Error('[CONVEX A(identify:identify)] Connection lost while action was in flight\n  Called by client'),
  new TypeError('Network request failed'),
  new TypeError('Failed to fetch'),
])('returns the stored capture to the queue after a transport failure: %s', async (error) => {
  const deps = dependencies();
  deps.identify.mockRejectedValue(error);
  expect(await runCapture(input, deps, options)).toMatchObject({ kind: 'queued', localId: 'capture-uuid' });
  expect(deps.store.enqueue).toHaveBeenCalledTimes(1);
  expect(deps.store.enqueue.mock.calls[0][0]).toBe(deps.identify.mock.calls[0][0]);
  expect(deps.store.requeue).toHaveBeenCalledWith('capture-uuid', error.message);
  expect(deps.embedder.embed).toHaveBeenCalledTimes(1);
});

it.each([
  [new ConvexError({ code: 'rate_limited' }), 'rate_limited'],
  [new Error('Invalid vector'), 'Invalid vector'],
  [new TypeError('Bad implementation'), 'Bad implementation'],
])('surfaces non-network failures but keeps the capture queued: %s', async (error, message) => {
  const deps = dependencies();
  deps.identify.mockRejectedValue(error);
  await expect(runCapture(input, deps, options)).rejects.toBe(error);
  expect(deps.store.requeue).toHaveBeenCalledWith('capture-uuid', message);
  expect(deps.store.recordResult).not.toHaveBeenCalled();
});

it('does not send or report queued if the store rejects the write', async () => {
  const deps = dependencies();
  deps.store.enqueue.mockRejectedValue(new Error('Disk full'));
  await expect(runCapture(input, deps, options)).rejects.toThrow('Disk full');
  expect(deps.identify).not.toHaveBeenCalled();
});

it('rejects a model mismatch before processing the photo', async () => {
  const deps = dependencies();
  deps.embedder.modelVersion = 'other-model';
  await expect(runCapture(input, deps, options)).rejects.toThrow('model version');
  expect(deps.warper.warpAndLetterbox).not.toHaveBeenCalled();
});

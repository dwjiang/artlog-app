import { errorMessage, isNetworkError } from '@/lib/network-error';
import { roundVector } from './features';
import { createCaptureId } from './ids';
import type { CaptureDependencies, CaptureInput, CaptureOptions, CapturePayload, CaptureResult, CaptureTimings } from './stages';

export async function runCapture(
  input: CaptureInput,
  deps: CaptureDependencies,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  if (deps.embedder.modelVersion !== opts.modelVersion) {
    throw new Error(`Capture model version mismatch: ${deps.embedder.modelVersion} != ${opts.modelVersion}`);
  }
  const started = performance.now();
  const timings: CaptureTimings = { total: 0 };
  async function timed<T>(stage: Exclude<keyof CaptureTimings, 'total'>, task: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await task();
    } finally {
      timings[stage] = performance.now() - start;
    }
  }

  try {
    const { cropUri } = await timed('warp', () => deps.warper.warpAndLetterbox(input.photoUri, input.quad, opts.inputSize));
    const triage = await timed('triage', () => deps.triage.check(cropUri));
    if (!triage.ok) return { kind: 'retake', reason: triage.reason, message: triage.message, timings };
    const embedding = await timed('embed', () => deps.embedder.embed(cropUri));
    const features = await timed('orb', () => deps.orb.extract(cropUri));
    const payload: CapturePayload = {
      localId: createCaptureId(),
      vector: roundVector(embedding),
      descriptors: features.descriptors,
      keypoints: features.keypoints,
      modelVersion: opts.modelVersion,
      venueId: input.venueId,
      visitId: input.visitId,
      visitLocalId: input.visitLocalId,
      capturedAt: input.capturedAt,
      photoUri: input.photoUri,
      cropUri,
    };
    const online = deps.isOnline();
    const identifyNow = online && (!payload.visitLocalId || !!payload.visitId);
    await timed('enqueue', () => deps.store.enqueue(payload, identifyNow ? 'identifying' : 'queued'));
    if (identifyNow) {
      try {
        const response = await timed('identify', () => deps.identify(payload));
        await deps.store.recordResult(payload.localId, response);
        return { kind: 'sent', scanId: response.scanId, response, timings };
      } catch (error) {
        await deps.store.requeue(payload.localId, errorMessage(error));
        if (!isNetworkError(error)) throw error;
      }
    }
    return { kind: 'queued', localId: payload.localId, timings };
  } finally {
    timings.total = performance.now() - started;
    if (__DEV__) console.debug('Capture timings (ms)', { source: input.source, ...timings });
  }
}

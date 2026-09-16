import { randomUUID } from 'expo-crypto';

import { captureOwner } from '@/lib/account/owner-store';
import { errorMessage, isNetworkError } from '@/lib/network-error';
import { roundVector } from './features';
import type { CaptureDependencies, CaptureInput, CaptureOptions, CapturePayload, CaptureResult, CaptureTimings } from './stages';

export async function runCapture(
  input: CaptureInput,
  deps: CaptureDependencies,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  if (deps.embedder.modelVersion !== opts.modelVersion) {
    throw new Error(`Capture model version mismatch: ${deps.embedder.modelVersion} != ${opts.modelVersion}`);
  }
  const current = captureOwner();
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
    const prepared = await timed('warp', () => deps.warper.warpAndLetterbox(input.photoUri, input.quad, opts.inputSize));
    if (!prepared) return {
      kind: 'retake', reason: 'boundary', timings,
      message: input.source === 'library'
        ? 'Choose a photo that shows the whole painting, including all four corners.'
        : 'Fit the whole painting in view, including all four corners, and hold steady.',
    };
    const { cropUri } = prepared;
    // Label OCR reports readability; pale label backgrounds would trip the artwork glare threshold.
    if (input.subject !== 'label') {
      const triage = await timed('triage', () => deps.triage.check(cropUri));
      if (!triage.ok) return { kind: 'retake', reason: triage.reason, message: triage.message, timings };
    }
    const presentationReady = Promise.resolve().then(() => deps.onPrepared?.(prepared)).catch(() => {});
    const embedding = await timed('embed', () => deps.embedder.embed(cropUri));
    const features = await timed('orb', () => deps.orb.extract(cropUri));
    const payload: CapturePayload = {
      owner: current.owner, scope: current.scope, localId: randomUUID(),
      vector: roundVector(embedding),
      descriptors: features.descriptors,
      keypoints: features.keypoints,
      modelVersion: opts.modelVersion,
      venueId: input.venueId,
      visitId: input.visitId,
      visitLocalId: input.visitLocalId,
      capturedAt: input.capturedAt,
      ...(input.subject ? { subject: input.subject } : {}),
      photoUri: input.photoUri,
      cropUri,
    };
    if (!current.isOwnerCurrent()) throw new Error('Journal owner changed');
    const online = deps.isOnline() && !!current.scope && current.isCurrent();
    const identifyNow = input.subject !== 'label' && online && (!payload.visitLocalId || !!payload.visitId);
    await presentationReady;
    if (!current.isOwnerCurrent()) throw new Error('Journal owner changed');
    await timed('enqueue', () => deps.store.enqueue(payload, identifyNow ? 'identifying' : 'queued'));
    if (identifyNow) {
      try {
        const response = await timed('identify', () => deps.identify(payload));
        if (!current.isCurrent()) return { kind: 'queued', localId: payload.localId, timings };
        await deps.store.recordResult(payload.localId, response, current.owner);
        return { kind: 'sent', scanId: response.scanId, response, timings };
      } catch (error) {
        await deps.store.requeue(payload.localId, errorMessage(error), current.owner);
        if (!isNetworkError(error)) throw error;
      }
    }
    return { kind: 'queued', localId: payload.localId, timings };
  } finally {
    timings.total = performance.now() - started;
    if (__DEV__) console.debug('Capture timings (ms)', { source: input.source, ...timings });
  }
}

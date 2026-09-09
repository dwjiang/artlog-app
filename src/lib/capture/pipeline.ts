import { ConvexError } from 'convex/values';

import { createCaptureId } from './ids';
import type { CaptureDependencies, CaptureInput, CaptureOptions, CapturePayload, CaptureResult, CaptureTimings } from './stages';

function isNetworkError(error: unknown): boolean {
  if (error instanceof ConvexError || !(error instanceof Error)) return false;
  return /^(Network request failed|Failed to fetch|Load failed)$/i.test(error.message) ||
    /^(?:\[CONVEX A\([^\n]+\)\] )?Connection lost while action was in flight(?:\n  Called by client)?$/.test(error.message);
}

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
      vector: Array.from(embedding, (value) => Number(value.toFixed(5))),
      descriptors: features.descriptors,
      keypoints: features.keypoints,
      modelVersion: opts.modelVersion,
      venueId: input.venueId,
      visitId: input.visitId,
      capturedAt: input.capturedAt,
      cropUri,
    };
    if (deps.isOnline()) {
      try {
        const response = await timed('identify', () => deps.identify(payload));
        return { kind: 'sent', scanId: response.scanId, response, timings };
      } catch (error) {
        if (!isNetworkError(error)) throw error;
      }
    }
    await timed('enqueue', () => deps.enqueue(payload));
    return { kind: 'queued', localId: payload.localId, timings };
  } finally {
    timings.total = performance.now() - started;
    if (__DEV__) console.debug('Capture timings (ms)', { source: input.source, ...timings });
  }
}

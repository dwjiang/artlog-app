import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { AppState } from 'react-native';

import model from '../../../shared/model-version.json';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import * as pending from '@/db/repos/pending-scans';
import { extractFeatures, orb } from '@/lib/capture/features';
import type { CaptureStore, IdentifyResponse } from '@/lib/capture/stages';
import { convex } from '@/lib/convex-client';
import { embedder } from '@/lib/embed/embedder';
import { captureFileUri, persistCapture } from '@/lib/files/photos';
import { createFlusher } from './flush';

/** `unsupported_version` stays with its crop so the updated app can re-embed it locally (design §5.4). */
export async function recordResult(localId: string, response: IdentifyResponse): Promise<void> {
  if (response.status === 'unsupported_version') {
    await pending.markFailed(localId, response.error ?? 'Update the app to identify.', response.scanId);
  } else {
    await pending.markIdentified(localId, response.scanId);
  }
}

export const captureStore: CaptureStore = {
  async enqueue(payload, status) {
    const files = await persistCapture({ localId: payload.localId, photoUri: payload.photoUri, cropUri: payload.cropUri });
    await pending.enqueuePendingScan({
      localId: payload.localId, ...files,
      vector: payload.vector, descriptors: payload.descriptors, keypoints: payload.keypoints,
      modelVersion: payload.modelVersion, attemptModelVersion: payload.modelVersion,
      venueId: payload.venueId, visitId: payload.visitId,
      capturedAt: payload.capturedAt, status, createdAt: Date.now(),
    });
    if (status === 'queued') void flushQueue();
  },
  recordResult,
  async requeue(localId, error) {
    await pending.recordAttemptFailure(localId, error, { countAttempt: false });
    void flushQueue();
  },
};

async function labelFlowPending(scanId: Id<'scans'>, label: { labelPhotoUri?: string; qrUrl?: string }): Promise<void> {
  console.warn('Label flow pending plan 05.03; the label stays on the row', { scanId, ...label });
}

const flusher = createFlusher({
  listFlushable: pending.listFlushable,
  markIdentifying: pending.markIdentifying,
  recordResult,
  recordFailure: pending.recordAttemptFailure,
  resetAttemptsForModel: pending.resetAttemptsForModel,
  updateFeatures: pending.updateFeatures,
  identify: (args) => convex.action(api.identify.identify, args),
  runLabelFlow: (scanId, label) => labelFlowPending(scanId, {
    labelPhotoUri: label.labelPhotoPath ? captureFileUri(label.labelPhotoPath) : undefined,
    qrUrl: label.qrUrl,
  }),
  reembed: (cropPath) => extractFeatures(captureFileUri(cropPath), { embedder, orb }),
  isOnline: async () => (await getNetworkStateAsync()).isInternetReachable !== false,
  modelVersion: model.modelVersion,
});

export const flushQueue = flusher.flush;
let recovery: Promise<void> | undefined;

export async function retryPendingScan(localId: string): Promise<void> {
  await pending.retryPendingScan(localId);
  await flushQueue();
}

/** Flushes now, on reconnect and on foreground; the flusher's own backoff covers failures in between. */
export function startQueueFlusher(): () => void {
  let active = true;
  // Only a process restart interrupts these rows; auth changes may still have a request in flight.
  recovery ??= pending.requeueInterrupted()
    .catch((error: unknown) => console.warn('Could not requeue interrupted scans', error));
  void recovery.then(() => { if (active) return flusher.start(); });
  const network = addNetworkStateListener((state) => {
    if (state.isInternetReachable ?? state.isConnected) void flushQueue();
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushQueue();
  });
  return () => {
    active = false;
    network.remove();
    appState.remove();
    flusher.stop();
  };
}

import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { AppState } from 'react-native';

import model from '../../../shared/model-version.json';

import { api } from '../../../convex/_generated/api';
import * as pending from '@/db/repos/pending-scans';
import { extractFeatures, orb } from '@/lib/capture/features';
import type { CaptureStore, IdentifyResponse } from '@/lib/capture/stages';
import { convex } from '@/lib/convex-client';
import { embedder } from '@/lib/embed/embedder';
import { captureFileUri, persistCapture } from '@/lib/files/photos';
import { runLabelFlowForScan } from '@/lib/label/label-deps';
import { LabelFlowError } from '@/lib/label/flow';
import { removeFile } from '@/lib/label/crop';
import { resolveScanVisit } from '@/lib/venue/visit-sync';
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
      visitLocalId: payload.visitLocalId,
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

const flusher = createFlusher({
  listFlushable: pending.listFlushable,
  listPendingLabels: pending.listPendingLabels,
  recordLabelFailure: pending.recordLabelFailure,
  clearPendingLabel: async (localId, label) => {
    await pending.clearPendingLabel(localId, label);
    if (label.labelPhotoPath) removeFile(captureFileUri(label.labelPhotoPath));
  },
  markIdentifying: pending.markIdentifying,
  recordResult,
  recordFailure: pending.recordAttemptFailure,
  resetAttemptsForModel: pending.resetAttemptsForModel,
  updateFeatures: pending.updateFeatures,
  resolveVisitId: resolveScanVisit,
  identify: (args) => convex.action(api.identify.identify, args),
  runLabelFlow: async (scanId, label) => {
    try {
      await runLabelFlowForScan(scanId, {
        labelPhotoUri: label.labelPhotoPath ? captureFileUri(label.labelPhotoPath) : undefined,
        qrUrl: label.qrUrl,
      });
    } catch (error) {
      // Preserve transport/quota errors for the worker's retry policy.
      throw error instanceof LabelFlowError ? error.cause ?? new Error(error.code) : error;
    }
  },
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

export async function retryPendingLabel(localId: string): Promise<void> {
  await pending.retryPendingLabel(localId);
  await flushQueue();
}

export async function discardPendingLabel(localId: string): Promise<void> {
  const row = await pending.getPendingScan(localId);
  if (!row) return;
  await pending.clearPendingLabel(localId, {
    labelPhotoPath: row.labelPhotoPath ?? undefined, qrUrl: row.qrUrl ?? undefined,
  });
  if (row.labelPhotoPath) removeFile(captureFileUri(row.labelPhotoPath));
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

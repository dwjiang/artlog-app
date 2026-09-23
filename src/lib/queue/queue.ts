import { reportError } from "@/lib/observability";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";

import { captureOwner, getLocalOwner } from "@/lib/account/owner-store";
import model from "../../../shared/model/model-version.json";

import { api } from "../../../convex/_generated/api";
import * as pending from "@/db/repos/pending-scans";
import { isLabelCapture } from "@/lib/capture/photo-draft";
import { extractFeatures, orb } from "@/lib/capture/features";
import type { CaptureStore, IdentifyResponse } from "@/lib/capture/stages";
import { convex } from "@/lib/convex-client";
import { embedder } from "@/lib/embed/embedder";
import { captureFileUri, persistCapture, scanPreviewPath } from "@/lib/files/photos";
import { runLabelFlowForScan } from "@/lib/label/label-deps";
import { LabelFlowError } from "@/lib/label/flow";
import { removeFile } from "@/lib/label/crop";
import { resolveScanVisit } from "@/lib/venue/visit-sync";
import { createFlusher } from "./flush";

/** `unsupported_version` stays with its crop so the updated app can re-embed it locally. */
export async function recordResult(
  localId: string,
  response: IdentifyResponse,
  owner = getLocalOwner(),
): Promise<void> {
  if (response.status === "unsupported_version") {
    await pending.markFailed(
      localId,
      response.error ?? "Update the app to identify.",
      response.scanId,
      owner,
    );
  } else {
    await pending.markIdentified(localId, response.scanId, owner);
  }
}

export const captureStore: CaptureStore = {
  async enqueue(payload, status) {
    const current = captureOwner();
    if (payload.owner !== current.owner) throw new Error("Journal owner changed");
    const files = await persistCapture({
      localId: payload.localId,
      photoUri: payload.photoUri,
      cropUri: payload.cropUri,
      contentBounds: payload.contentBounds,
    });
    if (!current.isOwnerCurrent()) {
      removeFile(captureFileUri(files.photoPath));
      removeFile(captureFileUri(files.cropPath));
      removeFile(captureFileUri(scanPreviewPath(files.cropPath)));
      throw new Error("Journal owner changed");
    }
    await pending.enqueuePendingScan(
      {
        localId: payload.localId,
        ...files,
        vector: payload.vector,
        descriptors: payload.descriptors,
        keypoints: payload.keypoints,
        modelVersion: payload.modelVersion,
        attemptModelVersion: payload.modelVersion,
        venueId: payload.venueId,
        visitId: payload.visitId,
        visitLocalId: payload.visitLocalId,
        capturedAt: payload.capturedAt,
        status,
        createdAt: Date.now(),
      },
      payload.owner,
    );
    if (status === "queued") void flushQueue();
  },
  recordResult,
  async requeue(localId, error, owner = getLocalOwner()) {
    await pending.recordAttemptFailure(localId, error, { countAttempt: false }, owner);
    void flushQueue();
  },
};

function makeFlusher() {
  const current = captureOwner();
  const owner = current.owner;
  return createFlusher({
    isCurrent: current.isCurrent,
    isLabelCapture,
    listFlushable: (version) => pending.listFlushable(version, owner),
    listPendingLabels: () => pending.listPendingLabels(owner),
    recordLabelFailure: (id, error, options) =>
      pending.recordLabelFailure(id, error, options, owner),
    clearPendingLabel: async (localId, label) => {
      await pending.clearPendingLabel(localId, label, owner);
      if (label.labelPhotoPath) removeFile(captureFileUri(label.labelPhotoPath));
    },
    markIdentifying: (id) => pending.markIdentifying(id, owner),
    recordResult: (id, response) => recordResult(id, response, owner),
    recordFailure: (id, error, options) => pending.recordAttemptFailure(id, error, options, owner),
    resetAttemptsForModel: (id, version) => pending.resetAttemptsForModel(id, version, owner),
    updateFeatures: (id, features) => pending.updateFeatures(id, features, owner),
    resolveVisitId: resolveScanVisit,
    identify: (args) => {
      if (!current.isCurrent() || !current.scope) throw new Error("Journal owner changed");
      return convex.action(api.identify.identify, { ...args, scope: current.scope });
    },
    runLabelFlow: async (scanId, label) => {
      try {
        await runLabelFlowForScan(scanId, {
          labelPhotoUri: label.labelPhotoPath ? captureFileUri(label.labelPhotoPath) : undefined,
          qrUrl: label.qrUrl,
        });
      } catch (error) {
        // Preserve transport/quota errors for the worker's retry policy.
        throw error instanceof LabelFlowError ? (error.cause ?? new Error(error.code)) : error;
      }
    },
    reembed: (cropPath) => extractFeatures(captureFileUri(cropPath), { embedder, orb }),
    isOnline: async () =>
      current.isCurrent() &&
      !!current.scope &&
      (await getNetworkStateAsync()).isInternetReachable !== false,
    modelVersion: model.modelVersion,
  });
}
let flusher: ReturnType<typeof createFlusher> | undefined;
export const flushQueue = () => flusher?.flush() ?? Promise.resolve();

export async function retryPendingScan(localId: string): Promise<void> {
  await pending.retryPendingScan(localId);
  await flushQueue();
}

export async function retryPendingLabel(localId: string): Promise<void> {
  await pending.retryPendingLabel(localId);
  await flushQueue();
}

export async function discardPendingLabel(localId: string): Promise<void> {
  const owner = getLocalOwner();
  const row = await pending.getPendingScan(localId, owner);
  if (!row) return;
  await pending.clearPendingLabel(
    localId,
    {
      labelPhotoPath: row.labelPhotoPath ?? undefined,
      qrUrl: row.qrUrl ?? undefined,
    },
    owner,
  );
  if (row.labelPhotoPath) removeFile(captureFileUri(row.labelPhotoPath));
}

/** Flushes now, on reconnect and on foreground; the flusher's own backoff covers failures in between. */
export function startQueueFlusher(): () => void {
  let active = true;
  const currentFlusher = makeFlusher();
  flusher = currentFlusher;
  const recovery = pending.requeueInterrupted().catch((error: unknown) => {
    reportError(error, "queue.recover");
    console.warn("Could not requeue interrupted scans", error);
  });
  void recovery.then(() => {
    if (active) return currentFlusher.start();
  });
  const network = addNetworkStateListener((state) => {
    if (state.isInternetReachable ?? state.isConnected) void flushQueue();
  });
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") void flushQueue();
  });
  return () => {
    active = false;
    network.remove();
    appState.remove();
    currentFlusher.stop();
    if (flusher === currentFlusher) flusher = undefined;
  };
}

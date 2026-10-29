import { randomUUID } from "expo-crypto";

import { captureOwner } from "@/lib/account/owner-store";
import { removeFileIfExists } from "@/lib/files/remove-file";
import { errorMessage, isNetworkError, isTransientError } from "@/lib/network-error";
import { reportError, addBreadcrumb } from "@/lib/observability";
import { TimeoutError, withTimeout } from "@/lib/with-timeout";

import { chooseCrop } from "./crop-choice";
import type {
  CaptureDependencies,
  CaptureInput,
  CaptureOptions,
  CapturePayload,
  CaptureResult,
  CaptureTimings,
  VenueContext,
} from "./stages";

/** A visit sync slower than this sends the scan to the queue; the flusher finishes it. */
export const VISIT_SYNC_TIMEOUT_MS = 4000;

export async function runCapture(
  input: CaptureInput,
  deps: CaptureDependencies,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  if (deps.embedder.modelVersion !== opts.modelVersion) {
    throw new Error(`Capture model version mismatch: ${deps.embedder.modelVersion} != ${opts.modelVersion}`);
  }
  const current = captureOwner();
  function checkCurrent() {
    if (deps.isCurrent?.() === false) throw new Error("Capture cancelled");
    if (!current.isOwnerCurrent()) throw new Error("Journal owner changed");
  }
  let preparedCropUri: string | undefined;
  let persisting = false;
  const started = performance.now();
  const timings: CaptureTimings = { total: 0 };
  async function timed<T>(stage: Exclude<keyof CaptureTimings, "total">, task: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await task();
    } finally {
      timings[stage] = performance.now() - start;
    }
  }

  const context = input.context ?? Promise.resolve<VenueContext>({});
  // A failed lookup fails the capture once it is needed; a retake before then must not leave it unhandled.
  context.catch(() => {});
  try {
    checkCurrent();
    const { rankCrops } = deps;
    const candidates = await timed("warp", () =>
      deps.warper.warpCandidates(
        input.photoUri,
        input.quad,
        opts.inputSize,
        !!rankCrops && deps.isOnline(),
        input.turns,
        input.view,
      ),
    );
    if (candidates.length === 0) {
      return {
        kind: "retake",
        reason: "boundary",
        timings,
        message: "Fit the whole painting in view, including all four corners, and hold steady.",
      };
    }
    const { painting: prepared, vector } = await chooseCrop(
      candidates,
      deps.embedder,
      rankCrops && (async (vectors) => rankCrops(vectors, (await context).venueId)),
      { timed, ready: context },
    );
    const { cropUri } = prepared;
    preparedCropUri = cropUri;
    const triage = await timed("triage", () => deps.triage.check(cropUri));
    if (!triage.ok) {
      return {
        kind: "retake",
        reason: triage.reason,
        message: triage.message,
        timings,
      };
    }
    const presentationReady = Promise.resolve()
      .then(() => deps.onPrepared?.(prepared))
      .catch((error: unknown) => {
        reportError(error, "capture.prepare_presentation", {
          level: "warning",
        });
      });
    const features = await timed("orb", () => deps.orb.extract(cropUri));
    const { venueId, visitId, visitLocalId } = await context;
    checkCurrent();
    const payload: CapturePayload = {
      owner: current.owner,
      scope: current.scope,
      localId: randomUUID(),
      vector,
      descriptors: features.descriptors,
      keypoints: features.keypoints,
      modelVersion: opts.modelVersion,
      venueId,
      visitId,
      visitLocalId,
      capturedAt: input.capturedAt,
      photoUri: input.photoUri,
      cropUri,
      cropCorners: prepared.corners,
      contentBounds: prepared.contentBounds,
    };
    const online = deps.isOnline() && !!current.scope && current.isCurrent();
    if (online && payload.visitLocalId && payload.venueId && deps.resolveVisitId) {
      payload.visitId = await withTimeout(
        deps.resolveVisitId(payload.visitLocalId),
        VISIT_SYNC_TIMEOUT_MS,
        "Visit sync timed out",
      ).catch((error: unknown) => {
        if (!isTransientError(error) && !(error instanceof TimeoutError)) {
          reportError(error, "capture.sync_visit", { level: "warning" });
        }
        addBreadcrumb("capture.queued", { reason: "visit_sync" });
        console.warn("The visit has not synced yet; queuing the scan", error);
        return undefined;
      });
      checkCurrent();
    }
    const identifyNow = online && (!payload.visitLocalId || !!payload.visitId);
    await presentationReady;
    checkCurrent();
    persisting = true;
    await timed("enqueue", () => deps.store.enqueue(payload, identifyNow ? "identifying" : "queued"));
    if (identifyNow) {
      try {
        const response = await timed("identify", () => deps.identify(payload));
        if (!current.isCurrent()) {
          return { kind: "queued", localId: payload.localId, timings };
        }
        await deps.store.recordResult(payload.localId, response, current.owner);
        return { kind: "sent", scanId: response.scanId, response, timings };
      } catch (error) {
        await deps.store.requeue(payload.localId, errorMessage(error), current.owner);
        if (!isNetworkError(error)) throw error;
        addBreadcrumb("capture.queued", { reason: "offline" });
      }
    }
    // The result screen opens on the queued row and live-queries the local match, so a package scan never delays the shutter.
    if (current.isOwnerCurrent() && deps.recognizeOffline) {
      void deps
        .recognizeOffline(payload)
        .catch((error: unknown) => console.warn("Offline identification unavailable; capture stays queued", error));
    }
    return { kind: "queued", localId: payload.localId, timings };
  } finally {
    if (!persisting && preparedCropUri && deps.isCurrent?.() === false) removeFileIfExists(preparedCropUri);
    timings.total = performance.now() - started;
    if (__DEV__) {
      console.debug("Capture timings (ms)", {
        source: input.source,
        ...timings,
      });
    }
  }
}

import { randomUUID } from "expo-crypto";

import { captureOwner } from "@/lib/account/owner-store";
import { errorMessage, isNetworkError } from "@/lib/network-error";
import { reportError, addBreadcrumb } from "@/lib/observability";

import { roundVector } from "./features";
import type {
  CaptureDependencies,
  CaptureInput,
  CaptureOptions,
  CapturePayload,
  CaptureResult,
  CaptureTimings,
} from "./stages";

/** A visit sync slower than this sends the scan to the queue; the flusher finishes it. */
export const VISIT_SYNC_TIMEOUT_MS = 4000;

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Visit sync timed out")), ms);
  });
  return Promise.race([task, expiry]).finally(() => clearTimeout(timer));
}

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
  async function timed<T>(stage: Exclude<keyof CaptureTimings, "total">, task: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await task();
    } finally {
      timings[stage] = performance.now() - start;
    }
  }

  try {
    const prepared = await timed("warp", () =>
      deps.warper.warpAndLetterbox(input.photoUri, input.quad, opts.inputSize),
    );
    if (!prepared) {
      return {
        kind: "retake",
        reason: "boundary",
        timings,
        message:
          input.source === "library"
            ? "Choose a photo that shows the whole painting, including all four corners."
            : "Fit the whole painting in view, including all four corners, and hold steady.",
      };
    }
    const { cropUri } = prepared;
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
    const embedding = await timed("embed", () => deps.embedder.embed(cropUri));
    const features = await timed("orb", () => deps.orb.extract(cropUri));
    const payload: CapturePayload = {
      owner: current.owner,
      scope: current.scope,
      localId: randomUUID(),
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
      contentBounds: prepared.contentBounds,
    };
    if (!current.isOwnerCurrent()) throw new Error("Journal owner changed");
    const online = deps.isOnline() && !!current.scope && current.isCurrent();
    if (online && payload.visitLocalId && !payload.visitId && payload.venueId && deps.resolveVisitId) {
      payload.visitId = await withTimeout(
        deps.resolveVisitId(payload.visitLocalId, payload.venueId),
        VISIT_SYNC_TIMEOUT_MS,
      ).catch((error: unknown) => {
        if (!(error instanceof Error && error.message === "Visit sync timed out")) {
          reportError(error, "capture.sync_visit", { level: "warning" });
        }
        addBreadcrumb("capture.queued", { reason: "visit_sync" });
        console.warn("The visit has not synced yet; queuing the scan", error);
        return undefined;
      });
      if (!current.isOwnerCurrent()) throw new Error("Journal owner changed");
    }
    const identifyNow = online && (!payload.visitLocalId || !!payload.visitId);
    await presentationReady;
    if (!current.isOwnerCurrent()) throw new Error("Journal owner changed");
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
    timings.total = performance.now() - started;
    if (__DEV__) {
      console.debug("Capture timings (ms)", {
        source: input.source,
        ...timings,
      });
    }
  }
}

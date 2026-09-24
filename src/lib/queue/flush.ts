import { reportError, addBreadcrumb } from "@/lib/observability";
import type { FunctionArgs } from "convex/server";

import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PendingScan, PendingScanStatus } from "@/db/schema";
import type { ScanFeatures } from "@/lib/capture/features";
import type { IdentifyResponse } from "@/lib/capture/stages";
import { errorMessage, isTransientError, rateLimitRetryAfterMs } from "@/lib/network-error";

export type IdentifyArgs = Omit<FunctionArgs<typeof api.identify.identify>, "scope">;
export type LabelInput = { labelPhotoPath?: string; qrUrl?: string };

export type FlushDependencies = {
  isCurrent?(): boolean;
  isLabelCapture?(row: PendingScan): boolean;
  listFlushable(modelVersion: string): Promise<PendingScan[]>;
  listPendingLabels(): Promise<PendingScan[]>;
  clearPendingLabel(localId: string, label: LabelInput): Promise<void>;
  recordLabelFailure: FlushDependencies["recordFailure"];
  markIdentifying(localId: string): Promise<void>;
  recordResult(localId: string, response: IdentifyResponse): Promise<void>;
  recordFailure(
    localId: string,
    error: string,
    options: { countAttempt: boolean },
  ): Promise<{ status: PendingScanStatus; attempts: number }>;
  resetAttemptsForModel(localId: string, modelVersion: string): Promise<void>;
  updateFeatures(localId: string, features: ScanFeatures & { modelVersion: string }): Promise<void>;
  resolveVisitId(localId: string, venueId: Id<"museums">): Promise<Id<"visits">>;
  identify(args: IdentifyArgs): Promise<IdentifyResponse>;
  runLabelFlow(scanId: Id<"scans">, label: LabelInput): Promise<void>;
  reembed(cropPath: string): Promise<ScanFeatures>;
  isOnline(): Promise<boolean>;
  modelVersion: string;
};

export type Flusher = {
  start(): Promise<void>;
  flush(): Promise<void>;
  stop(): void;
};

export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 1000;
}

/**
 * Sends queued captures oldest first, one run at a time. Transient failures pause only their task
 * type without counting an attempt; other failures count and keep going.
 */
export function createFlusher(deps: FlushDependencies): Flusher {
  let inFlight: Promise<void> | undefined;
  let rerun = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const backoff = {
    identify: { transientFailures: 0, pauseUntil: 0 },
    label: { transientFailures: 0, pauseUntil: 0 },
  };
  const retryAt = new Map<string, number>();
  let active = false;
  let generation = 0;

  function scheduleRetry(delayMs: number): void {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined;
        void flush();
      },
      Math.max(0, delayMs),
    );
  }

  async function processRow(row: PendingScan, isCurrent: () => boolean): Promise<void> {
    if (row.attemptModelVersion !== deps.modelVersion) {
      await deps.resetAttemptsForModel(row.localId, deps.modelVersion);
      if (!isCurrent()) return;
    }
    let features: ScanFeatures & { modelVersion: string } = {
      vector: row.vector,
      descriptors: row.descriptors,
      keypoints: row.keypoints,
      modelVersion: row.modelVersion,
    };
    if (row.modelVersion !== deps.modelVersion) {
      features = {
        ...(await deps.reembed(row.cropPath)),
        modelVersion: deps.modelVersion,
      };
      if (!isCurrent()) return;
      await deps.updateFeatures(row.localId, features);
    }
    let visitId = row.visitId ?? undefined;
    if (row.visitLocalId) {
      if (!row.venueId) {
        throw new Error("The capture visit is missing its venue");
      }
      visitId = await deps.resolveVisitId(row.visitLocalId, row.venueId);
    }
    if (!isCurrent()) return;
    await deps.markIdentifying(row.localId);
    if (!isCurrent()) {
      await deps.recordFailure(row.localId, "Identification interrupted", {
        countAttempt: false,
      });
      return;
    }
    const response = await deps.identify({
      localId: row.localId,
      ...features,
      venueId: row.venueId ?? undefined,
      visitId,
      capturedAt: row.capturedAt,
    });
    if (!isCurrent()) return;
    await deps.recordResult(row.localId, response);
    const label: LabelInput = {
      labelPhotoPath: row.labelPhotoPath ?? undefined,
      qrUrl: row.qrUrl ?? undefined,
    };
    if (
      response.status === "identified"
      && response.outcome === "confident"
      && !deps.isLabelCapture?.(row)
      && isCurrent()
      && (label.labelPhotoPath || label.qrUrl)
    ) {
      await deps.clearPendingLabel(row.localId, label);
    }
  }

  async function processLabel(row: PendingScan, isCurrent: () => boolean): Promise<void> {
    if (!row.scanId) return;
    const label = {
      labelPhotoPath: row.labelPhotoPath ?? undefined,
      qrUrl: row.qrUrl ?? undefined,
    };
    await deps.runLabelFlow(row.scanId, label);
    if (isCurrent()) await deps.clearPendingLabel(row.localId, label);
  }

  async function run(isCurrent: () => boolean): Promise<void> {
    if (!(await deps.isOnline())) return;
    if (!isCurrent()) return;
    const ids = new Set<string>();
    let nextRetryAt = Infinity;
    async function runRows(rows: PendingScan[], task: keyof typeof backoff): Promise<void> {
      const labelTask = task === "label";
      const taskBackoff = backoff[task];
      for (const row of rows) ids.add(`${task}:${row.localId}`);
      if (rows.length && taskBackoff.pauseUntil > Date.now()) {
        nextRetryAt = Math.min(nextRetryAt, taskBackoff.pauseUntil);
        return;
      }
      for (const row of rows) {
        if (!isCurrent()) return;
        const key = `${task}:${row.localId}`;
        const deadline = retryAt.get(key) ?? 0;
        if (deadline > Date.now()) {
          nextRetryAt = Math.min(nextRetryAt, deadline);
          continue;
        }
        try {
          if (labelTask) await processLabel(row, isCurrent);
          else await processRow(row, isCurrent);
          if (!isCurrent()) return;
          retryAt.delete(key);
          taskBackoff.transientFailures = 0;
          taskBackoff.pauseUntil = 0;
        } catch (error) {
          if (!isCurrent()) return;
          const transient = isTransientError(error);
          const recordFailure = labelTask ? deps.recordLabelFailure : deps.recordFailure;
          const { status, attempts } = await recordFailure(row.localId, errorMessage(error), {
            countAttempt: !transient,
          });
          if (!transient) {
            reportError(error, `queue.${task}`, { data: { attempts, status } });
          }
          if (transient) {
            addBreadcrumb("queue.paused", {
              task,
              reason: "transient_failure",
            });
            taskBackoff.pauseUntil =
              Date.now() + Math.max(backoffMs(++taskBackoff.transientFailures), rateLimitRetryAfterMs(error) ?? 0);
            nextRetryAt = Math.min(nextRetryAt, taskBackoff.pauseUntil);
            return;
          }
          if (status === "queued") {
            const deadline = Date.now() + backoffMs(attempts);
            retryAt.set(key, deadline);
            nextRetryAt = Math.min(nextRetryAt, deadline);
          } else {
            retryAt.delete(key);
          }
        }
      }
    }
    await runRows(await deps.listFlushable(deps.modelVersion), "identify");
    if (isCurrent()) {
      // Read again after identification so labels attached while identify was in flight are included.
      await runRows(await deps.listPendingLabels(), "label");
      for (const id of retryAt.keys()) if (!ids.has(id)) retryAt.delete(id);
    }
    if (isCurrent() && nextRetryAt !== Infinity) {
      scheduleRetry(nextRetryAt - Date.now());
    }
  }

  function flush(): Promise<void> {
    if (!active) return Promise.resolve();
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          rerun = false;
          clearTimeout(retryTimer);
          retryTimer = undefined;
          const runGeneration = generation;
          await run(() => active && generation === runGeneration && (deps.isCurrent?.() ?? true));
        } while (active && rerun);
      } catch (error) {
        reportError(error, "queue.flush");
        console.warn("Queue flush failed", error);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  return {
    start() {
      active = true;
      return flush();
    },
    flush,
    stop() {
      active = false;
      generation++;
      rerun = false;
      clearTimeout(retryTimer);
      retryTimer = undefined;
    },
  };
}

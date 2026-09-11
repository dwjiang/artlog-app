import type { FunctionArgs } from 'convex/server';

import type { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { PendingScan, PendingScanStatus } from '@/db/schema';
import type { ScanFeatures } from '@/lib/capture/features';
import type { IdentifyResponse } from '@/lib/capture/stages';
import { errorMessage, isTransientError, rateLimitRetryAfterMs } from '@/lib/network-error';

export type IdentifyArgs = FunctionArgs<typeof api.identify.identify>;
export type LabelInput = { labelPhotoPath?: string; qrUrl?: string };

export type FlushDependencies = {
  listFlushable(modelVersion: string): Promise<PendingScan[]>;
  markIdentifying(localId: string): Promise<void>;
  recordResult(localId: string, response: IdentifyResponse): Promise<void>;
  recordFailure(
    localId: string,
    error: string,
    options: { countAttempt: boolean },
  ): Promise<{ status: PendingScanStatus; attempts: number }>;
  resetAttemptsForModel(localId: string, modelVersion: string): Promise<void>;
  updateFeatures(localId: string, features: ScanFeatures & { modelVersion: string }): Promise<void>;
  identify(args: IdentifyArgs): Promise<IdentifyResponse>;
  runLabelFlow(scanId: Id<'scans'>, label: LabelInput): Promise<void>;
  reembed(cropPath: string): Promise<ScanFeatures>;
  isOnline(): Promise<boolean>;
  modelVersion: string;
};

export type Flusher = { start(): Promise<void>; flush(): Promise<void>; stop(): void };

export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 1000;
}

/**
 * Sends queued captures oldest first, one run at a time. Transient failures stop the run without
 * counting an attempt; other failures count and keep going, so one bad capture never blocks the rest.
 */
export function createFlusher(deps: FlushDependencies): Flusher {
  let inFlight: Promise<void> | undefined;
  let rerun = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let transientFailures = 0;
  let pauseUntil = 0;
  const retryAt = new Map<string, number>();
  let active = false;
  let generation = 0;

  function scheduleRetry(delayMs: number): void {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void flush();
    }, Math.max(0, delayMs));
  }

  async function processRow(row: PendingScan, isCurrent: () => boolean): Promise<void> {
    if (row.attemptModelVersion !== deps.modelVersion) {
      await deps.resetAttemptsForModel(row.localId, deps.modelVersion);
      if (!isCurrent()) return;
    }
    let features: ScanFeatures & { modelVersion: string } = {
      vector: row.vector, descriptors: row.descriptors, keypoints: row.keypoints, modelVersion: row.modelVersion,
    };
    if (row.modelVersion !== deps.modelVersion) {
      features = { ...(await deps.reembed(row.cropPath)), modelVersion: deps.modelVersion };
      if (!isCurrent()) return;
      await deps.updateFeatures(row.localId, features);
    }
    if (!isCurrent()) return;
    await deps.markIdentifying(row.localId);
    if (!isCurrent()) {
      await deps.recordFailure(row.localId, 'Identification interrupted', { countAttempt: false });
      return;
    }
    const response = await deps.identify({
      localId: row.localId, ...features,
      venueId: row.venueId ?? undefined, visitId: row.visitId ?? undefined, capturedAt: row.capturedAt,
    });
    // Convex actions cannot be cancelled; retain an already-sent request's result after cleanup.
    await deps.recordResult(row.localId, response);
    if (!isCurrent()) return;
    const label: LabelInput = { labelPhotoPath: row.labelPhotoPath ?? undefined, qrUrl: row.qrUrl ?? undefined };
    const missed = response.status === 'identified' && (response.outcome === 'soft' || response.outcome === 'miss');
    if (missed && (label.labelPhotoPath || label.qrUrl)) {
      try {
        await deps.runLabelFlow(response.scanId, label);
      } catch (error) {
        console.warn('Label flow failed for a queued scan', { localId: row.localId, error });
      }
    }
  }

  async function run(isCurrent: () => boolean): Promise<void> {
    if (pauseUntil > Date.now()) {
      scheduleRetry(pauseUntil - Date.now());
      return;
    }
    if (!(await deps.isOnline())) return;
    if (!isCurrent()) return;
    const rows = await deps.listFlushable(deps.modelVersion);
    if (!isCurrent()) return;
    const ids = new Set(rows.map((row) => row.localId));
    for (const id of retryAt.keys()) if (!ids.has(id)) retryAt.delete(id);
    let nextRetryAt = Infinity;
    for (const row of rows) {
      if (!isCurrent()) return;
      const deadline = retryAt.get(row.localId) ?? 0;
      if (deadline > Date.now()) {
        nextRetryAt = Math.min(nextRetryAt, deadline);
        continue;
      }
      try {
        await processRow(row, isCurrent);
        if (!isCurrent()) return;
        retryAt.delete(row.localId);
        transientFailures = 0;
        pauseUntil = 0;
      } catch (error) {
        const transient = isTransientError(error);
        const { status, attempts } = await deps.recordFailure(row.localId, errorMessage(error), { countAttempt: !transient });
        if (transient) {
          pauseUntil = Date.now() + Math.max(backoffMs(++transientFailures), rateLimitRetryAfterMs(error) ?? 0);
          nextRetryAt = pauseUntil;
          break;
        }
        if (status === 'queued') {
          const deadline = Date.now() + backoffMs(attempts);
          retryAt.set(row.localId, deadline);
          nextRetryAt = Math.min(nextRetryAt, deadline);
        } else {
          retryAt.delete(row.localId);
        }
      }
    }
    if (isCurrent() && nextRetryAt !== Infinity) scheduleRetry(nextRetryAt - Date.now());
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
          await run(() => active && generation === runGeneration);
        } while (active && rerun);
      } catch (error) {
        console.warn('Queue flush failed', error);
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

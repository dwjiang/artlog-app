import { useEffect, useState, useSyncExternalStore } from "react";

import { reportError } from "@/lib/observability";

import { getLookAround, isExpectedLookAroundError } from "../../../modules/look-around/src";

// Apple draws its Maps logo at a fixed size, so a larger still shows it smaller once fitted to the same spot. Small
// spots keep the small still, where a smaller logo would stop being legible.
const STILL_SIZES = {
  small: { width: 400, height: 250 },
  large: { width: 800, height: 500 },
} as const;
export type LookAroundStillSize = keyof typeof STILL_SIZES;
export const LOOK_AROUND_STILL_ASPECT = STILL_SIZES.small.width / STILL_SIZES.small.height;
// Apple throttles a device that asks too quickly, so a long list takes its stills two at a time.
const MAX_ACTIVE = 2;

type Place = { id: string; lat: number; lng: number };
type Job = { key: string; lat: number; lng: number; size: LookAroundStillSize; onFailure: Set<() => void> };

// A file URI, or null where Apple has no imagery, by place and size.
const stills = new Map<string, string | null>();
const listeners = new Set<() => void>();
const waiting: Job[] = [];
const pending = new Map<string, Job>();
let active = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function takeNext() {
  const lookAround = getLookAround();
  while (lookAround && active < MAX_ACTIVE && waiting.length > 0) {
    const job = waiting.shift()!;
    active += 1;
    const { width, height } = STILL_SIZES[job.size];
    lookAround
      .snapshot(job.lat, job.lng, width, height)
      .then(
        (uri) => {
          pending.delete(job.key);
          stills.set(job.key, uri);
          for (const listener of listeners) listener();
        },
        (cause: unknown) => {
          pending.delete(job.key);
          if (!isExpectedLookAroundError(cause)) reportError(cause, "venue.look_around.still", { level: "warning" });
          for (const onFailure of job.onFailure) onFailure();
        },
      )
      .finally(() => {
        active -= 1;
        takeNext();
      });
  }
}

/**
 * A Look Around still of `place`, rendered on the phone the first time it is shown at `size`. `settled` turns true once
 * the still has arrived, Apple has none, or it could not come this time; a failed request is retried when the place is
 * next shown. A place that stops being shown before its turn is never requested.
 */
export function useLookAroundStill(
  place: Place | undefined,
  size: LookAroundStillSize,
): { uri?: string; settled: boolean } {
  const id = place?.id;
  const lat = place?.lat;
  const lng = place?.lng;
  const key = id === undefined ? undefined : `${id}:${size}`;
  const available = getLookAround() !== undefined;
  const still = useSyncExternalStore(subscribe, () => (key === undefined ? undefined : stills.get(key)));
  const [failedKey, setFailedKey] = useState<string>();
  useEffect(() => {
    if (key === undefined || lat === undefined || lng === undefined || !available || stills.has(key)) return;
    let job = pending.get(key);
    if (!job) {
      job = { key, lat, lng, size, onFailure: new Set() };
      pending.set(key, job);
      waiting.push(job);
    }
    const onFailure = () => setFailedKey(key);
    job.onFailure.add(onFailure);
    takeNext();
    return () => {
      job.onFailure.delete(onFailure);
      if (job.onFailure.size > 0) return;
      const index = waiting.indexOf(job);
      if (index !== -1) {
        waiting.splice(index, 1);
        pending.delete(key);
      }
    };
  }, [key, lat, lng, size, available]);
  return {
    uri: still ?? undefined,
    settled: key === undefined || !available || still !== undefined || failedKey === key,
  };
}

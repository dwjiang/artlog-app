import type { RectDetection, RectObservation, RectPoint } from '../../../modules/vision-rect/src';

import type { Quad } from './stages';

// Product tuning (plan 03.02).
export const STABLE_WINDOW_MS = 400;
/** Fraction of the frame diagonal a corner may move within the window and still count as steady. */
export const STABLE_MAX_DISPLACEMENT = 0.02;
export const MIN_AREA_FRACTION = 0.25;
/** Normalized distance from a frame edge at which a corner counts as cut off. */
export const EDGE_MARGIN = 0.02;
export const MAX_OPPOSITE_EDGE_RATIO = 1.3;
/** A detection gap shorter than this keeps the last result instead of resetting. */
export const MISS_GRACE_MS = 300;
/** Normalized corner distance within which a still-image candidate matches the preview quad. */
export const STILL_MATCH_TOLERANCE = 0.05;

export type FrameSize = { width: number; height: number };
export type Guidance = 'searching' | 'move-closer' | 'fit-whole-painting' | 'straighten' | 'hold-still' | 'ready';
export type TrackerResult = { quad: Quad | null; stable: boolean; guidance: Guidance };

const unitSize: FrameSize = { width: 1, height: 1 };

export function toQuad(corners: RectPoint[]): Quad {
  if (corners.length !== 4) throw new Error(`Expected 4 corners, got ${corners.length}`);
  return [
    [corners[0].x, corners[0].y],
    [corners[1].x, corners[1].y],
    [corners[2].x, corners[2].y],
    [corners[3].x, corners[3].y],
  ];
}

export function toCorners(quad: Quad): RectPoint[] {
  return quad.map(([x, y]) => ({ x, y }));
}

export function quadArea(quad: Quad, size: FrameSize = unitSize): number {
  let twiceArea = 0;
  for (let index = 0; index < 4; index++) {
    const [ax, ay] = quad[index];
    const [bx, by] = quad[(index + 1) % 4];
    twiceArea += ax * size.width * by * size.height - bx * size.width * ay * size.height;
  }
  return Math.abs(twiceArea) / 2;
}

export function largestObservation(observations: RectObservation[]): RectObservation | undefined {
  let best: RectObservation | undefined;
  let bestArea = -1;
  for (const observation of observations) {
    if (observation.corners.length !== 4) continue;
    const area = quadArea(toQuad(observation.corners));
    if (area > bestArea) {
      best = observation;
      bestArea = area;
    }
  }
  return best;
}

function distance(a: [number, number], b: [number, number], size: FrameSize): number {
  return Math.hypot((a[0] - b[0]) * size.width, (a[1] - b[1]) * size.height);
}

function maxCornerDistance(a: Quad, b: Quad, size: FrameSize): number {
  return Math.max(...a.map((corner, index) => distance(corner, b[index], size)));
}

export function framingGuidance(quad: Quad, size: FrameSize): 'move-closer' | 'fit-whole-painting' | 'straighten' | null {
  if (quadArea(quad, size) < MIN_AREA_FRACTION * size.width * size.height) return 'move-closer';
  const cutOff = quad.some(([x, y]) => x < EDGE_MARGIN || x > 1 - EDGE_MARGIN || y < EDGE_MARGIN || y > 1 - EDGE_MARGIN);
  if (cutOff) return 'fit-whole-painting';
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), Number.EPSILON);
  const horizontal = ratio(distance(topLeft, topRight, size), distance(bottomLeft, bottomRight, size));
  const vertical = ratio(distance(topLeft, bottomLeft, size), distance(topRight, bottomRight, size));
  if (horizontal > MAX_OPPOSITE_EDGE_RATIO || vertical > MAX_OPPOSITE_EDGE_RATIO) return 'straighten';
  return null;
}

const searching: TrackerResult = { quad: null, stable: false, guidance: 'searching' };

export class RectTracker {
  private history: { quad: Quad; at: number }[] = [];
  private last: TrackerResult = searching;
  private lastSeenAt = -Infinity;

  reset(): void {
    this.history = [];
    this.last = searching;
    this.lastSeenAt = -Infinity;
  }

  push(observations: RectObservation[], size: FrameSize, now: number): TrackerResult {
    const observation = largestObservation(observations);
    if (!observation) {
      if (now - this.lastSeenAt > MISS_GRACE_MS) this.reset();
      return this.last;
    }
    const quad = toQuad(observation.corners);
    this.lastSeenAt = now;
    this.history.push({ quad, at: now });
    // Keep the newest sample that is at least a window old, so a full window is detectable despite frame jitter.
    while (this.history.length > 1 && this.history[1].at <= now - STABLE_WINDOW_MS) this.history.shift();
    const windowFull = this.history[0].at <= now - STABLE_WINDOW_MS;
    const displacement = Math.max(...this.history.map((sample) => maxCornerDistance(sample.quad, quad, size)));
    const stable = windowFull && displacement < STABLE_MAX_DISPLACEMENT * Math.hypot(size.width, size.height);
    const guidance = framingGuidance(quad, size) ?? (stable ? 'ready' : 'hold-still');
    this.last = { quad, stable, guidance };
    return this.last;
  }
}

/**
 * Chooses the region to warp from a capture. A still-image candidate that matches the preview quad
 * refines it at full resolution; otherwise the preview quad stands. Library imports take the largest
 * candidate: decision 006 rejected inner-rectangle selection by area, and no framed-painting fixture
 * shows a nested candidate that is the canvas boundary, so the outer candidate is retained.
 */
export function selectCaptureQuad(previewQuad: Quad | null, still: RectDetection): Quad | null {
  const candidates = still.observations.filter((observation) => observation.corners.length === 4);
  if (previewQuad) {
    let best: Quad | null = null;
    let bestDistance = STILL_MATCH_TOLERANCE;
    for (const candidate of candidates) {
      const quad = toQuad(candidate.corners);
      const separation = maxCornerDistance(quad, previewQuad, unitSize);
      if (separation <= bestDistance) {
        best = quad;
        bestDistance = separation;
      }
    }
    return best ?? previewQuad;
  }
  const largest = largestObservation(candidates);
  return largest ? toQuad(largest.corners) : null;
}

/** Feeds detections into a tracker and lets React subscribe to guidance changes without re-rendering per frame. */
export class RectTrackerStore {
  private readonly tracker = new RectTracker();
  private readonly listeners = new Set<() => void>();
  private result: TrackerResult = searching;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getGuidance = (): Guidance => this.result.guidance;

  get quad(): Quad | null {
    return this.result.quad;
  }

  push(detection: RectDetection, now: number): TrackerResult {
    return this.update(this.tracker.push(detection.observations, detection, now));
  }

  reset(): void {
    this.tracker.reset();
    this.update(searching);
  }

  private update(next: TrackerResult): TrackerResult {
    const changed = next.guidance !== this.result.guidance;
    this.result = next;
    if (changed) this.listeners.forEach((listener) => listener());
    return next;
  }
}

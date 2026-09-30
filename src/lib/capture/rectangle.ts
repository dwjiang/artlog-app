import type { RectObservation, RectPoint, StillDetection, SubjectObservation } from "../../../modules/vision-rect/src";
import type { Quad } from "./stages";

export const STABLE_WINDOW_MS = 800;
/**
 * Fraction of the frame diagonal a smoothed corner may move within the window and still count as
 * steady. Hand-held aiming at a painting measured 3–6.5% raw corner movement per window on the phone.
 */
export const STABLE_MAX_DISPLACEMENT = 0.06;
/** Weight of the newest detection in the tracked corners; Vision's per-frame corner wobble is the rest. */
export const SMOOTHING = 0.5;
/** A candidate farther than this fraction of the diagonal from the tracked box is a miss, not a move. */
export const TRACK_MAX_JUMP = 0.2;
/**
 * Area ratio separating nested rectangles from the same one: a nearby candidate below this share of
 * the tracked area is the canvas inside the frame, and one above its inverse is an enclosing frame.
 */
export const NESTED_AREA_RATIO = 0.8;
/**
 * Share of the camera frame a painting must cover before it is captured automatically. The preview
 * cover-fits the 4:3 frame, so a tenth of the frame is about a sixth of the screen; a 12 MP still
 * crops that to well above the 512 px model input.
 */
export const MIN_AREA_FRACTION = 0.1;
/** Normalized distance from a frame edge at which a corner counts as cut off. */
export const EDGE_MARGIN = 0.02;
export const MAX_OPPOSITE_EDGE_RATIO = 1.3;
/** A detection gap shorter than this keeps the last result instead of resetting. */
export const MISS_GRACE_MS = 300;
/** Normalized corner distance within which a still-image candidate matches the preview quad. */
export const STILL_MATCH_TOLERANCE = 0.05;
/**
 * A lifted subject whose region area over quad area is within this of 1 is a quadrilateral: a framed
 * painting. On the Mac harness gallery photographs paintings measured 1.001–1.016; visitors 1.10–1.43,
 * figures inside a canvas 0.94 and 1.19, and visitors merged with the painting behind them 0.96.
 */
export const SUBJECT_QUAD_FILL_TOLERANCE = 0.025;
// Small lifted regions can be details inside an edge-to-edge painting, despite a rectangular mask.
export const MIN_UNGUIDED_SUBJECT_AREA_FRACTION = 0.2;

export type FrameSize = { width: number; height: number };
export type Guidance = "searching" | "move-closer" | "fit-whole-painting" | "straighten" | "hold-still" | "ready";
export type TrackerResult = {
  quad: Quad | null;
  /** Latest accepted detection; smoothing would move capture corners off the artwork. */
  captureQuad: Quad | null;
  stable: boolean;
  guidance: Guidance;
  /** Largest corner movement within the window as a fraction of the frame diagonal. */
  jitter: number;
  progress: number;
};

const unitSize: FrameSize = { width: 1, height: 1 };

export function toQuad(corners: RectPoint[]): Quad {
  if (corners.length !== 4) {
    throw new Error(`Expected 4 corners, got ${corners.length}`);
  }
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

export function maxCornerDistance(a: Quad, b: Quad, size: FrameSize): number {
  return Math.max(...a.map((corner, index) => distance(corner, b[index], size)));
}

function largestQuad(quads: Quad[]): Quad | undefined {
  return quads.reduce<Quad | undefined>(
    (best, quad) => (!best || quadArea(quad) > quadArea(best) ? quad : best),
    undefined,
  );
}

function enclosesCentroid(outer: Quad, inner: Quad): boolean {
  const cx = inner.reduce((sum, [x]) => sum + x, 0) / 4;
  const cy = inner.reduce((sum, [, y]) => sum + y, 0) / 4;
  const xs = outer.map(([x]) => x);
  const ys = outer.map(([, y]) => y);
  return cx > Math.min(...xs) && cx < Math.max(...xs) && cy > Math.min(...ys) && cy < Math.max(...ys);
}

function blend(tracked: Quad, raw: Quad): Quad {
  return tracked.map(([x, y], index) => [
    x + (raw[index][0] - x) * SMOOTHING,
    y + (raw[index][1] - y) * SMOOTHING,
  ]) as Quad;
}

function isCutOff(quad: Quad): boolean {
  return quad.some(([x, y]) => x < EDGE_MARGIN || x > 1 - EDGE_MARGIN || y < EDGE_MARGIN || y > 1 - EDGE_MARGIN);
}

export function isUsableQuad(quad: Quad): boolean {
  if (quad.some((point) => point.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) {
    return false;
  }
  if (quadArea(quad) < 0.01) return false;
  return quad.every(([x, y], i) => {
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    return (b[0] - x) * (c[1] - b[1]) - (b[1] - y) * (c[0] - b[0]) > 0;
  });
}

export function containsPoint(quad: Quad, [x, y]: [number, number]): boolean {
  return quad.every(([ax, ay], i) => {
    const [bx, by] = quad[(i + 1) % 4];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
  });
}

/** Maps normalized frame corners onto the preview, which covers the view like `resizeMode="cover"`. */
export function previewQuad(quad: Quad, frame: FrameSize, preview: FrameSize): Quad {
  const scale = Math.max(preview.width / frame.width, preview.height / frame.height);
  return quad.map(([x, y]) => [
    (x * frame.width * scale + (preview.width - frame.width * scale) / 2) / preview.width,
    (y * frame.height * scale + (preview.height - frame.height * scale) / 2) / preview.height,
  ]) as Quad;
}

/** With a `preview`, corners the cover-fitted preview crops off screen also count as cut off. */
export function framingGuidance(
  quad: Quad,
  size: FrameSize,
  preview?: FrameSize,
): "move-closer" | "fit-whole-painting" | "straighten" | null {
  if (quadArea(quad, size) < MIN_AREA_FRACTION * size.width * size.height) {
    return "move-closer";
  }
  if (isCutOff(quad) || (preview && !isUsableQuad(previewQuad(quad, size, preview)))) return "fit-whole-painting";
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), Number.EPSILON);
  const horizontal = ratio(distance(topLeft, topRight, size), distance(bottomLeft, bottomRight, size));
  const vertical = ratio(distance(topLeft, bottomLeft, size), distance(topRight, bottomRight, size));
  if (horizontal > MAX_OPPOSITE_EDGE_RATIO || vertical > MAX_OPPOSITE_EDGE_RATIO) {
    return "straighten";
  }
  return null;
}

const searching: TrackerResult = {
  quad: null,
  captureQuad: null,
  stable: false,
  guidance: "searching",
  jitter: 0,
  progress: 0,
};

export class RectTracker {
  private history: { quad: Quad; at: number }[] = [];
  private last: TrackerResult = searching;
  private lastSeenAt = -Infinity;

  reset(): void {
    this.history = [];
    this.last = searching;
    this.lastSeenAt = -Infinity;
  }

  /** Switches to a different rectangle: the stability window restarts from it. */
  private retarget(quad: Quad): Quad {
    this.history = [];
    return quad;
  }

  push(observations: RectObservation[], size: FrameSize, now: number): TrackerResult {
    const candidates = observations
      .filter((observation) => observation.corners.length === 4)
      .map((o) => toQuad(o.corners));
    const tracked = this.last.quad;
    const missedFor = now - this.lastSeenAt;
    // Vision returns the frame, the mat or the canvas on different frames. The outermost rectangle is
    // the target: a larger candidate enclosing the tracked box takes over, a nested one is ignored while
    // the outer was seen recently, and switching between them never counts as camera movement.
    const outer =
      tracked
      && largestQuad(
        candidates.filter((q) => quadArea(q) * NESTED_AREA_RATIO > quadArea(tracked) && enclosesCentroid(q, tracked)),
      );
    const near =
      tracked
      && largestQuad(
        candidates.filter(
          (q) => maxCornerDistance(q, tracked, size) < TRACK_MAX_JUMP * Math.hypot(size.width, size.height),
        ),
      );
    const nested = tracked && near && quadArea(near) < NESTED_AREA_RATIO * quadArea(tracked);
    let captureQuad: Quad | undefined;
    let smoothFrom: Quad | undefined;
    if (!tracked) {
      captureQuad = largestQuad(candidates);
    } else if (outer) {
      captureQuad = this.retarget(outer);
    } else if (near && !nested) {
      captureQuad = near;
      smoothFrom = tracked;
    } else if (near && missedFor > MISS_GRACE_MS) {
      captureQuad = this.retarget(near);
    }
    if (!captureQuad) {
      if (missedFor > MISS_GRACE_MS) this.reset();
      return this.last;
    }
    const quad = smoothFrom ? blend(smoothFrom, captureQuad) : captureQuad;
    this.lastSeenAt = now;
    this.history.push({ quad, at: now });
    // Keep the newest sample that is at least a window old, so a full window is detectable despite frame jitter.
    while (this.history.length > 1 && this.history[1].at <= now - STABLE_WINDOW_MS) {
      this.history.shift();
    }
    const windowFull = this.history[0].at <= now - STABLE_WINDOW_MS;
    const displacement = Math.max(...this.history.map((sample) => maxCornerDistance(sample.quad, quad, size)));
    const jitter = displacement / Math.hypot(size.width, size.height);
    const stable = windowFull && jitter < STABLE_MAX_DISPLACEMENT;
    const guidance = framingGuidance(quad, size) ?? (stable ? "ready" : "hold-still");
    const lastMovement = this.history.findLastIndex(
      (sample) =>
        maxCornerDistance(sample.quad, quad, size) >= STABLE_MAX_DISPLACEMENT * Math.hypot(size.width, size.height),
    );
    const steadySince = this.history[Math.min(lastMovement + 1, this.history.length - 1)].at;
    const progress =
      guidance === "ready" ? 1 : guidance === "hold-still" ? Math.min((now - steadySince) / STABLE_WINDOW_MS, 1) : 0;
    this.last = { quad, captureQuad, stable, guidance, jitter, progress };
    return this.last;
  }
}

export function isQuadrilateralSubject(subject: SubjectObservation): boolean {
  return subject.quad.length === 4 && Math.abs(subject.quadFill - 1) <= SUBJECT_QUAD_FILL_TOLERANCE;
}

function closestQuad(quads: Quad[], target: Quad): Quad | null {
  let best: Quad | null = null;
  let bestDistance = STILL_MATCH_TOLERANCE;
  for (const quad of quads) {
    const separation = maxCornerDistance(quad, target, unitSize);
    if (separation <= bestDistance) {
      best = quad;
      bestDistance = separation;
    }
  }
  return best;
}

// Smooth paint is indistinguishable from a mat by texture alone. Keep the detected boundary
// instead of recursively shrinking into textured details, and confirm preview corners on the still.
export function selectCaptureQuad(previewQuad: Quad | null, still: StillDetection): Quad | null {
  const rectangles = still.rectangles
    .filter((observation) => observation.corners.length === 4)
    .map((observation) => toQuad(observation.corners))
    .filter(isUsableQuad);
  const subjects = still.subjects
    .filter(isQuadrilateralSubject)
    .map((subject) => toQuad(subject.quad))
    .filter(
      (quad) =>
        isUsableQuad(quad)
        && !isCutOff(quad)
        && (quadArea(quad) >= MIN_UNGUIDED_SUBJECT_AREA_FRACTION
          || (previewQuad !== null
            && enclosesCentroid(previewQuad, quad)
            && quadArea(quad) >= 0.5 * quadArea(previewQuad))
          || closestQuad(rectangles, quad) !== null),
    )
    .sort((a, b) => quadArea(b) - quadArea(a));
  if (previewQuad) {
    const match = closestQuad(subjects, previewQuad) ?? closestQuad(rectangles, previewQuad);
    if (match) return match;
  }
  return (
    (previewQuad && subjects.find((quad) => enclosesCentroid(previewQuad, quad)))
    ?? subjects[0]
    ?? largestQuad(rectangles)
    ?? null
  );
}

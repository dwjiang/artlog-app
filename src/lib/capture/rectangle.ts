import type { RectObservation, RectPoint, StillDetection, SubjectObservation } from '../../../modules/vision-rect/src';

import type { Quad } from './stages';

/** Normalized distance from a frame edge at which a corner counts as cut off. */
export const EDGE_MARGIN = 0.02;
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

export function maxCornerDistance(a: Quad, b: Quad, size: FrameSize): number {
  return Math.max(...a.map((corner, index) => distance(corner, b[index], size)));
}

function enclosesCentroid(outer: Quad, inner: Quad): boolean {
  const cx = inner.reduce((sum, [x]) => sum + x, 0) / 4;
  const cy = inner.reduce((sum, [, y]) => sum + y, 0) / 4;
  const xs = outer.map(([x]) => x);
  const ys = outer.map(([, y]) => y);
  return cx > Math.min(...xs) && cx < Math.max(...xs) && cy > Math.min(...ys) && cy < Math.max(...ys);
}

function isCutOff(quad: Quad): boolean {
  return quad.some(([x, y]) => x < EDGE_MARGIN || x > 1 - EDGE_MARGIN || y < EDGE_MARGIN || y > 1 - EDGE_MARGIN);
}

export function isUsableQuad(quad: Quad): boolean {
  if (quad.some((point) => point.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) return false;
  if (quadArea(quad) < 0.01) return false;
  return quad.every(([x, y], i) => {
    const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    return (b[0] - x) * (c[1] - b[1]) - (b[1] - y) * (c[0] - b[0]) > 0;
  });
}

export function isQuadrilateralSubject(subject: SubjectObservation): boolean {
  return subject.quad.length === 4 && Math.abs(subject.quadFill - 1) <= SUBJECT_QUAD_FILL_TOLERANCE;
}

function closestRectangle(rectangles: RectObservation[], target: Quad): Quad | null {
  let best: Quad | null = null;
  let bestDistance = STILL_MATCH_TOLERANCE;
  for (const candidate of rectangles) {
    const quad = toQuad(candidate.corners);
    const separation = maxCornerDistance(quad, target, unitSize);
    if (separation <= bestDistance) {
      best = quad;
      bestDistance = separation;
    }
  }
  return best;
}

/**
 * Chooses the region to warp from a capture. A subject lifted from the background that is shaped like a
 * quadrilateral and lies inside the image wins: the largest under the preview quad, else the largest.
 * Small subjects need a preview target or a matching rectangle to avoid cropping to painted details.
 * Subjects cut off by the edge are doors and walls, or a painting
 * whose mask ran off the photo and fits a tilted quad; those fall through. Without a subject the
 * rectangle candidates stand in: the one matching the preview quad, else the largest.
 * Preview corners alone are never evidence of a still boundary. Imports keep the outer candidate because a smaller nested rectangle can be
 * painted detail rather than the canvas boundary.
 */
export function selectCaptureQuad(previewQuad: Quad | null, still: StillDetection): Quad | null {
  const rectangles = still.rectangles.filter((observation) => observation.corners.length === 4 && isUsableQuad(toQuad(observation.corners)));
  const subjects = still.subjects.filter(isQuadrilateralSubject).map((subject) => toQuad(subject.quad))
    .filter((quad) => isUsableQuad(quad) && !isCutOff(quad) && (
      quadArea(quad) >= MIN_UNGUIDED_SUBJECT_AREA_FRACTION
      || (previewQuad !== null && enclosesCentroid(previewQuad, quad) && quadArea(quad) >= 0.5 * quadArea(previewQuad))
      || closestRectangle(rectangles, quad) !== null
    )).sort((a, b) => quadArea(b) - quadArea(a));
  const subject = (previewQuad && subjects.find((quad) => enclosesCentroid(previewQuad, quad))) ?? subjects[0];
  if (subject) return subject;
  if (previewQuad) {
    const match = closestRectangle(rectangles, previewQuad);
    if (match) return match;
  }
  const largest = largestObservation(rectangles);
  return largest ? toQuad(largest.corners) : null;
}

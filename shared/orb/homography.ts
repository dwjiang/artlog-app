import { KEYPOINT_FLOATS, type OrbFeatures } from "./features";
import type { Match } from "./match";

export type Point = [number, number];

export type RansacOptions = {
  threshold?: number;
  maxIterations?: number;
  confidence?: number;
  seed?: number;
};

export type RansacResult = {
  H: Float64Array | null;
  inlierMask: Uint8Array;
  inlierCount: number;
  iterations: number;
};

const PIVOT_EPSILON = 1e-12;
const W_EPSILON = 1e-9;
const COLLINEAR_EPSILON = 1e-6;

export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mat3mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

export function applyHomography(H: ArrayLike<number>, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < W_EPSILON) return [NaN, NaN];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function isDegenerateSample(points: Point[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spread2 = (maxX - minX) ** 2 + (maxY - minY) ** 2;
  if (spread2 === 0) return true;
  const limit = COLLINEAR_EPSILON * spread2;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      for (let c = b + 1; c < points.length; c++) {
        const [ax, ay] = points[a];
        const [bx, by] = points[b];
        const [cx, cy] = points[c];
        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(cross) <= limit) return true;
      }
    }
  }
  return false;
}

// Direct linear transform with h33 = 1, solved through the normal equations of the 2n×8 system
// on Hartley-normalized points.
export function solveHomography(src: Point[], dst: Point[]): Float64Array | null {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  const srcNorm = normalization(src);
  const dstNorm = normalization(dst);
  if (srcNorm === null || dstNorm === null) return null;

  const m = new Float64Array(64);
  const rhs = new Float64Array(8);
  const row = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const x = srcNorm.scale * (src[i][0] - srcNorm.cx);
    const y = srcNorm.scale * (src[i][1] - srcNorm.cy);
    const u = dstNorm.scale * (dst[i][0] - dstNorm.cx);
    const v = dstNorm.scale * (dst[i][1] - dstNorm.cy);
    row.set([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    accumulateNormalEquations(m, rhs, row, u);
    row.set([0, 0, 0, x, y, 1, -v * x, -v * y]);
    accumulateNormalEquations(m, rhs, row, v);
  }
  const h = solveLinear8(m, rhs);
  if (h === null) return null;

  const normalized = new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
  const toSrc = new Float64Array([
    srcNorm.scale,
    0,
    -srcNorm.scale * srcNorm.cx,
    0,
    srcNorm.scale,
    -srcNorm.scale * srcNorm.cy,
    0,
    0,
    1,
  ]);
  const fromDst = new Float64Array([
    1 / dstNorm.scale,
    0,
    dstNorm.cx,
    0,
    1 / dstNorm.scale,
    dstNorm.cy,
    0,
    0,
    1,
  ]);
  const H = mat3mul(fromDst, mat3mul(normalized, toSrc));
  if (Math.abs(H[8]) > PIVOT_EPSILON) {
    for (let i = 0; i < 9; i++) H[i] /= H[8];
  }
  return H;
}

function normalization(points: Point[]): { cx: number; cy: number; scale: number } | null {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  let meanDistance = 0;
  for (const [x, y] of points) meanDistance += Math.hypot(x - cx, y - cy);
  meanDistance /= points.length;
  if (meanDistance < PIVOT_EPSILON) return null;
  return { cx, cy, scale: Math.SQRT2 / meanDistance };
}

function accumulateNormalEquations(
  m: Float64Array,
  rhs: Float64Array,
  row: Float64Array,
  b: number,
): void {
  for (let r = 0; r < 8; r++) {
    const rv = row[r];
    if (rv === 0) continue;
    rhs[r] += rv * b;
    for (let c = 0; c < 8; c++) m[r * 8 + c] += rv * row[c];
  }
}

function solveLinear8(m: Float64Array, rhs: Float64Array): Float64Array | null {
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let max = Math.abs(m[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r * n + col]);
      if (v > max) {
        max = v;
        pivot = r;
      }
    }
    if (max < PIVOT_EPSILON) return null;
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const t = m[col * n + c];
        m[col * n + c] = m[pivot * n + c];
        m[pivot * n + c] = t;
      }
      const t = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = t;
    }
    const p = m[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col] / p;
      if (f === 0) continue;
      for (let c = col; c < n; c++) m[r * n + c] -= f * m[col * n + c];
      rhs[r] -= f * rhs[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = rhs[r];
    for (let c = r + 1; c < n; c++) s -= m[r * n + c] * x[c];
    x[r] = s / m[r * n + r];
  }
  return x;
}

export function ransacHomography(
  matches: Match[],
  query: OrbFeatures,
  ref: OrbFeatures,
  opts: RansacOptions = {},
): RansacResult {
  const threshold = opts.threshold ?? 5;
  const maxIterations = opts.maxIterations ?? 1000;
  const confidence = opts.confidence ?? 0.995;
  const seed = opts.seed ?? 1;
  const n = matches.length;
  const inlierMask = new Uint8Array(n);
  if (n < 4) return { H: null, inlierMask, inlierCount: 0, iterations: 0 };

  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const { queryIdx, refIdx } = matches[i];
    sx[i] = ref.keypoints[refIdx * KEYPOINT_FLOATS];
    sy[i] = ref.keypoints[refIdx * KEYPOINT_FLOATS + 1];
    dx[i] = query.keypoints[queryIdx * KEYPOINT_FLOATS];
    dy[i] = query.keypoints[queryIdx * KEYPOINT_FLOATS + 1];
  }

  const rand = mulberry32(seed);
  const threshold2 = threshold * threshold;
  const sample = new Int32Array(4);
  const src: Point[] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const dst: Point[] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  let bestH: Float64Array | null = null;
  let bestCount = 0;
  let bound = maxIterations;
  let iterations = 0;
  while (iterations < bound) {
    iterations++;
    drawDistinct(rand, n, sample);
    for (let k = 0; k < 4; k++) {
      src[k][0] = sx[sample[k]];
      src[k][1] = sy[sample[k]];
      dst[k][0] = dx[sample[k]];
      dst[k][1] = dy[sample[k]];
    }
    if (isDegenerateSample(src) || isDegenerateSample(dst)) continue;
    const H = solveHomography(src, dst);
    if (H === null) continue;
    const count = countInliers(H, sx, sy, dx, dy, threshold2, null);
    if (count > bestCount) {
      bestCount = count;
      bestH = H;
      bound = Math.min(maxIterations, iterationBound(count / n, confidence));
    }
  }
  if (bestH === null || bestCount < 4) return { H: null, inlierMask, inlierCount: 0, iterations };

  countInliers(bestH, sx, sy, dx, dy, threshold2, inlierMask);
  const refit = solveHomography(maskedPoints(sx, sy, inlierMask), maskedPoints(dx, dy, inlierMask));
  const H = refit ?? bestH;
  const inlierCount = countInliers(H, sx, sy, dx, dy, threshold2, inlierMask);
  return { H, inlierMask, inlierCount, iterations };
}

function drawDistinct(rand: () => number, n: number, out: Int32Array): void {
  for (let k = 0; k < out.length; k++) {
    let candidate: number;
    let duplicate: boolean;
    do {
      candidate = Math.floor(rand() * n);
      duplicate = false;
      for (let j = 0; j < k; j++) if (out[j] === candidate) duplicate = true;
    } while (duplicate);
    out[k] = candidate;
  }
}

function countInliers(
  H: Float64Array,
  sx: Float64Array,
  sy: Float64Array,
  dx: Float64Array,
  dy: Float64Array,
  threshold2: number,
  mask: Uint8Array | null,
): number {
  let count = 0;
  for (let i = 0; i < sx.length; i++) {
    const x = sx[i];
    const y = sy[i];
    const w = H[6] * x + H[7] * y + H[8];
    let inlier = 0;
    if (Math.abs(w) >= W_EPSILON) {
      const ex = (H[0] * x + H[1] * y + H[2]) / w - dx[i];
      const ey = (H[3] * x + H[4] * y + H[5]) / w - dy[i];
      if (ex * ex + ey * ey <= threshold2) inlier = 1;
    }
    count += inlier;
    if (mask !== null) mask[i] = inlier;
  }
  return count;
}

function iterationBound(inlierRatio: number, confidence: number): number {
  const outlierSampleProbability = 1 - inlierRatio ** 4;
  if (outlierSampleProbability <= 0) return 0;
  if (outlierSampleProbability >= 1) return Infinity;
  return Math.ceil(Math.log(1 - confidence) / Math.log(outlierSampleProbability));
}

function maskedPoints(xs: Float64Array, ys: Float64Array, mask: Uint8Array): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) points.push([xs[i], ys[i]]);
  return points;
}

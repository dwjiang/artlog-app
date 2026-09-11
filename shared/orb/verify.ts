import type { OrbFeatures } from './features';
import { applyHomography, type Point, ransacHomography, type RansacOptions } from './homography';
import { matchDescriptors, type MatchOptions } from './match';

export type VerifyOptions = MatchOptions &
  RansacOptions & { minInliers?: number; inputSize: number };

export type VerifyResult = {
  matchCount: number;
  inlierCount: number;
  homography: number[] | null;
  corners: Point[] | null;
  verified: boolean;
};

const MIN_INLIERS = 15;
const MIN_DETERMINANT = 1e-6;
const MIN_AREA_RATIO = 0.05;
const MAX_AREA_RATIO = 20;

export function verifyOrb(query: OrbFeatures, ref: OrbFeatures, opts: VerifyOptions): VerifyResult {
  const minInliers = opts.minInliers ?? MIN_INLIERS;
  if (query.count < 4 || ref.count < 4) {
    return { matchCount: 0, inlierCount: 0, homography: null, corners: null, verified: false };
  }
  const matches = matchDescriptors(query, ref, opts);
  const { H, inlierCount } = ransacHomography(matches, query, ref, opts);
  if (H === null) {
    return {
      matchCount: matches.length,
      inlierCount,
      homography: null,
      corners: null,
      verified: false,
    };
  }
  const size = opts.inputSize;
  const corners: Point[] = [
    applyHomography(H, 0, 0),
    applyHomography(H, size, 0),
    applyHomography(H, size, size),
    applyHomography(H, 0, size),
  ];
  return {
    matchCount: matches.length,
    inlierCount,
    homography: Array.from(H),
    corners,
    verified: inlierCount >= minInliers && isSaneQuad(H, corners, size),
  };
}

function isSaneQuad(H: Float64Array, corners: Point[], inputSize: number): boolean {
  const determinant = H[0] * H[4] - H[1] * H[3];
  if (Math.abs(determinant) <= MIN_DETERMINANT) return false;
  if (!corners.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
  // Every turn must keep the reference square's winding; a mirrored or folded quad fails here.
  let twiceArea = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const [cx, cy] = corners[(i + 2) % 4];
    const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (turn <= 0) return false;
    twiceArea += ax * by - bx * ay;
  }
  const areaRatio = twiceArea / 2 / (inputSize * inputSize);
  return areaRatio >= MIN_AREA_RATIO && areaRatio <= MAX_AREA_RATIO;
}

import {
  applyHomography,
  isDegenerateSample,
  mulberry32,
  type Point,
  ransacHomography,
  solveHomography,
} from "./homography";
import type { Match } from "./match";
import { makeSyntheticPair } from "./test-fixtures";

const known = [1.1, 0.2, 30, -0.15, 0.95, -20, 2e-4, -1e-4, 1];
const square: Point[] = [
  [50, 60],
  [400, 80],
  [420, 450],
  [70, 380],
];

function maxReprojectionError(
  H: ArrayLike<number>,
  truth: ArrayLike<number>,
): number {
  let worst = 0;
  for (let x = 0; x <= 500; x += 100) {
    for (let y = 0; y <= 500; y += 100) {
      const [ex, ey] = applyHomography(truth, x, y);
      const [px, py] = applyHomography(H, x, y);
      worst = Math.max(worst, Math.hypot(px - ex, py - ey));
    }
  }
  return worst;
}

describe("solveHomography", () => {
  it("recovers a known homography from four exact correspondences", () => {
    const dst = square.map(([x, y]) => applyHomography(known, x, y));

    const H = solveHomography(square, dst);

    expect(H).not.toBeNull();
    expect(maxReprojectionError(H!, known)).toBeLessThan(1e-6);
  });

  it("returns null for collinear or coincident points", () => {
    const line: Point[] = [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
    ];
    const same: Point[] = [
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ];

    expect(
      solveHomography(
        line,
        line.map(([x, y]) => applyHomography(known, x, y)),
      ),
    ).toBeNull();
    expect(solveHomography(same, square)).toBeNull();
    expect(solveHomography(square.slice(0, 3), square.slice(0, 3))).toBeNull();
  });
});

describe("applyHomography", () => {
  it("returns NaN for a point that projects to infinity", () => {
    const [x, y] = applyHomography([1, 0, 0, 0, 1, 0, 0, 0, 0], 3, 4);

    expect(Number.isNaN(x)).toBe(true);
    expect(Number.isNaN(y)).toBe(true);
  });
});

describe("isDegenerateSample", () => {
  it("flags three collinear points and duplicates, accepts a general quadrilateral", () => {
    expect(isDegenerateSample(square)).toBe(false);
    expect(
      isDegenerateSample([
        [0, 0],
        [100, 100],
        [200, 200],
        [50, 300],
      ]),
    ).toBe(true);
    expect(
      isDegenerateSample([
        [0, 0],
        [0, 0],
        [200, 30],
        [50, 300],
      ]),
    ).toBe(true);
  });
});

function matchesWithOutliers(seed: number, outlierFraction: number) {
  const pair = makeSyntheticPair({ seed, noiseSigma: 1 });
  const matches: Match[] = pair.truth.correspondences.map(
    ([refIdx, queryIdx]) => ({
      queryIdx,
      refIdx,
      distance: 10,
    }),
  );
  const rand = mulberry32(seed + 1000);
  const outliers = Math.round(
    (matches.length * outlierFraction) / (1 - outlierFraction),
  );
  for (let i = 0; i < outliers; i++) {
    matches.push({
      queryIdx: Math.floor(rand() * pair.query.count),
      refIdx: Math.floor(rand() * pair.ref.count),
      distance: 40,
    });
  }
  return { ...pair, matches, trueCount: pair.truth.correspondences.length };
}

describe("ransacHomography", () => {
  it("recovers the homography under 30% outliers and 1 px noise", () => {
    const { ref, query, matches, truth, trueCount } = matchesWithOutliers(
      5,
      0.3,
    );

    const result = ransacHomography(matches, query, ref, { seed: 1 });

    expect(result.H).not.toBeNull();
    expect(result.inlierCount).toBeGreaterThanOrEqual(0.9 * trueCount);
    expect(maxReprojectionError(result.H!, truth.H)).toBeLessThan(2);
    let totalError = 0;
    for (let i = 0; i < matches.length; i++) {
      if (!result.inlierMask[i]) continue;
      const m = matches[i];
      const r = m.refIdx * 4;
      const q = m.queryIdx * 4;
      const [px, py] = applyHomography(
        result.H!,
        ref.keypoints[r],
        ref.keypoints[r + 1],
      );
      totalError += Math.hypot(
        px - query.keypoints[q],
        py - query.keypoints[q + 1],
      );
    }
    expect(totalError / result.inlierCount).toBeLessThan(2);
  });

  it("is byte-identical across runs with the same seed", () => {
    const { ref, query, matches } = matchesWithOutliers(6, 0.3);

    const first = ransacHomography(matches, query, ref, { seed: 21 });
    const second = ransacHomography(matches, query, ref, { seed: 21 });

    expect(Array.from(first.H!)).toEqual(Array.from(second.H!));
    expect(Array.from(first.inlierMask)).toEqual(Array.from(second.inlierMask));
    expect(first.iterations).toBe(second.iterations);
  });

  it("returns a null homography for fewer than four matches without throwing", () => {
    const { ref, query, matches } = matchesWithOutliers(7, 0);

    const result = ransacHomography(matches.slice(0, 3), query, ref);

    expect(result).toEqual({
      H: null,
      inlierMask: new Uint8Array(3),
      inlierCount: 0,
      iterations: 0,
    });
  });

  it("finds only a handful of inliers among unrelated matches", () => {
    const { ref, query } = makeSyntheticPair({ seed: 8, count: 200 });
    const rand = mulberry32(9);
    const matches: Match[] = Array.from({ length: 100 }, () => ({
      queryIdx: Math.floor(rand() * query.count),
      refIdx: Math.floor(rand() * ref.count),
      distance: 30,
    }));

    const result = ransacHomography(matches, query, ref);

    expect(result.inlierCount).toBeLessThan(10);
  });
});

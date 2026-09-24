import { applyHomography, mulberry32 } from "./homography";
import { makeRandomFeatures, makeSyntheticPair } from "./test-fixtures";
import { verifyOrb } from "./verify";

const inputSize = 512;

describe("verifyOrb", () => {
  it("verifies a synthetic positive pair and projects the corners within 3 px of the truth", () => {
    const { ref, query, truth } = makeSyntheticPair({ seed: 11, inputSize });

    const result = verifyOrb(query, ref, { inputSize, seed: 1 });

    expect(result.verified).toBe(true);
    expect(result.inlierCount).toBeGreaterThanOrEqual(15);
    expect(result.homography).toHaveLength(9);
    const expected = [
      [0, 0],
      [inputSize, 0],
      [inputSize, inputSize],
      [0, inputSize],
    ].map(([x, y]) => applyHomography(truth.H, x, y));
    result.corners!.forEach(([x, y], i) => {
      expect(Math.hypot(x - expected[i][0], y - expected[i][1])).toBeLessThan(
        3,
      );
    });
  });

  it("does not verify an unrelated pair", () => {
    const a = makeSyntheticPair({ seed: 12, inputSize }).ref;
    const b = makeSyntheticPair({ seed: 13, inputSize }).ref;

    const result = verifyOrb(a, b, { inputSize });

    expect(result.inlierCount).toBeLessThan(8);
    expect(result.verified).toBe(false);
  });

  it("returns an empty unverified result for fewer than four keypoints without throwing", () => {
    const rand = mulberry32(14);
    const tiny = makeRandomFeatures(rand, 3, inputSize);
    const full = makeRandomFeatures(rand, 50, inputSize);

    const result = verifyOrb(tiny, full, { inputSize });

    expect(result).toEqual({
      matchCount: 0,
      inlierCount: 0,
      homography: null,
      corners: null,
      verified: false,
    });
    expect(verifyOrb(full, tiny, { inputSize }).verified).toBe(false);
  });

  it("rejects a mirrored homography even with many inliers", () => {
    const mirrored = [-1, 0, inputSize, 0, 1, 0, 0, 0, 1];
    const { ref, query } = makeSyntheticPair({
      seed: 15,
      inputSize,
      homography: mirrored,
    });

    const result = verifyOrb(query, ref, { inputSize });

    expect(result.inlierCount).toBeGreaterThanOrEqual(15);
    expect(result.verified).toBe(false);
  });

  it("rejects a homography whose projected quad is too small", () => {
    const shrunk = [0.1, 0, 0, 0, 0.1, 0, 0, 0, 1];
    const { ref, query } = makeSyntheticPair({
      seed: 16,
      inputSize,
      homography: shrunk,
    });

    const result = verifyOrb(query, ref, { inputSize });

    expect(result.inlierCount).toBeGreaterThanOrEqual(15);
    expect(result.verified).toBe(false);
  });

  it("honours minInliers", () => {
    const { ref, query } = makeSyntheticPair({ seed: 17, inputSize });

    const strict = verifyOrb(query, ref, { inputSize, minInliers: 10_000 });
    const lenient = verifyOrb(query, ref, { inputSize, minInliers: 4 });

    expect(strict.verified).toBe(false);
    expect(lenient.verified).toBe(true);
    expect(strict.inlierCount).toBe(lenient.inlierCount);
  });
});

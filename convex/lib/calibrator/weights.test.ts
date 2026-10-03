import { describe, expect, it } from "vitest";

import { scoreCandidates } from "./calibrate";
import { type CandidateSignals, FEATURE_NAMES } from "./features";
import { DEFAULT_CALIBRATOR } from "./weights";

function probability(signals: CandidateSignals): number {
  return scoreCandidates([{ candidate: "x", signals }], DEFAULT_CALIBRATOR)[0].probability;
}

describe("DEFAULT_CALIBRATOR", () => {
  it("names every feature in FEATURE_NAMES order with one weight each", () => {
    expect(DEFAULT_CALIBRATOR.featureNames).toEqual(FEATURE_NAMES);
    expect(DEFAULT_CALIBRATOR.weights).toHaveLength(FEATURE_NAMES.length);
  });

  it("keeps the confident threshold at or above the soft threshold", () => {
    expect(DEFAULT_CALIBRATOR.thresholds.confident).toBeGreaterThanOrEqual(DEFAULT_CALIBRATOR.thresholds.soft);
  });

  it("scores the strong anchor above 0.99", () => {
    expect(
      probability({
        similarity: 0.9,
        runnerUpSimilarity: 0.8,
        atVenue: true,
        venueKnown: true,
        gallery: "same",
        onView: true,
        keypointCount: 300,
        orbInliers: 40,
        homographyValid: true,
        runnerUpInliers: 0,
        objectPenalty: 0,
      }),
    ).toBeGreaterThan(0.99);
  });

  it("scores an ambiguous, geometrically unverified match below the miss threshold", () => {
    expect(
      probability({
        similarity: 0.75,
        runnerUpSimilarity: 0.745,
        atVenue: false,
        venueKnown: false,
        gallery: "unknown",
        onView: null,
        keypointCount: 300,
        orbInliers: 5,
        homographyValid: false,
        runnerUpInliers: 0,
        objectPenalty: 0,
      }),
    ).toBeLessThan(DEFAULT_CALIBRATOR.thresholds.soft);
  });
});

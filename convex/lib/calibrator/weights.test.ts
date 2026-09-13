import { describe, expect, it } from 'vitest';

import { scoreCandidates } from './calibrate';
import { type CandidateSignals, FEATURE_NAMES } from './features';
import { CALIBRATOR_V2, DEFAULT_CALIBRATOR } from './weights';

function probability(signals: CandidateSignals): number {
  return scoreCandidates([{ candidate: 'x', signals }], CALIBRATOR_V2)[0].probability;
}

describe('CALIBRATOR_V2', () => {
  it('names every feature in FEATURE_NAMES order with one weight each', () => {
    expect(CALIBRATOR_V2.featureNames).toEqual(FEATURE_NAMES);
    expect(CALIBRATOR_V2.weights).toHaveLength(FEATURE_NAMES.length);
    expect(DEFAULT_CALIBRATOR).toBe(CALIBRATOR_V2);
  });

  it('keeps the confident threshold at or above the soft threshold', () => {
    expect(CALIBRATOR_V2.thresholds.confident).toBeGreaterThanOrEqual(CALIBRATOR_V2.thresholds.soft);
  });

  it('scores the strong anchor above 0.99', () => {
    expect(
      probability({
        similarity: 0.9,
        runnerUpSimilarity: 0.8,
        candidateCount: 20,
        atVenue: true,
        gallery: 'same',
        onView: true,
        keypointCount: 300,
        orbInliers: 40,
        homographyValid: true,
        objectPenalty: 0,
      })
    ).toBeGreaterThan(0.99);
  });

  it('scores an ambiguous, geometrically unverified match below the miss threshold', () => {
    expect(
      probability({
        similarity: 0.75,
        runnerUpSimilarity: 0.745,
        candidateCount: 20,
        atVenue: false,
        gallery: 'unknown',
        onView: null,
        keypointCount: 300,
        orbInliers: 5,
        homographyValid: false,
        objectPenalty: 0,
      })
    ).toBeLessThan(CALIBRATOR_V2.thresholds.soft);
  });
});

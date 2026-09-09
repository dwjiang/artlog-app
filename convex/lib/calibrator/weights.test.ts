import { describe, expect, it } from 'vitest';

import { scoreCandidates } from './calibrate';
import { type CandidateSignals, FEATURE_NAMES } from './features';
import { CALIBRATOR_V1, DEFAULT_CALIBRATOR } from './weights';

function probability(signals: CandidateSignals): number {
  return scoreCandidates([{ candidate: 'x', signals }], CALIBRATOR_V1)[0].probability;
}

describe('CALIBRATOR_V1', () => {
  it('names every feature in FEATURE_NAMES order with one weight each', () => {
    expect(CALIBRATOR_V1.featureNames).toEqual(FEATURE_NAMES);
    expect(CALIBRATOR_V1.weights).toHaveLength(FEATURE_NAMES.length);
    expect(DEFAULT_CALIBRATOR).toBe(CALIBRATOR_V1);
  });

  it('keeps the confident threshold above the soft threshold', () => {
    expect(CALIBRATOR_V1.thresholds.confident).toBeGreaterThan(CALIBRATOR_V1.thresholds.soft);
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

  it('scores the weak anchor below 0.2', () => {
    expect(
      probability({
        similarity: 0.75,
        runnerUpSimilarity: 0.73,
        candidateCount: 20,
        atVenue: false,
        gallery: 'unknown',
        onView: null,
        keypointCount: 300,
        orbInliers: 5,
        homographyValid: false,
        objectPenalty: 0,
      })
    ).toBeLessThan(0.2);
  });
});

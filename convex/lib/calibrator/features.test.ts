import { describe, expect, it } from "vitest";

import pythonFixture from "../../../shared/calibrator/fixtures/calibrator-features.json";
import { type CandidateSignals, FEATURE_NAMES, featureIndex, featurize } from "./features";

const zeroSignals: CandidateSignals = {
  similarity: 0,
  runnerUpSimilarity: 0,
  atVenue: false,
  venueKnown: false,
  gallery: "unknown",
  onView: null,
  keypointCount: 0,
  orbInliers: 0,
  homographyValid: false,
  runnerUpInliers: 0,
  objectPenalty: 0,
};

function single(overrides: Partial<CandidateSignals>): Float64Array {
  return featurize({ ...zeroSignals, ...overrides });
}

function expectOnly(features: Float64Array, name: (typeof FEATURE_NAMES)[number], value: number) {
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    const expected = FEATURE_NAMES[i] === name ? value : 0;
    expect(features[i], FEATURE_NAMES[i]).toBeCloseTo(expected, 12);
  }
}

describe("featurize", () => {
  it("matches every feature emitted by the Python training job", () => {
    expect(pythonFixture).toHaveLength(12);
    for (const row of pythonFixture) {
      const actual = featurize(row.signals as CandidateSignals);
      expect(row.expectedFeatures).toHaveLength(FEATURE_NAMES.length);
      row.expectedFeatures.forEach((expected, i) => {
        expect(actual[i], FEATURE_NAMES[i]).toBeCloseTo(expected, 12);
      });
    }
  });

  it("returns one slot per FEATURE_NAMES entry and all zeros for empty signals", () => {
    const features = featurize(zeroSignals);
    expect(features).toHaveLength(FEATURE_NAMES.length);
    expect(Array.from(features)).toEqual(Array.from(FEATURE_NAMES, () => 0));
  });

  it("places each signal at the index of its FEATURE_NAMES entry", () => {
    expectOnly(single({ similarity: 0.7, runnerUpSimilarity: 0.7 }), "similarity", 0.7);
    expectOnly(single({ atVenue: true }), "atVenue", 1);
    expectOnly(single({ gallery: "same" }), "gallerySame", 1);
    expectOnly(single({ gallery: "different" }), "galleryDifferent", 1);
    expectOnly(single({ onView: true }), "onView", 1);
    expectOnly(single({ keypointCount: 300 }), "logKeypointCount", Math.log(301));
    expectOnly(single({ orbInliers: 40, runnerUpInliers: 40 }), "logInliers", Math.log(41));
    expectOnly(single({ venueKnown: true }), "venueKnown", 1);
    expectOnly(single({ homographyValid: true }), "homographyValid", 1);
    expectOnly(single({ objectPenalty: 0.25 }), "objectPenalty", 0.25);
  });

  it("derives margin as similarity minus runner-up, floored at zero", () => {
    const ahead = single({ similarity: 0.9, runnerUpSimilarity: 0.8 });
    expect(ahead[featureIndex("margin")]).toBeCloseTo(0.1, 12);

    const behind = single({ similarity: 0.8, runnerUpSimilarity: 0.9 });
    expect(behind[featureIndex("margin")]).toBe(0);
  });

  it("leads by the log ratio of inliers over the best other candidate, negative when behind", () => {
    expect(single({ orbInliers: 101, runnerUpInliers: 17 })[featureIndex("inlierLead")]).toBeCloseTo(
      Math.log(102 / 18),
      12,
    );
    expect(single({ orbInliers: 6, runnerUpInliers: 140 })[featureIndex("inlierLead")]).toBeCloseTo(
      Math.log(7 / 141),
      12,
    );
  });

  it("treats unknown gallery and unknown on-view state as zero in both slots", () => {
    const features = single({ gallery: "unknown", onView: null });
    expect(features[featureIndex("gallerySame")]).toBe(0);
    expect(features[featureIndex("galleryDifferent")]).toBe(0);
    expect(features[featureIndex("onView")]).toBe(0);
    expect(single({ onView: false })[featureIndex("onView")]).toBe(0);
  });

  it("clamps similarity and objectPenalty into [0, 1]", () => {
    expect(single({ similarity: 1.4 })[featureIndex("similarity")]).toBe(1);
    expect(single({ similarity: -0.2 })[featureIndex("similarity")]).toBe(0);
    expect(single({ objectPenalty: 7 })[featureIndex("objectPenalty")]).toBe(1);
    expect(single({ objectPenalty: -1 })[featureIndex("objectPenalty")]).toBe(0);
  });

  it("throws RangeError on non-finite or negative inputs", () => {
    expect(() => single({ similarity: Number.NaN })).toThrow(RangeError);
    expect(() => single({ runnerUpSimilarity: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => single({ keypointCount: Number.NaN })).toThrow(RangeError);
    expect(() => single({ orbInliers: -1 })).toThrow(RangeError);
    expect(() => single({ runnerUpInliers: -1 })).toThrow(RangeError);
    expect(() => single({ objectPenalty: Number.NaN })).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";

import { decide, scoreCandidates, sigmoid } from "./calibrate";
import { type CandidateSignals, featureIndex } from "./features";
import { DEFAULT_CALIBRATOR, type CalibratorConfig } from "./weights";

const strong: CandidateSignals = {
  similarity: 0.9,
  runnerUpSimilarity: 0.8,
  candidateCount: 20,
  atVenue: true,
  gallery: "same",
  onView: true,
  keypointCount: 300,
  orbInliers: 40,
  homographyValid: true,
  objectPenalty: 0,
};

function signals(overrides: Partial<CandidateSignals>): CandidateSignals {
  return { ...strong, ...overrides };
}

function probability(s: CandidateSignals, config?: CalibratorConfig): number {
  return scoreCandidates([{ candidate: "x", signals: s }], config)[0].probability;
}

function decideOne(s: CandidateSignals) {
  return decide(scoreCandidates([{ candidate: "x", signals: s }]));
}

describe("sigmoid", () => {
  it("maps 0 to 0.5 and is symmetric about it", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(3) + sigmoid(-3)).toBeCloseTo(1, 12);
    expect(sigmoid(50)).toBeCloseTo(1, 12);
  });
});

describe("scoreCandidates", () => {
  it("never lowers probability when similarity, margin or inliers rise", () => {
    const base = signals({ similarity: 0.8, runnerUpSimilarity: 0.78, orbInliers: 10 });
    for (const similarity of [0.82, 0.86, 0.9, 0.95]) {
      expect(probability(signals({ ...base, similarity }))).toBeGreaterThanOrEqual(
        probability(base),
      );
    }
    for (const runnerUpSimilarity of [0.75, 0.7, 0.5]) {
      expect(probability(signals({ ...base, runnerUpSimilarity }))).toBeGreaterThanOrEqual(
        probability(base),
      );
    }
    for (const orbInliers of [15, 30, 100]) {
      expect(probability(signals({ ...base, orbInliers }))).toBeGreaterThanOrEqual(
        probability(base),
      );
    }
  });

  it("never raises probability when the object penalty rises", () => {
    let previous = probability(signals({ objectPenalty: 0 }));
    for (const objectPenalty of [0.25, 0.5, 0.75, 1]) {
      const next = probability(signals({ objectPenalty }));
      expect(next).toBeLessThanOrEqual(previous);
      previous = next;
    }
  });

  it("treats an unknown gallery as neutral", () => {
    const galleryFree: CalibratorConfig = {
      ...DEFAULT_CALIBRATOR,
      weights: DEFAULT_CALIBRATOR.weights.map((w, i) =>
        i === featureIndex("gallerySame") || i === featureIndex("galleryDifferent") ? 0 : w,
      ),
    };
    const unknown = signals({ gallery: "unknown", similarity: 0.8, runnerUpSimilarity: 0.795 });
    expect(probability(unknown)).toBe(probability(unknown, galleryFree));
    expect(probability({ ...unknown, gallery: "same" })).toBeGreaterThan(probability(unknown));
  });

  it("blocks confidence for textured works without a homography or enough inliers", () => {
    const [noHomography] = scoreCandidates([
      { candidate: "x", signals: signals({ homographyValid: false, orbInliers: 40 }) },
    ]);
    expect(noHomography.eligibleForConfident).toBe(false);
    expect(noHomography.reasons).toEqual(["textured:no-homography"]);

    const [fewInliers] = scoreCandidates([
      { candidate: "x", signals: signals({ homographyValid: true, orbInliers: 14 }) },
    ]);
    expect(fewInliers.eligibleForConfident).toBe(false);
    expect(fewInliers.reasons).toEqual(["textured:few-inliers"]);

    const [ok] = scoreCandidates([{ candidate: "x", signals: signals({ orbInliers: 15 }) }]);
    expect(ok.eligibleForConfident).toBe(true);
    expect(ok.reasons).toEqual([]);
  });

  it("applies the stricter bar to low-texture works instead of the homography rule", () => {
    const lowTexture = signals({
      keypointCount: 40,
      homographyValid: false,
      orbInliers: 0,
      similarity: 0.96,
      runnerUpSimilarity: 0.9,
    });
    const [atVenue] = scoreCandidates([{ candidate: "x", signals: lowTexture }]);
    expect(atVenue.eligibleForConfident).toBe(true);

    const [offVenue] = scoreCandidates([
      { candidate: "x", signals: { ...lowTexture, atVenue: false } },
    ]);
    expect(offVenue.eligibleForConfident).toBe(false);
    expect(offVenue.reasons).toEqual(["low-texture:venue"]);

    const [weak] = scoreCandidates([
      {
        candidate: "x",
        signals: { ...lowTexture, similarity: 0.92, runnerUpSimilarity: 0.9, atVenue: false },
      },
    ]);
    expect(weak.reasons).toEqual([
      "low-texture:similarity",
      "low-texture:margin",
      "low-texture:venue",
    ]);
  });

  it("sorts by probability and breaks ties by similarity", () => {
    const scored = scoreCandidates([
      { candidate: "weak", signals: signals({ similarity: 0.7, runnerUpSimilarity: 0.69 }) },
      { candidate: "strong", signals: strong },
      { candidate: "middle", signals: signals({ similarity: 0.8, runnerUpSimilarity: 0.79 }) },
    ]);
    expect(scored.map((s) => s.candidate)).toEqual(["strong", "middle", "weak"]);

    const flat: CalibratorConfig = {
      ...DEFAULT_CALIBRATOR,
      weights: DEFAULT_CALIBRATOR.weights.map(() => 0),
    };
    const tied = scoreCandidates(
      [
        { candidate: "lower", signals: signals({ similarity: 0.7 }) },
        { candidate: "higher", signals: signals({ similarity: 0.9 }) },
      ],
      flat,
    );
    expect(tied.map((s) => s.candidate)).toEqual(["higher", "lower"]);
  });

  it("rejects a config whose weight count does not match the feature vector", () => {
    const short: CalibratorConfig = { ...DEFAULT_CALIBRATOR, weights: [1, 2, 3] };
    expect(() => scoreCandidates([{ candidate: "x", signals: strong }], short)).toThrow(RangeError);
  });
});

describe("decide", () => {
  it.each([null, 0, 40])(
    "distinguishes unknown reference texture from measured low texture (%s)",
    (keypointCount) => {
      const decision = decideOne(
        signals({
          keypointCount,
          similarity: 0.99,
          runnerUpSimilarity: 0.8,
          homographyValid: false,
          orbInliers: 0,
        }),
      );
      expect(decision.best?.probability).toBeGreaterThan(DEFAULT_CALIBRATOR.thresholds.confident);
      expect(decision.outcome).toBe(keypointCount === null ? "soft" : "confident");
    },
  );

  it("returns confident for a strong, eligible best candidate", () => {
    const decision = decideOne(strong);
    expect(decision.outcome).toBe("confident");
    expect(decision.best?.candidate).toBe("x");
    expect(decision.calibratorVersion).toBe(DEFAULT_CALIBRATOR.version);
  });

  it("downgrades a high-probability textured candidate without a homography to soft", () => {
    const decision = decideOne(signals({ homographyValid: false }));
    expect(decision.best?.probability).toBeGreaterThan(0.95);
    expect(decision.outcome).toBe("soft");
    expect(decision.best?.reasons).toEqual(["textured:no-homography"]);
  });

  it("never returns confident without eligibility across a sweep of signals", () => {
    for (const similarity of [0.7, 0.85, 0.93, 0.97])
      for (const keypointCount of [20, 300])
        for (const homographyValid of [true, false])
          for (const orbInliers of [0, 10, 40])
            for (const atVenue of [true, false]) {
              const decision = decideOne(
                signals({
                  similarity,
                  runnerUpSimilarity: similarity - 0.05,
                  keypointCount,
                  homographyValid,
                  orbInliers,
                  atVenue,
                }),
              );
              if (decision.outcome === "confident")
                expect(decision.best?.eligibleForConfident).toBe(true);
            }
  });

  it("returns miss with the best candidate still attached when it falls under the soft threshold", () => {
    const decision = decideOne(
      signals({
        similarity: 0.7,
        runnerUpSimilarity: 0.69,
        atVenue: false,
        gallery: "unknown",
        orbInliers: 3,
        homographyValid: false,
      }),
    );
    expect(decision.best?.probability).toBeLessThan(DEFAULT_CALIBRATOR.thresholds.soft);
    expect(decision.outcome).toBe("miss");
    expect(decision.best?.candidate).toBe("x");
  });

  it("returns miss with no best for an empty candidate set", () => {
    expect(decide([])).toEqual({
      outcome: "miss",
      best: null,
      runnerUps: [],
      calibratorVersion: DEFAULT_CALIBRATOR.version,
    });
  });

  it("lists the remaining candidates as runner-ups, capped at five", () => {
    const items = [0.95, 0.9, 0.85, 0.8, 0.75].map((similarity, i) => ({
      candidate: `c${i}`,
      signals: signals({ similarity, runnerUpSimilarity: similarity - 0.05 }),
    }));
    const five = decide(scoreCandidates(items));
    expect(five.best?.candidate).toBe("c0");
    expect(five.runnerUps.map((r) => r.candidate)).toEqual(["c1", "c2", "c3", "c4"]);
    for (let i = 1; i < five.runnerUps.length; i++) {
      expect(five.runnerUps[i].probability).toBeLessThanOrEqual(five.runnerUps[i - 1].probability);
    }

    const eight = decide(scoreCandidates([...items, ...items.slice(0, 3)]));
    expect(eight.runnerUps).toHaveLength(5);
  });

  it("is deterministic for identical inputs", () => {
    const items = [
      { candidate: { id: "a" }, signals: strong },
      { candidate: { id: "b" }, signals: signals({ similarity: 0.8, homographyValid: false }) },
    ];
    expect(decide(scoreCandidates(items))).toEqual(decide(scoreCandidates(items)));
  });
});

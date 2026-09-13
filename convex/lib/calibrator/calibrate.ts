import type { MatchOutcome } from '../validators';
import { type CandidateSignals, FEATURE_NAMES, featureIndex, featurize } from './features';
import { type CalibratorConfig, DEFAULT_CALIBRATOR } from './weights';

export type ScoredCandidate<T> = {
  candidate: T;
  probability: number;
  features: Float64Array;
  /** Required evidence is satisfied independently of the probability threshold for a confident match. */
  eligibleForConfident: boolean;
  reasons: string[];
};

export type Decision<T> = {
  outcome: MatchOutcome;
  best: ScoredCandidate<T> | null;
  /** The remaining candidates by probability, at most five. */
  runnerUps: ScoredCandidate<T>[];
  calibratorVersion: string;
};

const SIMILARITY = featureIndex('similarity');
const MARGIN = featureIndex('margin');

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function scoreCandidates<T>(
  items: { candidate: T; signals: CandidateSignals }[],
  config: CalibratorConfig = DEFAULT_CALIBRATOR
): ScoredCandidate<T>[] {
  if (config.weights.length !== FEATURE_NAMES.length) {
    throw new RangeError(
      `calibrator ${config.version} has ${config.weights.length} weights for ${FEATURE_NAMES.length} features`
    );
  }
  const scored = items.map(({ candidate, signals }) => {
    const features = featurize(signals);
    let logit = config.bias;
    for (let i = 0; i < features.length; i++) logit += config.weights[i] * features[i];
    const reasons = confidenceBlockers(signals, features, config);
    return {
      candidate,
      probability: sigmoid(logit),
      features,
      eligibleForConfident: reasons.length === 0,
      reasons,
    };
  });
  scored.sort(
    (a, b) => b.probability - a.probability || b.features[SIMILARITY] - a.features[SIMILARITY]
  );
  return scored;
}

export function decide<T>(
  scored: ScoredCandidate<T>[],
  config: CalibratorConfig = DEFAULT_CALIBRATOR
): Decision<T> {
  const best = scored[0] ?? null;
  let outcome: MatchOutcome = 'miss';
  if (best !== null) {
    if (best.probability >= config.thresholds.confident && best.eligibleForConfident) {
      outcome = 'confident';
    } else if (best.probability >= config.thresholds.soft) {
      outcome = 'soft';
    }
  }
  return { outcome, best, runnerUps: scored.slice(1, 6), calibratorVersion: config.version };
}

function confidenceBlockers(
  signals: CandidateSignals,
  features: Float64Array,
  config: CalibratorConfig
): string[] {
  if (signals.keypointCount === null) return ['reference:unknown-texture'];
  const reasons: string[] = [];
  if (signals.keypointCount >= config.lowTextureKeypoints) {
    if (!signals.homographyValid) reasons.push('textured:no-homography');
    else if (signals.orbInliers < config.textured.minInliers) reasons.push('textured:few-inliers');
    return reasons;
  }
  if (features[SIMILARITY] < config.lowTexture.minSimilarity) reasons.push('low-texture:similarity');
  if (features[MARGIN] < config.lowTexture.minMargin) reasons.push('low-texture:margin');
  if (config.lowTexture.requireVenueAgreement && !signals.atVenue) reasons.push('low-texture:venue');
  return reasons;
}

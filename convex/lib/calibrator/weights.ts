import { FEATURE_NAMES } from './features';

export type CalibratorConfig = {
  version: string;
  /** Must equal FEATURE_NAMES; weights[i] applies to featurize()[i]. */
  featureNames: readonly string[];
  weights: readonly number[];
  bias: number;
  thresholds: { confident: number; soft: number };
  /** keypointCount below this → the low-texture rule applies instead of the textured one. */
  lowTextureKeypoints: number;
  textured: { minInliers: number };
  lowTexture: { minSimilarity: number; minMargin: number; requireVenueAgreement: boolean };
};

// These weights are priors, not trained values; plan 02.09's training job replaces them as CALIBRATOR_V2.
export const CALIBRATOR_V1: CalibratorConfig = {
  version: 'lr-v1',
  featureNames: FEATURE_NAMES,
  weights: [12.0, 20.0, -0.3, 1.2, 0.8, -0.4, 0.3, 0.1, 1.5, 1.5, -3.0],
  bias: -14.0,
  thresholds: { confident: 0.85, soft: 0.45 },
  lowTextureKeypoints: 80,
  textured: { minInliers: 15 },
  lowTexture: { minSimilarity: 0.93, minMargin: 0.04, requireVenueAgreement: true },
};

export const DEFAULT_CALIBRATOR: CalibratorConfig = CALIBRATOR_V1;

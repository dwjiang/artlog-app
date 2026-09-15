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

export const DEFAULT_CALIBRATOR: CalibratorConfig = {
  version: 'lr-v2',
  featureNames: FEATURE_NAMES,
  weights: [
    7.474195072142699,
    383.78817433584715,
    -4.045085586473862,
    2.778795932765667,
    2.470154752909581,
    -0.2672894750022002,
    -0.46764532924772256,
    -0.7245000823878253,
    0.7926605931130953,
    4.306513855067736,
    0.0,
  ],
  bias: 1.5125644129619618,
  thresholds: { confident: 0.13716605621132733, soft: 0.13716605621132733 },
  lowTextureKeypoints: 80,
  textured: { minInliers: 15 },
  lowTexture: { minSimilarity: 0.93, minMargin: 0.04, requireVenueAgreement: true },
};

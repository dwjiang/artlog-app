import { FEATURE_NAMES } from "./features";

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
  lowTexture: {
    minSimilarity: number;
    minMargin: number;
    requireVenueAgreement: boolean;
  };
};

export const DEFAULT_CALIBRATOR: CalibratorConfig = {
  version: "lr-v3",
  featureNames: FEATURE_NAMES,
  weights: [
    9.964552969642448, 63.99188036364444, -2.5067714436639688, 3.386658386779764, 2.9272590186087193,
    -0.9509585139408095, -0.20729480483641005, -1.1746108830729953, 1.2476475811822216, 3.5361522959629523, 0.0,
  ],
  bias: -3.069621449191029,
  thresholds: { confident: 0.5992237307436383, soft: 0.5992237307436383 },
  lowTextureKeypoints: 80,
  textured: { minInliers: 15 },
  lowTexture: {
    minSimilarity: 0.8,
    minMargin: 0.08,
    requireVenueAgreement: true,
  },
};

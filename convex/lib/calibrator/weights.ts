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
  version: "lr-v4",
  featureNames: FEATURE_NAMES,
  weights: [
    5.705885296322579, 28.094536322542147, 3.4477786704512035, 2.5650970456403672, -0.033821673992878803,
    0.5233765029664943, -1.002825663909017, -0.5502078313284687, 7.785643722440095, 0.0, -1.8437405404573937,
    1.366597179394577,
  ],
  bias: -1.4050739793275966,
  thresholds: { confident: 0.9247046957941564, soft: 0.9247046957941564 },
  lowTextureKeypoints: 80,
  textured: { minInliers: 15 },
  lowTexture: {
    minSimilarity: 0.8,
    minMargin: 0.08,
    requireVenueAgreement: true,
  },
};

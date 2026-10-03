export type GalleryRelation = "same" | "different" | "unknown";

export type CandidateSignals = {
  /** Cosine similarity from vector search, 0..1. */
  similarity: number;
  /** Similarity of the next-best different object, or 0 when there is none. */
  runnerUpSimilarity: number;
  /** The candidate's current placement venue is the scan's venue. */
  atVenue: boolean;
  /** The scan has a venue, so a candidate elsewhere is evidence against it rather than missing context. */
  venueKnown: boolean;
  /** Candidate gallery versus the visit's last confident gallery. */
  gallery: GalleryRelation;
  /** null when the placement does not say. */
  onView: boolean | null;
  keypointCount: number | null;
  /** ORB inlier count; 0 when verification was skipped. */
  orbInliers: number;
  /** ORB verification found a consistent homography. */
  homographyValid: boolean;
  /** Most ORB inliers among the other candidates; 0 when none was verified. */
  runnerUpInliers: number;
  /** Combined corpus and rejection penalties, 0..1. */
  objectPenalty: number;
};

export const FEATURE_NAMES = [
  "similarity",
  "margin",
  "atVenue",
  "gallerySame",
  "galleryDifferent",
  "onView",
  "logKeypointCount",
  "logInliers",
  "homographyValid",
  "objectPenalty",
  "venueKnown",
  "inlierLead",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export function featureIndex(name: FeatureName): number {
  return FEATURE_NAMES.indexOf(name);
}

export function featurize(s: CandidateSignals): Float64Array {
  const similarity = clampUnit(s.similarity, "similarity");
  const runnerUpSimilarity = requireFinite(s.runnerUpSimilarity, "runnerUpSimilarity");
  const keypointCount = requireCount(s.keypointCount ?? 0, "keypointCount");
  const orbInliers = requireCount(s.orbInliers, "orbInliers");
  const runnerUpInliers = requireCount(s.runnerUpInliers, "runnerUpInliers");
  const objectPenalty = clampUnit(s.objectPenalty, "objectPenalty");

  const features = new Float64Array(FEATURE_NAMES.length);
  features[featureIndex("similarity")] = similarity;
  features[featureIndex("margin")] = Math.max(0, similarity - runnerUpSimilarity);
  features[featureIndex("atVenue")] = s.atVenue ? 1 : 0;
  features[featureIndex("gallerySame")] = s.gallery === "same" ? 1 : 0;
  features[featureIndex("galleryDifferent")] = s.gallery === "different" ? 1 : 0;
  features[featureIndex("onView")] = s.onView === true ? 1 : 0;
  features[featureIndex("logKeypointCount")] = Math.log1p(keypointCount);
  features[featureIndex("logInliers")] = Math.log1p(orbInliers);
  features[featureIndex("homographyValid")] = s.homographyValid ? 1 : 0;
  features[featureIndex("objectPenalty")] = objectPenalty;
  features[featureIndex("venueKnown")] = s.venueKnown ? 1 : 0;
  features[featureIndex("inlierLead")] = Math.log1p(orbInliers) - Math.log1p(runnerUpInliers);
  return features;
}

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`);
  }
  return value;
}

function requireCount(value: number, name: string): number {
  if (requireFinite(value, name) < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
  return value;
}

function clampUnit(value: number, name: string): number {
  return Math.min(1, Math.max(0, requireFinite(value, name)));
}

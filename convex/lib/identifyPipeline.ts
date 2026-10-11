import { decodeOrbFeatures, type OrbFeatures } from "../../shared/orb/features";
import { verifyOrb, type VerifyResult } from "../../shared/orb/verify";
import type { Doc, Id } from "../_generated/dataModel";
import { decide, scoreCandidates, type Decision } from "./calibrator/calibrate";
import type { GalleryRelation } from "./calibrator/features";
import { DEFAULT_CALIBRATOR, type CalibratorConfig } from "./calibrator/weights";
import { effectiveObjectPenalty } from "./rejectionPenalty";

const GALLERY_TTL_MS = 15 * 60_000;
export const MAX_ORB_VERIFICATIONS = 10;
/** Candidates scoring sees: the pool calibrator training retrieves, so margins and inlier leads mean the same here. */
export const MAX_CANDIDATES = 32;

/** Everything scoring reads, so an offline package can ship these fields instead of whole documents. */
export type PipelineCandidate = {
  object: Pick<Doc<"objects">, "_id" | "identityStatus" | "ownerId" | "calibratorPenalty" | "rejectionPenalty">;
  artwork: Pick<Doc<"artworks">, "_id">;
  placement: Pick<Doc<"placements">, "venueId" | "gallery" | "onView"> | null;
  similarity: number;
  keypointCount: number | null;
  inputSize?: number;
  descriptors?: ArrayBuffer;
  keypoints?: ArrayBuffer;
};

type PipelineInput<T extends PipelineCandidate> = {
  query: OrbFeatures;
  candidates: T[];
  venueId?: string;
  visit?: { lastConfidentGallery?: string; lastConfidentAt?: number };
  now: number;
  inputSize: number;
  config?: CalibratorConfig;
};
type PipelineResult<T> = {
  decision: Decision<T>;
  verifications: Map<Id<"objects">, VerifyResult>;
};

function runPartition<T extends PipelineCandidate>(input: PipelineInput<T>): PipelineResult<T> {
  const candidates = [...input.candidates].sort((a, b) => b.similarity - a.similarity);
  const verifications = new Map<Id<"objects">, VerifyResult>();
  const lastAt = input.visit?.lastConfidentAt;
  const lastGallery = input.visit?.lastConfidentGallery;
  const recentGallery = lastAt !== undefined && input.now >= lastAt && input.now - lastAt <= GALLERY_TTL_MS;

  for (const candidate of candidates) {
    if (verifications.size === MAX_ORB_VERIFICATIONS) break;
    if (candidate.descriptors && candidate.keypoints) {
      const reference = decodeOrbFeatures(candidate.descriptors, candidate.keypoints);
      verifications.set(
        candidate.object._id,
        verifyOrb(input.query, reference, {
          inputSize: candidate.inputSize ?? input.inputSize,
        }),
      );
    }
  }

  const scored = scoreCandidates(
    candidates.map((candidate) => {
      const verification = verifications.get(candidate.object._id);
      const atVenue = input.venueId !== undefined && candidate.placement?.venueId === input.venueId;
      const candidateGallery = candidate.placement?.gallery;
      const gallery: GalleryRelation =
        recentGallery && lastGallery !== undefined && candidateGallery !== undefined && atVenue
          ? candidateGallery === lastGallery
            ? "same"
            : "different"
          : "unknown";
      let runnerUpInliers = 0;
      for (const [objectId, other] of verifications) {
        if (objectId !== candidate.object._id) runnerUpInliers = Math.max(runnerUpInliers, other.inlierCount);
      }
      return {
        candidate,
        signals: {
          similarity: candidate.similarity,
          runnerUpSimilarity: candidates.find((other) => other.object._id !== candidate.object._id)?.similarity ?? 0,
          atVenue,
          venueKnown: input.venueId !== undefined,
          gallery,
          onView: candidate.placement?.onView ?? null,
          keypointCount: candidate.keypointCount,
          orbInliers: verification?.inlierCount ?? 0,
          homographyValid: verification?.verified ?? false,
          runnerUpInliers,
          objectPenalty: effectiveObjectPenalty(candidate.object),
        },
      };
    }),
    input.config,
  );
  const decision = decide(scored, input.config);
  const { best } = decision;
  if (
    decision.outcome === "confident"
    && best?.candidate.object.identityStatus === "established"
    && scored.some(
      (other) =>
        other.candidate.artwork._id !== best.candidate.artwork._id
        && other.eligibleForConfident
        && other.probability >= (input.config ?? DEFAULT_CALIBRATOR).thresholds.confident,
    )
  ) {
    // Geometry can verify copies of a composition without resolving their catalogue identity.
    decision.outcome = "soft";
    best.eligibleForConfident = false;
    best.reasons.push("identity:ambiguous");
  }
  return { decision, verifications };
}

export function runPipeline<T extends PipelineCandidate>(input: PipelineInput<T>): PipelineResult<T> {
  const established = runPartition({
    ...input,
    candidates: input.candidates.filter((c) => c.object.identityStatus === "established"),
  });
  const tentative = runPartition({
    ...input,
    candidates: input.candidates.filter(
      (c) =>
        c.object.identityStatus === "tentative" && input.venueId !== undefined && c.object.ownerId === input.venueId,
    ),
  });
  const verifications = new Map([...established.verifications, ...tentative.verifications]);
  if (
    established.decision.outcome === "confident"
    || established.decision.best?.reasons.includes("identity:ambiguous")
  ) {
    return { ...established, verifications };
  }
  const verified = [tentative.decision.best, ...tentative.decision.runnerUps].filter(
    (c): c is NonNullable<typeof c> =>
      !!c && c.eligibleForConfident && tentative.verifications.get(c.candidate.object._id)?.verified === true,
  );
  const suggestion = decide(verified, input.config);
  if (suggestion.outcome === "miss") return { ...established, verifications };
  // Established candidates stay on the card so a wrong visitor label cannot hide the corpus entry.
  const runnerUps = [...suggestion.runnerUps, established.decision.best, ...established.decision.runnerUps]
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .slice(0, 5);
  return {
    decision: { ...suggestion, outcome: "soft", runnerUps },
    verifications,
  };
}

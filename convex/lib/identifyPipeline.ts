import type { Id } from '../_generated/dataModel';
import type { LoadedCandidate } from '../identify';
import { decide, scoreCandidates, type Decision } from './calibrator/calibrate';
import type { GalleryRelation } from './calibrator/features';
import type { CalibratorConfig } from './calibrator/weights';
import { decodeOrbFeatures, type OrbFeatures } from '../../shared/orb/features';
import { verifyOrb, type VerifyResult } from '../../shared/orb/verify';
import { effectiveObjectPenalty } from './rejectionPenalty';

const GALLERY_TTL_MS = 15 * 60_000;
export const MAX_ORB_VERIFICATIONS = 10;

export function runPipeline(input: {
  query: OrbFeatures;
  candidates: LoadedCandidate[];
  venueId?: string;
  visit?: { lastConfidentGallery?: string; lastConfidentAt?: number };
  now: number;
  inputSize: number;
  config?: CalibratorConfig;
}): { decision: Decision<LoadedCandidate>; verifications: Map<Id<'objects'>, VerifyResult> } {
  const candidates = [...input.candidates].sort((a, b) => b.similarity - a.similarity);
  const verifications = new Map<Id<'objects'>, VerifyResult>();
  const lastAt = input.visit?.lastConfidentAt;
  const lastGallery = input.visit?.lastConfidentGallery;
  const recentGallery = lastAt !== undefined && input.now >= lastAt && input.now - lastAt <= GALLERY_TTL_MS;

  const scored = scoreCandidates(candidates.map((candidate) => {
    if (verifications.size < MAX_ORB_VERIFICATIONS && candidate.descriptors && candidate.keypoints) {
      const reference = decodeOrbFeatures(candidate.descriptors, candidate.keypoints);
      verifications.set(candidate.object._id, verifyOrb(input.query, reference, {
        inputSize: candidate.inputSize ?? input.inputSize,
      }));
    }
    const verification = verifications.get(candidate.object._id);
    const atVenue = input.venueId !== undefined && candidate.placement?.venueId === input.venueId;
    const candidateGallery = candidate.placement?.gallery;
    const gallery: GalleryRelation = recentGallery && lastGallery !== undefined && candidateGallery !== undefined && atVenue
      ? candidateGallery === lastGallery ? 'same' : 'different'
      : 'unknown';
    return {
      candidate,
      signals: {
        similarity: candidate.similarity,
        runnerUpSimilarity: candidates.find((other) => other.object._id !== candidate.object._id)?.similarity ?? 0,
        candidateCount: candidates.length, atVenue, gallery,
        onView: candidate.placement?.onView ?? null, keypointCount: candidate.keypointCount,
        orbInliers: verification?.inlierCount ?? 0, homographyValid: verification?.verified ?? false,
        objectPenalty: effectiveObjectPenalty(candidate.object),
      },
    };
  }), input.config);
  return { decision: decide(scored, input.config), verifications };
}

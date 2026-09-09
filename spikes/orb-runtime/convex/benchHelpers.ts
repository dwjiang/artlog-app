import { v } from 'convex/values';

import type { OrbFeatures } from './lib/orb/features';
import { mulberry32 } from './lib/orb/homography';
import { makeRandomFeatures, makeSyntheticPair } from './lib/orb/testFixtures';

export const INPUT_SIZE = 512;
export const SEED = 20260909;
export const profileValidator = v.union(
  v.literal('positive'), v.literal('unrelated'), v.literal('inconsistent'),
);
export type Profile = 'positive' | 'unrelated' | 'inconsistent';

export const summaryValidator = v.object({
  min: v.number(), p50: v.number(), p95: v.number(), max: v.number(),
});

export function summarize(samples: number[]) {
  if (samples.length === 0 || samples.some((x) => !Number.isFinite(x) || x < 0)) {
    throw new Error('Expected finite, nonnegative timing samples');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  };
  return { min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1)! };
}

export function boundedInteger(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
}

export function makePair(keypoints: number, seed: number, profile: Profile) {
  const { query: generated, ref } = makeSyntheticPair({ count: keypoints, seed, inputSize: INPUT_SIZE });
  // The fixture adds 30% outliers. Copy the shuffled prefix to retain exactly N×N buffers.
  const query: OrbFeatures = {
    count: keypoints,
    descriptors: generated.descriptors.slice(0, keypoints * 32),
    keypoints: generated.keypoints.slice(0, keypoints * 4),
  };
  const random = mulberry32(seed ^ 0x5f3759df);
  if (profile === 'unrelated') return { query, ref: makeRandomFeatures(random, keypoints, INPUT_SIZE) };
  if (profile === 'inconsistent') {
    // Preserve descriptor matches but remove geometric agreement to exercise the RANSAC cap.
    query.keypoints = makeRandomFeatures(random, keypoints, INPUT_SIZE).keypoints;
  }
  return { query, ref };
}

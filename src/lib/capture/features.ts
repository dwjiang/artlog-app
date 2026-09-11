import type { Embedder, OrbExtractor, Triage } from './stages';

function orbPending(): never {
  throw new Error('Triage and ORB implemented by plan 03.04');
}

export const triage: Triage = { check: orbPending };
export const orb: OrbExtractor = { extract: orbPending };

export type ScanFeatures = { vector: number[]; descriptors: ArrayBuffer; keypoints: ArrayBuffer };

export function roundVector(embedding: Float32Array): number[] {
  return Array.from(embedding, (value) => Number(value.toFixed(5)));
}

/** Recomputes a stored crop's features, the queue's path after a model update (design §5.4). */
export async function extractFeatures(
  cropUri: string,
  stages: { embedder: Embedder; orb: OrbExtractor },
): Promise<ScanFeatures> {
  const embedding = await stages.embedder.embed(cropUri);
  const features = await stages.orb.extract(cropUri);
  return { vector: roundVector(embedding), descriptors: features.descriptors, keypoints: features.keypoints };
}

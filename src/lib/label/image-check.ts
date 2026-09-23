import { reportError } from "@/lib/observability";
import { decodeOrbFeatures } from "@/shared/orb/features";
import { verifyOrb } from "@/shared/orb/verify";
import type { ImageCheck } from "../../../convex/lib/validators";
import type { ScanFeatures } from "@/lib/capture/features";

/** Mirrors `IMAGE_MATCH_COSINE` in convex/lib/labelVerify.ts: the server ignores checks below it. */
export const IMAGE_MATCH_COSINE = 0.85;
export const MAX_IMAGE_CHECKS = 3;

export type ImageCheckDeps = {
  /** Downloads the image and returns its file URI. */
  download(url: string): Promise<string>;
  /** Letterboxes the whole image to the model's square input and returns the crop's file URI. */
  letterbox(uri: string): Promise<string>;
  embed(uri: string): Promise<Float32Array>;
  extractOrb(uri: string): Promise<{ descriptors: ArrayBuffer; keypoints: ArrayBuffer }>;
  remove(uri: string): void;
};

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length)
    throw new Error(`Cannot compare vectors of ${a.length} and ${b.length} values`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/**
 * "Text proposes, pixels decide": embeds up to three museum images against the scan and runs the
 * ORB homography on the closest one. `null` when no image reaches the cosine threshold.
 */
export async function checkImages(
  urls: string[],
  scan: ScanFeatures,
  deps: ImageCheckDeps,
  { inputSize }: { inputSize: number },
): Promise<ImageCheck | null> {
  const files: string[] = [];
  let best: { url: string; cosine: number; uri: string } | undefined;
  try {
    for (const url of urls.slice(0, MAX_IMAGE_CHECKS)) {
      try {
        const downloaded = await deps.download(url);
        files.push(downloaded);
        const letterboxed = await deps.letterbox(downloaded);
        files.push(letterboxed);
        const cosine = cosineSimilarity(scan.vector, await deps.embed(letterboxed));
        if (!best || cosine > best.cosine) best = { url, cosine, uri: letterboxed };
      } catch (error) {
        reportError(error, "label.check_museum_image", { level: "warning" });
        console.warn("Could not check a museum image", error);
      }
    }
    if (!best || best.cosine < IMAGE_MATCH_COSINE) return null;
    const candidate = await deps.extractOrb(best.uri);
    const result = verifyOrb(
      decodeOrbFeatures(scan.descriptors, scan.keypoints),
      decodeOrbFeatures(candidate.descriptors, candidate.keypoints),
      { inputSize },
    );
    return { url: best.url, cosine: best.cosine, homographyValid: result.verified };
  } finally {
    for (const uri of files) deps.remove(uri);
  }
}

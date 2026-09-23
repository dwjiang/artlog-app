import type { ImageCheck, SearchCandidate } from "../../../convex/lib/validators";
import type { ScanFeatures } from "@/lib/capture/features";
import { checkImages, type ImageCheckDeps } from "@/lib/label/image-check";

export async function checkCandidates(
  candidates: SearchCandidate[],
  scan: ScanFeatures,
  deps: ImageCheckDeps,
  options: { inputSize: number; canContinue: () => Promise<boolean> },
): Promise<{ sourceUrl: string; imageCheck: ImageCheck } | null> {
  for (const candidate of candidates.slice(0, 3)) {
    for (const url of candidate.imageUrls.slice(0, 6)) {
      if (!(await options.canContinue())) return null;
      // A single URL makes the label flow's shared cosine + homography check stop at the first passing image.
      const imageCheck = await checkImages([url], scan, deps, options);
      if (imageCheck?.homographyValid) return { sourceUrl: candidate.sourceUrl, imageCheck };
    }
  }
  return null;
}

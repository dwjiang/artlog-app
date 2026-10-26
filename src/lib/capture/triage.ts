import { filePath } from "@/lib/file-uri";

import { getOpenCVFeatures, type OpenCVFeatures, type TriageMetrics } from "../../../modules/opencv-features/src";
import type { Triage } from "./stages";

/** Metrics are measured on the gray crop downscaled to this square size. */
export const TRIAGE_SIZE = 256;
/** Variance of the 3×3 Laplacian; the sharp fixture scores ~2,000, a σ=3 px Gaussian blur ~20. */
export const BLUR_THRESHOLD = 60;
/** Pixels at or above this gray level count as blown highlights. */
export const GLARE_LEVEL = 250;
/** Fraction of highlight pixels above which the shot is a glare retake. */
export const GLARE_THRESHOLD = 0.04;

export type TriageResult = Awaited<ReturnType<Triage["check"]>>;

export function decide({ blurVariance, glareFraction }: TriageMetrics): TriageResult {
  if (blurVariance < BLUR_THRESHOLD) {
    return { ok: false, reason: "blur", message: "Hold steady and try again" };
  }
  if (glareFraction > GLARE_THRESHOLD) {
    return {
      ok: false,
      reason: "glare",
      message: "Adjust the angle to reduce glare",
    };
  }
  return { ok: true };
}

export function measureCrop(cropUri: string, opencv: OpenCVFeatures = getOpenCVFeatures()): Promise<TriageMetrics> {
  return opencv.measureTriage(filePath(cropUri), TRIAGE_SIZE, GLARE_LEVEL);
}

export async function check(cropUri: string, opencv?: OpenCVFeatures): Promise<TriageResult> {
  const metrics = await measureCrop(cropUri, opencv);
  const result = decide(metrics);
  // Thresholds are product tuning; the metrics behind each decision are what gets recorded.
  if (__DEV__) console.debug("Triage", { ...metrics, ...result });
  return result;
}

export const triage: Triage = { check: (cropUri) => check(cropUri) };

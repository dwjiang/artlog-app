import { requireOptionalNativeModule } from "expo";

export type OrbDetection = {
  width: number;
  height: number;
  /** Float32 `[x, y, size, angle]` per keypoint in OpenCV output order (iOS is little-endian). */
  keypoints: Uint8Array;
  /** 32-byte descriptor rows in keypoint order. */
  descriptors: Uint8Array;
};

export type TriageMetrics = { blurVariance: number; glareFraction: number };

export type OpenCVFeatures = {
  /** `ORB_create(maxKeypoints).detectAndCompute` on the image file at `path` (a path, not a URI), converted to gray. */
  detectOrb(path: string, maxKeypoints: number): Promise<OrbDetection>;
  /**
   * Variance of the 3×3 Laplacian and the fraction of pixels at or above `glareLevel`, measured on the
   * image file at `path`, converted to gray and downscaled to `size`×`size`.
   */
  measureTriage(path: string, size: number, glareLevel: number): Promise<TriageMetrics>;
};

let instance: OpenCVFeatures | null | undefined;

export function getOpenCVFeatures(): OpenCVFeatures {
  instance ??= requireOptionalNativeModule<OpenCVFeatures>("OpenCVFeatures");
  if (!instance) {
    throw new Error("The OpenCVFeatures native module is unavailable; rebuild the dev client");
  }
  return instance;
}

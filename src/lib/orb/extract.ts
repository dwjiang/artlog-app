import { filePath } from "@/lib/file-uri";
import model from "@/shared/model/model-version.json";
import { DESCRIPTOR_BYTES, KEYPOINT_BYTES } from "@/shared/orb/features";

import { getOpenCVFeatures, type OpenCVFeatures, type OrbDetection } from "../../../modules/opencv-features/src";

export type OrbFeatureBuffers = {
  descriptors: ArrayBuffer;
  keypoints: ArrayBuffer;
  count: number;
};

/** ORB features of a letterboxed square crop in the wire format, capped like `scripts/data/pipeline/orb.py`. */
export async function extractOrb(
  cropUri: string,
  maxKeypoints: number = model.orbMaxKeypoints,
  opencv: OpenCVFeatures = getOpenCVFeatures(),
): Promise<OrbFeatureBuffers> {
  const detection = await opencv.detectOrb(filePath(cropUri), maxKeypoints);
  if (detection.width !== detection.height) {
    throw new Error(`ORB expects the letterboxed square crop, got ${detection.width}×${detection.height}`);
  }
  return toOrbFeatures(detection, maxKeypoints);
}

export function toOrbFeatures(
  { keypoints, descriptors }: Pick<OrbDetection, "keypoints" | "descriptors">,
  maxKeypoints: number,
): OrbFeatureBuffers {
  const detected = keypoints.byteLength / KEYPOINT_BYTES;
  if (!Number.isInteger(detected) || descriptors.byteLength !== detected * DESCRIPTOR_BYTES) {
    throw new Error(
      `ORB produced ${descriptors.byteLength} descriptor bytes for ${keypoints.byteLength} keypoint bytes`,
    );
  }
  // ORB's retainBest keeps ties past the cap; truncating in output order matches orb.py.
  const count = Math.min(detected, maxKeypoints);
  return {
    descriptors: descriptors.slice(0, count * DESCRIPTOR_BYTES).buffer,
    keypoints: keypoints.slice(0, count * KEYPOINT_BYTES).buffer,
    count,
  };
}

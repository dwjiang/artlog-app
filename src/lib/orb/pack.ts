import { KEYPOINT_FLOATS } from "@/shared/orb/features";

export type Keypoint = { x: number; y: number; size: number; angle: number };

/** `[x, y, size, angle]` float32 per keypoint in input order: the wire format of `shared/orb/features.ts`. */
export function packKeypoints(keypoints: readonly Keypoint[]): Float32Array {
  const packed = new Float32Array(keypoints.length * KEYPOINT_FLOATS);
  keypoints.forEach((keypoint, index) => {
    packed.set(
      [keypoint.x, keypoint.y, keypoint.size, keypoint.angle],
      index * KEYPOINT_FLOATS,
    );
  });
  return packed;
}

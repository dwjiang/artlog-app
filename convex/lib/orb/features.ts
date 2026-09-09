/**
 * ORB feature set v1 — the cross-language wire format shared by the phone (plan 03.04), the
 * index build (plan 02.04) and the crawler (plan 02.06). Two standalone buffers per image:
 *
 * - `descriptors`: `count × 32` bytes, OpenCV `ORB.detectAndCompute` rows in output order.
 * - `keypoints`: `count × 16` bytes, little-endian float32 `[x, y, size, angle]` per keypoint in
 *   the same order; `x`, `y` in pixels of the letterboxed square input, `angle` in degrees.
 */
export const DESCRIPTOR_BYTES = 32;
export const KEYPOINT_FLOATS = 4;
export const KEYPOINT_BYTES = KEYPOINT_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const MAX_KEYPOINTS = 1000;

export type OrbFeatures = {
  count: number;
  descriptors: Uint8Array;
  keypoints: Float32Array;
};

export class OrbFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrbFormatError';
  }
}

export function decodeOrbFeatures(descriptors: ArrayBuffer, keypoints: ArrayBuffer): OrbFeatures {
  if (descriptors.byteLength % DESCRIPTOR_BYTES !== 0) {
    throw new OrbFormatError(
      `descriptors byte length ${descriptors.byteLength} is not a multiple of ${DESCRIPTOR_BYTES}`
    );
  }
  const count = descriptors.byteLength / DESCRIPTOR_BYTES;
  if (count > MAX_KEYPOINTS) {
    throw new OrbFormatError(`${count} keypoints exceeds the maximum of ${MAX_KEYPOINTS}`);
  }
  if (keypoints.byteLength !== count * KEYPOINT_BYTES) {
    throw new OrbFormatError(
      `keypoints byte length ${keypoints.byteLength} does not match ${count} descriptors ` +
        `(expected ${count * KEYPOINT_BYTES})`
    );
  }
  // Float32Array reads platform byte order; every runtime this ships on (V8 servers, iOS arm64)
  // is little-endian, which is what the wire format specifies.
  const keypointView = new Float32Array(keypoints);
  for (let i = 0; i < keypointView.length; i++) {
    if (!Number.isFinite(keypointView[i])) {
      const keypoint = Math.floor(i / KEYPOINT_FLOATS);
      throw new OrbFormatError(`keypoint ${keypoint} has a non-finite value`);
    }
  }
  return { count, descriptors: new Uint8Array(descriptors), keypoints: keypointView };
}

export function encodeOrbFeatures(features: OrbFeatures): {
  descriptors: ArrayBuffer;
  keypoints: ArrayBuffer;
} {
  return {
    descriptors: features.descriptors.slice().buffer,
    keypoints: features.keypoints.slice().buffer,
  };
}

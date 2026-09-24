import type { Mat } from "react-native-fast-opencv";

import { DESCRIPTOR_BYTES, encodeOrbFeatures } from "@/shared/orb/features";
import model from "../../../shared/model/model-version.json";

import type { FastOpenCV } from "@/lib/image/opencv";
import { withGray } from "@/lib/image/read-crop";
import { packKeypoints, type Keypoint } from "./pack";

export type OrbDetection = {
  keypoints: Keypoint[];
  /** OpenCV descriptor rows in keypoint order, `descriptorBytes` per row. */
  descriptors: Uint8Array;
  descriptorBytes: number;
};

export type OrbFeatureBuffers = {
  descriptors: ArrayBuffer;
  keypoints: ArrayBuffer;
  count: number;
};

/** ORB features of a letterboxed square crop in the wire format, capped like `scripts/data/pipeline/orb.py`. */
export function extractOrb(
  cropUri: string,
  maxKeypoints: number = model.orbMaxKeypoints,
  cv?: FastOpenCV,
): Promise<OrbFeatureBuffers> {
  return withGray(cropUri, cv, ({ gray, width, height }, opencv) => {
    if (width !== height) {
      throw new Error(
        `ORB expects the letterboxed square crop, got ${width}×${height}`,
      );
    }
    return toOrbFeatures(detectOrb(gray, maxKeypoints, opencv), maxKeypoints);
  });
}

function detectOrb(
  gray: Mat,
  maxKeypoints: number,
  { OpenCV }: FastOpenCV,
): OrbDetection {
  const detector = OpenCV.ORB_create(maxKeypoints);
  try {
    const { keypoints, descriptors } = OpenCV.detectAndCompute(detector, gray);
    try {
      const points = keypoints.toArray();
      if (points.length === 0) {
        return {
          keypoints: [],
          descriptors: new Uint8Array(0),
          descriptorBytes: DESCRIPTOR_BYTES,
        };
      }
      const rows = descriptors.toBuffer("uint8");
      return {
        keypoints: points,
        descriptors: rows.buffer,
        descriptorBytes: rows.cols * rows.channels,
      };
    } finally {
      keypoints.release();
      descriptors.release();
    }
  } finally {
    detector.release();
  }
}

export function toOrbFeatures(
  detection: OrbDetection,
  maxKeypoints: number,
): OrbFeatureBuffers {
  const { keypoints, descriptors, descriptorBytes } = detection;
  if (descriptorBytes !== DESCRIPTOR_BYTES) {
    throw new Error(
      `ORB produced ${descriptorBytes}-byte descriptors, expected ${DESCRIPTOR_BYTES}`,
    );
  }
  if (descriptors.length !== keypoints.length * DESCRIPTOR_BYTES) {
    throw new Error(
      `ORB produced ${descriptors.length} descriptor bytes for ${keypoints.length} keypoints`,
    );
  }
  // ORB's retainBest keeps ties past the cap; truncating in output order matches orb.py.
  const count = Math.min(keypoints.length, maxKeypoints);
  const encoded = encodeOrbFeatures({
    count,
    descriptors: descriptors.subarray(0, count * DESCRIPTOR_BYTES),
    keypoints: packKeypoints(keypoints.slice(0, count)),
  });
  return { ...encoded, count };
}

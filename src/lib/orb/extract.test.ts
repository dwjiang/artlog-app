import model from "@/shared/model/model-version.json";
import { DESCRIPTOR_BYTES, KEYPOINT_BYTES, decodeOrbFeatures } from "@/shared/orb/features";

import type { OpenCVFeatures, OrbDetection } from "../../../modules/opencv-features/src";
import { extractOrb, toOrbFeatures } from "./extract";

const keypointValues = [10, 20, 31, 45.5, 100, 200, 31, 180, 300, 400, 62, 359];
const keypoints = new Uint8Array(Float32Array.from(keypointValues).buffer);
const descriptors = Uint8Array.from({ length: 3 * DESCRIPTOR_BYTES }, (_, i) => i % 251);

function opencv(detection: Partial<OrbDetection> = {}) {
  return {
    detectOrb: jest.fn(async () => ({ width: 512, height: 512, keypoints, descriptors, ...detection })),
    measureTriage: jest.fn(),
  } satisfies OpenCVFeatures;
}

describe("toOrbFeatures", () => {
  it("returns descriptors and keypoints in output order", () => {
    const features = toOrbFeatures({ keypoints, descriptors }, 500);
    expect(features.count).toBe(3);
    const decoded = decodeOrbFeatures(features.descriptors, features.keypoints);
    expect(Array.from(decoded.descriptors)).toEqual(Array.from(descriptors));
    expect(Array.from(decoded.keypoints)).toEqual(keypointValues);
  });

  it("truncates ties past the cap in output order, like orb.py", () => {
    const features = toOrbFeatures({ keypoints, descriptors }, 2);
    expect(features.count).toBe(2);
    expect(features.descriptors.byteLength).toBe(2 * DESCRIPTOR_BYTES);
    expect(features.keypoints.byteLength).toBe(2 * KEYPOINT_BYTES);
    expect(Array.from(new Uint8Array(features.descriptors))).toEqual(Array.from(descriptors.subarray(0, 64)));
  });

  it("returns empty buffers when nothing was detected", () => {
    expect(toOrbFeatures({ keypoints: new Uint8Array(0), descriptors: new Uint8Array(0) }, 500)).toEqual({
      count: 0,
      descriptors: new ArrayBuffer(0),
      keypoints: new ArrayBuffer(0),
    });
  });

  it("rejects descriptors that are not 32 bytes per keypoint", () => {
    expect(() => toOrbFeatures({ keypoints, descriptors: new Uint8Array(3 * 64) }, 500)).toThrow(
      "192 descriptor bytes for 48 keypoint bytes",
    );
    expect(() => toOrbFeatures({ keypoints: keypoints.subarray(0, 40), descriptors }, 500)).toThrow(
      "96 descriptor bytes for 40 keypoint bytes",
    );
  });
});

describe("extractOrb", () => {
  it("detects on the crop file with the model cap", async () => {
    const native = opencv();
    const features = await extractOrb("file:///crops/a%20b.jpg", undefined, native);
    expect(native.detectOrb).toHaveBeenCalledWith("/crops/a b.jpg", model.orbMaxKeypoints);
    expect(decodeOrbFeatures(features.descriptors, features.keypoints).count).toBe(3);
  });

  it("rejects a crop that is not square", async () => {
    await expect(extractOrb("file:///wide.jpg", 500, opencv({ width: 640, height: 480 }))).rejects.toThrow(
      "letterboxed square crop, got 640×480",
    );
  });
});

import { decodeOrbFeatures, encodeOrbFeatures, MAX_KEYPOINTS, OrbFormatError } from "./features";
import { mulberry32 } from "./homography";
import { makeRandomFeatures } from "./test-fixtures";

describe("ORB feature wire format", () => {
  it("round-trips descriptors and keypoints through standalone buffers", () => {
    const features = makeRandomFeatures(mulberry32(7), 25, 512);

    const encoded = encodeOrbFeatures(features);
    const decoded = decodeOrbFeatures(encoded.descriptors, encoded.keypoints);

    expect(encoded.descriptors.byteLength).toBe(25 * 32);
    expect(encoded.keypoints.byteLength).toBe(25 * 16);
    expect(decoded.count).toBe(25);
    expect(Array.from(decoded.descriptors)).toEqual(Array.from(features.descriptors));
    expect(Array.from(decoded.keypoints)).toEqual(Array.from(features.keypoints));
  });

  it("encodes exactly the bytes of views into a larger buffer", () => {
    const whole = makeRandomFeatures(mulberry32(8), 4, 512);
    const middle = {
      count: 2,
      descriptors: whole.descriptors.subarray(32, 96),
      keypoints: whole.keypoints.subarray(4, 12),
    };

    const encoded = encodeOrbFeatures(middle);

    expect(encoded.descriptors.byteLength).toBe(64);
    expect(encoded.keypoints.byteLength).toBe(32);
    expect(Array.from(new Uint8Array(encoded.descriptors))).toEqual(Array.from(whole.descriptors.subarray(32, 96)));
  });

  it("reads keypoints as little-endian float32 [x, y, size, angle] tuples", () => {
    const keypoints = new ArrayBuffer(16);
    const view = new DataView(keypoints);
    view.setFloat32(0, 12.5, true);
    view.setFloat32(4, 300.25, true);
    view.setFloat32(8, 31, true);
    view.setFloat32(12, 270, true);

    const decoded = decodeOrbFeatures(new ArrayBuffer(32), keypoints);

    expect(Array.from(decoded.keypoints)).toEqual([12.5, 300.25, 31, 270]);
  });

  it("decodes an empty feature set", () => {
    const decoded = decodeOrbFeatures(new ArrayBuffer(0), new ArrayBuffer(0));

    expect(decoded.count).toBe(0);
    expect(decoded.descriptors.length).toBe(0);
    expect(decoded.keypoints.length).toBe(0);
  });

  it("accepts exactly the maximum keypoint count", () => {
    const decoded = decodeOrbFeatures(new ArrayBuffer(MAX_KEYPOINTS * 32), new ArrayBuffer(MAX_KEYPOINTS * 16));

    expect(decoded.count).toBe(MAX_KEYPOINTS);
  });

  it("rejects a descriptor buffer that is not a multiple of 32 bytes", () => {
    expect(() => decodeOrbFeatures(new ArrayBuffer(33), new ArrayBuffer(16))).toThrow(OrbFormatError);
  });

  it("rejects keypoints whose length disagrees with the descriptor count", () => {
    expect(() => decodeOrbFeatures(new ArrayBuffer(64), new ArrayBuffer(16))).toThrow(OrbFormatError);
    expect(() => decodeOrbFeatures(new ArrayBuffer(64), new ArrayBuffer(48))).toThrow(OrbFormatError);
  });

  it("rejects more than the maximum keypoint count", () => {
    const count = MAX_KEYPOINTS + 1;

    expect(() => decodeOrbFeatures(new ArrayBuffer(count * 32), new ArrayBuffer(count * 16))).toThrow(OrbFormatError);
  });

  it("rejects non-finite keypoint values", () => {
    const nan = new Float32Array([1, NaN, 3, 4]);
    const infinite = new Float32Array([1, 2, Infinity, 4]);

    expect(() => decodeOrbFeatures(new ArrayBuffer(32), nan.buffer)).toThrow(OrbFormatError);
    expect(() => decodeOrbFeatures(new ArrayBuffer(32), infinite.buffer)).toThrow(OrbFormatError);
  });
});

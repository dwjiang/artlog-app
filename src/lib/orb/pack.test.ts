import { KEYPOINT_BYTES } from "@/shared/orb/features";
import { packKeypoints } from "./pack";

it("packs [x, y, size, angle] per keypoint as little-endian float32 in input order", () => {
  const packed = packKeypoints([
    { x: 10.5, y: 20.25, size: 31, angle: 359.5 },
    { x: 0, y: 511, size: 62, angle: 0 },
  ]);
  expect(packed).toBeInstanceOf(Float32Array);
  expect(packed.byteLength).toBe(2 * KEYPOINT_BYTES);
  expect(Array.from(packed)).toEqual([10.5, 20.25, 31, 359.5, 0, 511, 62, 0]);
  const view = new DataView(packed.buffer);
  expect(view.getFloat32(0, true)).toBe(10.5);
  expect(view.getFloat32(4 * 7, true)).toBe(0);
});

it("packs no keypoints into an empty array", () => {
  expect(packKeypoints([]).byteLength).toBe(0);
});

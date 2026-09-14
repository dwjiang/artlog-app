// Cross-language guard for the ORB wire format: the bytes in
// shared/orb/fixtures/orb-features-v1.json were produced by jobs/artlog_jobs/orb.py.

import fixture from './fixtures/orb-features-v1.json';
import model from '../model/model-version.json';

const DESCRIPTOR_BYTES = 32;
const KEYPOINT_FLOATS = 4;
const MAX_KEYPOINTS = 1000;

function decodeBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

describe('ORB fixture written by the Python extractor', () => {
  const descriptors = decodeBase64(fixture.descriptorsBase64);
  const keypoints = decodeBase64(fixture.keypointsBase64);

  it('has count×32 descriptor bytes and count×16 keypoint bytes within the cap', () => {
    expect(fixture.count).toBeGreaterThan(0);
    expect(fixture.count).toBeLessThanOrEqual(Math.min(MAX_KEYPOINTS, model.orbMaxKeypoints));
    expect(descriptors.byteLength).toBe(fixture.count * DESCRIPTOR_BYTES);
    expect(keypoints.byteLength).toBe(fixture.count * KEYPOINT_FLOATS * 4);
    expect(fixture.inputSize).toBe(model.inputSize);
  });

  it('decodes keypoints as little-endian float32 [x, y, size, angle] in letterboxed pixels', () => {
    const view = new DataView(keypoints);
    for (let i = 0; i < fixture.count; i += 1) {
      const x = view.getFloat32(i * 16, true);
      const y = view.getFloat32(i * 16 + 4, true);
      const size = view.getFloat32(i * 16 + 8, true);
      const angle = view.getFloat32(i * 16 + 12, true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(fixture.inputSize);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(fixture.inputSize);
      expect(size).toBeGreaterThan(0);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });

  it('carries non-trivial binary descriptors', () => {
    const bytes = new Uint8Array(descriptors);
    const distinct = new Set(bytes);
    expect(distinct.size).toBeGreaterThan(16);
    const first = bytes.subarray(0, DESCRIPTOR_BYTES);
    const second = bytes.subarray(DESCRIPTOR_BYTES, 2 * DESCRIPTOR_BYTES);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });
});

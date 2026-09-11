import { DESCRIPTOR_BYTES, KEYPOINT_BYTES, decodeOrbFeatures } from '@/shared/orb/features';
import model from '../../../shared/model-version.json';

import { fakeOpenCV, type FakeOpenCVOptions } from '@/lib/image/opencv-fake';
import { extractOrb, toOrbFeatures } from './extract';

const mockBase64 = jest.fn();
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    base64() { return mockBase64(this.uri); }
  },
}));

const keypoints = [
  { x: 10, y: 20, size: 31, angle: 45.5 },
  { x: 100, y: 200, size: 31, angle: 180 },
  { x: 300, y: 400, size: 62, angle: 359 },
];
const descriptors = Uint8Array.from({ length: keypoints.length * DESCRIPTOR_BYTES }, (_, i) => i % 251);

beforeEach(() => {
  mockBase64.mockReset();
  mockBase64.mockImplementation(async (uri: string) => `b64:${uri}`);
});

describe('toOrbFeatures', () => {
  it('encodes descriptors and packed keypoints in output order', () => {
    const features = toOrbFeatures({ keypoints, descriptors, descriptorBytes: DESCRIPTOR_BYTES }, 500);
    expect(features.count).toBe(3);
    const decoded = decodeOrbFeatures(features.descriptors, features.keypoints);
    expect(Array.from(decoded.descriptors)).toEqual(Array.from(descriptors));
    expect(Array.from(decoded.keypoints)).toEqual([10, 20, 31, 45.5, 100, 200, 31, 180, 300, 400, 62, 359]);
  });

  it('truncates ties past the cap in output order, like orb.py', () => {
    const features = toOrbFeatures({ keypoints, descriptors, descriptorBytes: DESCRIPTOR_BYTES }, 2);
    expect(features.count).toBe(2);
    expect(features.descriptors.byteLength).toBe(2 * DESCRIPTOR_BYTES);
    expect(features.keypoints.byteLength).toBe(2 * KEYPOINT_BYTES);
    expect(Array.from(new Uint8Array(features.descriptors))).toEqual(Array.from(descriptors.subarray(0, 64)));
  });

  it('returns empty buffers when nothing was detected', () => {
    expect(toOrbFeatures({ keypoints: [], descriptors: new Uint8Array(0), descriptorBytes: DESCRIPTOR_BYTES }, 500)).toEqual({
      count: 0, descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    });
  });

  it('rejects descriptors that are not 32 bytes per keypoint', () => {
    expect(() => toOrbFeatures({ keypoints, descriptors, descriptorBytes: 64 }, 500)).toThrow('64-byte descriptors, expected 32');
    expect(() => toOrbFeatures({ keypoints, descriptors: descriptors.subarray(0, 95), descriptorBytes: DESCRIPTOR_BYTES }, 500))
      .toThrow('95 descriptor bytes for 3 keypoints');
  });
});

describe('extractOrb', () => {
  function crop(options: FakeOpenCVOptions = {}) {
    return fakeOpenCV({ images: { 'b64:file:///crop.jpg': { rows: 512, cols: 512, channels: 3 } }, keypoints, descriptors, ...options });
  }

  it('reads the crop, detects with the model cap, and releases every native object', async () => {
    const fake = crop();
    const features = await extractOrb('file:///crop.jpg', undefined, fake.cv);
    expect(mockBase64).toHaveBeenCalledWith('file:///crop.jpg');
    expect(fake.calls).toContainEqual({ name: 'ORB_create', args: [model.orbMaxKeypoints] });
    expect(features.count).toBe(3);
    expect(decodeOrbFeatures(features.descriptors, features.keypoints).count).toBe(3);
    expect(fake.leaked()).toEqual([]);
  });

  it('rejects a crop that is not square and still releases the image', async () => {
    const fake = fakeOpenCV({ images: { 'b64:file:///wide.jpg': { rows: 480, cols: 640, channels: 3 } } });
    await expect(extractOrb('file:///wide.jpg', 500, fake.cv)).rejects.toThrow('letterboxed square crop, got 640×480');
    expect(fake.leaked()).toEqual([]);
  });

  it('releases native objects when the descriptor shape is wrong', async () => {
    const fake = crop({ descriptorCols: 16, descriptors: new Uint8Array(keypoints.length * 16) });
    await expect(extractOrb('file:///crop.jpg', 500, fake.cv)).rejects.toThrow('16-byte descriptors');
    expect(fake.leaked()).toEqual([]);
  });
});

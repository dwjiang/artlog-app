import { DESCRIPTOR_BYTES, KEYPOINT_FLOATS, type OrbFeatures } from './features';
import { applyHomography, mat3mul, mulberry32 } from './homography';

export type SyntheticPairOptions = {
  seed?: number;
  count?: number;
  inputSize?: number;
  outlierFraction?: number;
  bitFlipFraction?: number;
  noiseSigma?: number;
  homography?: ArrayLike<number>;
};

export type SyntheticPair = {
  ref: OrbFeatures;
  query: OrbFeatures;
  truth: { H: Float64Array; correspondences: [number, number][] };
};

export function makeRandomFeatures(
  rand: () => number,
  count: number,
  inputSize: number
): OrbFeatures {
  const descriptors = new Uint8Array(count * DESCRIPTOR_BYTES);
  for (let i = 0; i < descriptors.length; i++) descriptors[i] = Math.floor(rand() * 256);
  const keypoints = new Float32Array(count * KEYPOINT_FLOATS);
  for (let i = 0; i < count; i++) {
    keypoints[i * KEYPOINT_FLOATS] = 16 + rand() * (inputSize - 32);
    keypoints[i * KEYPOINT_FLOATS + 1] = 16 + rand() * (inputSize - 32);
    keypoints[i * KEYPOINT_FLOATS + 2] = 7 + rand() * 24;
    keypoints[i * KEYPOINT_FLOATS + 3] = rand() * 360;
  }
  return { count, descriptors, keypoints };
}

export function featuresFromDescriptors(rows: Uint8Array[]): OrbFeatures {
  const descriptors = new Uint8Array(rows.length * DESCRIPTOR_BYTES);
  rows.forEach((row, i) => descriptors.set(row, i * DESCRIPTOR_BYTES));
  return {
    count: rows.length,
    descriptors,
    keypoints: new Float32Array(rows.length * KEYPOINT_FLOATS),
  };
}

export function withFlippedBits(descriptor: Uint8Array, bits: number[]): Uint8Array {
  const out = descriptor.slice();
  for (const bit of bits) out[bit >> 3] ^= 1 << (bit & 7);
  return out;
}

// 10° rotation about the centre, a small translation and mild perspective.
export function defaultSyntheticHomography(inputSize: number): Float64Array {
  const angle = (10 * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const half = inputSize / 2;
  const rotate = [c, -s, half - c * half + s * half, s, c, half - s * half - c * half, 0, 0, 1];
  const translate = [1, 0, 15, 0, 1, -10, 0, 0, 1];
  const perspective = [1, 0, 0, 0, 1, 0, 1e-4, -5e-5, 1];
  return mat3mul(perspective, mat3mul(translate, rotate));
}

export function makeSyntheticPair(opts: SyntheticPairOptions = {}): SyntheticPair {
  const seed = opts.seed ?? 1;
  const count = opts.count ?? 300;
  const inputSize = opts.inputSize ?? 512;
  const outlierFraction = opts.outlierFraction ?? 0.3;
  const bitFlipFraction = opts.bitFlipFraction ?? 0.06;
  const noiseSigma = opts.noiseSigma ?? 0.7;
  const rand = mulberry32(seed);
  const H = Float64Array.from(opts.homography ?? defaultSyntheticHomography(inputSize));

  const ref = makeRandomFeatures(rand, count, inputSize);
  const queryCount = count + Math.round(count * outlierFraction);
  // Rows [0, count) become the mapped copies of the reference; the rest stay random outliers.
  const unshuffled = makeRandomFeatures(rand, queryCount, inputSize);
  for (let i = 0; i < count; i++) {
    const kp = i * KEYPOINT_FLOATS;
    const [x, y] = applyHomography(H, ref.keypoints[kp], ref.keypoints[kp + 1]);
    unshuffled.keypoints[kp] = x + gaussian(rand) * noiseSigma;
    unshuffled.keypoints[kp + 1] = y + gaussian(rand) * noiseSigma;
    unshuffled.keypoints[kp + 2] = ref.keypoints[kp + 2];
    unshuffled.keypoints[kp + 3] = ref.keypoints[kp + 3];
    for (let b = 0; b < DESCRIPTOR_BYTES; b++) {
      let byte = ref.descriptors[i * DESCRIPTOR_BYTES + b];
      for (let bit = 0; bit < 8; bit++) if (rand() < bitFlipFraction) byte ^= 1 << bit;
      unshuffled.descriptors[i * DESCRIPTOR_BYTES + b] = byte;
    }
  }

  const order = Array.from({ length: queryCount }, (_, i) => i);
  for (let k = queryCount - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  const query: OrbFeatures = {
    count: queryCount,
    descriptors: new Uint8Array(queryCount * DESCRIPTOR_BYTES),
    keypoints: new Float32Array(queryCount * KEYPOINT_FLOATS),
  };
  const correspondences: [number, number][] = [];
  for (let k = 0; k < queryCount; k++) {
    const i = order[k];
    query.descriptors.set(
      unshuffled.descriptors.subarray(i * DESCRIPTOR_BYTES, (i + 1) * DESCRIPTOR_BYTES),
      k * DESCRIPTOR_BYTES
    );
    query.keypoints.set(
      unshuffled.keypoints.subarray(i * KEYPOINT_FLOATS, (i + 1) * KEYPOINT_FLOATS),
      k * KEYPOINT_FLOATS
    );
    if (i < count) correspondences.push([i, k]);
  }
  correspondences.sort((a, b) => a[0] - b[0]);
  return { ref, query, truth: { H, correspondences } };
}

function gaussian(rand: () => number): number {
  const u1 = 1 - rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

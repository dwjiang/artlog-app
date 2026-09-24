import type { OrbFeatures } from "./features";

export const DESCRIPTOR_WORDS = 8;

export function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

export function descriptorWords(features: OrbFeatures): Uint32Array {
  const bytes = features.descriptors;
  if (bytes.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0) {
    return new Uint32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
  }
  return new Uint32Array(bytes.slice().buffer);
}

export function hammingDistance32(
  a: Uint32Array,
  aWord: number,
  b: Uint32Array,
  bWord: number,
): number {
  return (
    popcount32(a[aWord] ^ b[bWord])
    + popcount32(a[aWord + 1] ^ b[bWord + 1])
    + popcount32(a[aWord + 2] ^ b[bWord + 2])
    + popcount32(a[aWord + 3] ^ b[bWord + 3])
    + popcount32(a[aWord + 4] ^ b[bWord + 4])
    + popcount32(a[aWord + 5] ^ b[bWord + 5])
    + popcount32(a[aWord + 6] ^ b[bWord + 6])
    + popcount32(a[aWord + 7] ^ b[bWord + 7])
  );
}

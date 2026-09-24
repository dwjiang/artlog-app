import { descriptorWords, hammingDistance32 } from "./hamming";
import { mulberry32 } from "./homography";
import {
  featuresFromDescriptors,
  makeRandomFeatures,
  withFlippedBits,
} from "./test-fixtures";

function naiveDistance(a: Uint8Array, b: Uint8Array): number {
  let distance = 0;
  for (let i = 0; i < 32; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

describe("hammingDistance32", () => {
  it("is 0 between identical descriptors", () => {
    const row = new Uint8Array(32).fill(0xa5);
    const words = descriptorWords(featuresFromDescriptors([row, row]));

    expect(hammingDistance32(words, 0, words, 8)).toBe(0);
  });

  it("is 256 between all-ones and all-zeros", () => {
    const words = descriptorWords(
      featuresFromDescriptors([
        new Uint8Array(32).fill(0xff),
        new Uint8Array(32),
      ]),
    );

    expect(hammingDistance32(words, 0, words, 8)).toBe(256);
  });

  it("is 1 for a single flipped bit anywhere in the descriptor", () => {
    const base = new Uint8Array(32).fill(0x3c);
    for (const bit of [0, 7, 8, 31, 32, 127, 128, 200, 255]) {
      const words = descriptorWords(
        featuresFromDescriptors([base, withFlippedBits(base, [bit])]),
      );

      expect(hammingDistance32(words, 0, words, 8)).toBe(1);
    }
  });

  it("agrees with a per-byte reference on 1000 random pairs", () => {
    const rand = mulberry32(42);
    const a = makeRandomFeatures(rand, 1000, 512);
    const b = makeRandomFeatures(rand, 1000, 512);
    const aWords = descriptorWords(a);
    const bWords = descriptorWords(b);

    for (let i = 0; i < 1000; i++) {
      const expected = naiveDistance(
        a.descriptors.subarray(i * 32, i * 32 + 32),
        b.descriptors.subarray(i * 32, i * 32 + 32),
      );

      expect(hammingDistance32(aWords, i * 8, bWords, i * 8)).toBe(expected);
    }
  });
});

describe("descriptorWords", () => {
  it("views aligned descriptors in place and copies unaligned ones", () => {
    const rand = mulberry32(3);
    const aligned = makeRandomFeatures(rand, 5, 512);
    const backing = new Uint8Array(1 + aligned.descriptors.length);
    backing.set(aligned.descriptors, 1);
    const unaligned = { ...aligned, descriptors: backing.subarray(1) };

    const alignedWords = descriptorWords(aligned);
    const unalignedWords = descriptorWords(unaligned);

    expect(alignedWords.buffer).toBe(aligned.descriptors.buffer);
    expect(unalignedWords.buffer).not.toBe(backing.buffer);
    expect(Array.from(unalignedWords)).toEqual(Array.from(alignedWords));
  });
});

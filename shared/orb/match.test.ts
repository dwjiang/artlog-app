
import { mulberry32 } from './homography';
import { matchDescriptors } from './match';
import {
  featuresFromDescriptors,
  makeRandomFeatures,
  makeSyntheticPair,
  withFlippedBits,
} from './test-fixtures';

const bits = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('matchDescriptors', () => {
  it('recovers most true correspondences on a synthetic pair with few false matches', () => {
    const { ref, query, truth } = makeSyntheticPair({ seed: 3 });
    const truthByQuery = new Map(
      truth.correspondences.map(([refIdx, queryIdx]) => [queryIdx, refIdx])
    );

    const matches = matchDescriptors(query, ref);

    const correct = matches.filter((m) => truthByQuery.get(m.queryIdx) === m.refIdx).length;
    expect(correct / truth.correspondences.length).toBeGreaterThanOrEqual(0.7);
    expect((matches.length - correct) / matches.length).toBeLessThanOrEqual(0.05);
  });

  it('returns matches sorted by ascending distance', () => {
    const { ref, query } = makeSyntheticPair({ seed: 4, count: 50 });

    const distances = matchDescriptors(query, ref).map((m) => m.distance);

    expect(distances.length).toBeGreaterThan(0);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('rejects a match whose second-best candidate is nearly as close', () => {
    const rand = mulberry32(5);
    const q = makeRandomFeatures(rand, 1, 512).descriptors;
    const ref = featuresFromDescriptors([
      withFlippedBits(q, bits(0, 8)),
      withFlippedBits(q, bits(100, 9)),
    ]);
    const query = featuresFromDescriptors([q]);

    expect(matchDescriptors(query, ref)).toEqual([]);
    expect(matchDescriptors(query, ref, { ratio: 0.95 })).toEqual([
      { queryIdx: 0, refIdx: 0, distance: 8 },
    ]);
  });

  it('accepts a lone reference descriptor and drops matches beyond maxDistance', () => {
    const rand = mulberry32(6);
    const q = makeRandomFeatures(rand, 1, 512).descriptors;
    const query = featuresFromDescriptors([q]);
    const at64 = featuresFromDescriptors([withFlippedBits(q, bits(0, 64))]);
    const at65 = featuresFromDescriptors([withFlippedBits(q, bits(0, 65))]);

    expect(matchDescriptors(query, at64)).toEqual([{ queryIdx: 0, refIdx: 0, distance: 64 }]);
    expect(matchDescriptors(query, at65)).toEqual([]);
  });

  it('keeps only mutual best matches with crossCheck', () => {
    const rand = mulberry32(7);
    const r = makeRandomFeatures(rand, 3, 512);
    const r0 = r.descriptors.subarray(0, 32);
    const query = featuresFromDescriptors([
      withFlippedBits(r0, bits(0, 5)),
      withFlippedBits(r0, bits(10, 3)),
    ]);

    const plain = matchDescriptors(query, r);
    const mutual = matchDescriptors(query, r, { crossCheck: true });

    expect(plain.map((m) => [m.queryIdx, m.refIdx])).toEqual([
      [1, 0],
      [0, 0],
    ]);
    expect(mutual).toEqual([{ queryIdx: 1, refIdx: 0, distance: 3 }]);
  });

  it('returns no matches when either side is empty', () => {
    const rand = mulberry32(8);
    const some = makeRandomFeatures(rand, 10, 512);
    const none = makeRandomFeatures(rand, 0, 512);

    expect(matchDescriptors(none, some)).toEqual([]);
    expect(matchDescriptors(some, none)).toEqual([]);
  });

  it('matches 500×500 descriptors within the time budget', () => {
    const rand = mulberry32(9);
    const query = makeRandomFeatures(rand, 500, 512);
    const ref = makeRandomFeatures(rand, 500, 512);
    matchDescriptors(query, ref);

    const start = performance.now();
    matchDescriptors(query, ref);
    const elapsed = performance.now() - start;

    console.log(`500×500 ORB match: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(150);
  });
});

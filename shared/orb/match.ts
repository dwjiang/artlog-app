import type { OrbFeatures } from "./features";
import { DESCRIPTOR_WORDS, descriptorWords, hammingDistance32 } from "./hamming";

export type Match = { queryIdx: number; refIdx: number; distance: number };
export type MatchOptions = {
  ratio?: number;
  maxDistance?: number;
  crossCheck?: boolean;
};

// One past the largest 256-bit distance, so a lone reference row always passes the ratio test.
const NO_MATCH = 257;

export function matchDescriptors(query: OrbFeatures, ref: OrbFeatures, opts: MatchOptions = {}): Match[] {
  const ratio = opts.ratio ?? 0.8;
  const maxDistance = opts.maxDistance ?? 64;
  const crossCheck = opts.crossCheck ?? false;
  const q = descriptorWords(query);
  const r = descriptorWords(ref);
  const refBest = new Uint16Array(ref.count).fill(NO_MATCH);
  const refBestQuery = new Int32Array(ref.count).fill(-1);
  const matches: Match[] = [];

  for (let i = 0; i < query.count; i++) {
    const qWord = i * DESCRIPTOR_WORDS;
    let best = NO_MATCH;
    let second = NO_MATCH;
    let bestIdx = -1;
    for (let j = 0, rWord = 0; j < ref.count; j++, rWord += DESCRIPTOR_WORDS) {
      const d = hammingDistance32(q, qWord, r, rWord);
      if (d < best) {
        second = best;
        best = d;
        bestIdx = j;
      } else if (d < second) {
        second = d;
      }
      if (d < refBest[j]) {
        refBest[j] = d;
        refBestQuery[j] = i;
      }
    }
    if (bestIdx >= 0 && best <= maxDistance && best < ratio * second) {
      matches.push({ queryIdx: i, refIdx: bestIdx, distance: best });
    }
  }

  const kept = crossCheck ? matches.filter((m) => refBestQuery[m.refIdx] === m.queryIdx) : matches;
  return kept.sort((a, b) => a.distance - b.distance);
}

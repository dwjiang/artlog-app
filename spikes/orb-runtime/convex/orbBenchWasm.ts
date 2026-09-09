import { v } from 'convex/values';

import { internalAction } from './_generated/server';
import { boundedInteger, makePair, profileValidator, SEED, summarize, summaryValidator } from './benchHelpers';
import wasmModule from './hamming.wasm';
import { matchDescriptors, ransacHomography } from './lib/orb';
import type { Match } from './lib/orb/match';
import { createWasmMatcher } from './wasmMatcher';

export const bench = internalAction({
  args: { pairs: v.number(), keypoints: v.number(), runs: v.number(), profile: profileValidator },
  returns: v.object({
    pairs: v.number(), keypoints: v.number(), runs: v.number(), profile: profileValidator,
    instantiateMs: v.number(), memoryBytes: v.number(), matchingSpeedupP50: v.number(),
    jsMs: summaryValidator, wasmMs: summaryValidator, ransacMs: summaryValidator,
    samples: v.array(v.object({ jsMs: v.number(), wasmMs: v.number(), ransacMs: v.number(), matches: v.number(), inliers: v.number(), maxIterations: v.number() })),
  }),
  handler: async (_ctx, { pairs: count, keypoints, runs, profile }) => {
    boundedInteger('pairs', count, 1, 20);
    boundedInteger('keypoints', keypoints, 4, 1000);
    boundedInteger('runs', runs, 1, 100);
    const initStart = performance.now();
    const wasm = await createWasmMatcher(wasmModule);
    const instantiateMs = performance.now() - initStart;
    const pairs = Array.from({ length: count }, (_, i) => makePair(keypoints, SEED + i, profile));
    const samples = [];
    for (let run = -5; run < runs; run++) {
      let jsMs = 0;
      let wasmMs = 0;
      let ransacMs = 0;
      let matches = 0;
      let inliers = 0;
      let maxIterations = 0;
      for (const pair of pairs) {
        let js: Match[] = [];
        let accelerated: Match[] = [];
        const runJs = () => {
          const start = performance.now();
          js = matchDescriptors(pair.query, pair.ref);
          jsMs += performance.now() - start;
        };
        const runWasm = () => {
          const start = performance.now();
          accelerated = wasm.match(pair.query, pair.ref);
          wasmMs += performance.now() - start;
        };
        // Alternate order; WASM timing includes both input copies and sorted JS output objects.
        if (run % 2 === 0) { runJs(); runWasm(); }
        else { runWasm(); runJs(); }
        if (JSON.stringify(js) !== JSON.stringify(accelerated)) throw new Error('WASM/JS match mismatch');
        const start = performance.now();
        const result = ransacHomography(accelerated, pair.query, pair.ref, { threshold: 5 });
        ransacMs += performance.now() - start;
        matches += accelerated.length;
        inliers += result.inlierCount;
        maxIterations = Math.max(maxIterations, result.iterations);
      }
      if (run >= 0) samples.push({ jsMs, wasmMs, ransacMs, matches, inliers, maxIterations });
    }
    const jsMs = summarize(samples.map((s) => s.jsMs));
    const wasmMs = summarize(samples.map((s) => s.wasmMs));
    return {
      pairs: count, keypoints, runs, profile, instantiateMs, memoryBytes: wasm.memoryBytes,
      jsMs, wasmMs, ransacMs: summarize(samples.map((s) => s.ransacMs)),
      matchingSpeedupP50: jsMs.p50 / wasmMs.p50, samples,
    };
  },
});

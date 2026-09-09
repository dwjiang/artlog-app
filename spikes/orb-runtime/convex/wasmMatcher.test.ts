// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { makePair } from './benchHelpers';
import { matchDescriptors } from './lib/orb';
import { featuresFromDescriptors } from './lib/orb/testFixtures';
import { createWasmMatcher } from './wasmMatcher';

it('scalar WASM returns the exact JS matches, including ties, thresholds, and reused memory', async () => {
  const module = await WebAssembly.compile(readFileSync(new URL('./hamming.wasm', import.meta.url)));
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  const wasm = await createWasmMatcher(module);
  expect(wasm.memoryBytes).toBe(131072);
  for (const profile of ['positive', 'unrelated', 'inconsistent'] as const) {
    for (const count of [300, 500, 1000, 20]) {
      const { query, ref } = makePair(count, 20260909 + count, profile);
      expect(wasm.match(query, ref)).toEqual(matchDescriptors(query, ref));
    }
  }
  const zero = new Uint8Array(32);
  const one = new Uint8Array(32).fill(255);
  for (const query of [featuresFromDescriptors([]), featuresFromDescriptors([zero, one, zero])]) {
    for (const ref of [featuresFromDescriptors([]), featuresFromDescriptors([zero]), featuresFromDescriptors([zero, zero, one])]) {
      for (const ratio of [0.8, 1]) {
        expect(wasm.match(query, ref, ratio, 256)).toEqual(matchDescriptors(query, ref, { ratio, maxDistance: 256 }));
      }
    }
  }
  const { query, ref } = makePair(20, 1, 'positive');
  expect(() => wasm.match({ ...query, count: 1001 }, ref)).toThrow('query.count');
});

import { boundedInteger } from './benchHelpers';
import type { OrbFeatures } from './lib/orb/features';
import type { Match } from './lib/orb/match';

export async function createWasmMatcher(module: WebAssembly.Module) {
  const instance = await WebAssembly.instantiate(module, {});
  const memory = instance.exports.memory as WebAssembly.Memory;
  const match = instance.exports.match as (queryCount: number, refCount: number, ratio: number, maxDistance: number) => number;
  const bytes = new Uint8Array(memory.buffer);
  const results = new Uint32Array(memory.buffer, 64000, 3000);
  return {
    memoryBytes: memory.buffer.byteLength,
    match(query: OrbFeatures, ref: OrbFeatures, ratio = 0.8, maxDistance = 64): Match[] {
      boundedInteger('query.count', query.count, 0, 1000);
      boundedInteger('ref.count', ref.count, 0, 1000);
      if (query.descriptors.byteLength !== query.count * 32 || ref.descriptors.byteLength !== ref.count * 32) {
        throw new Error('Invalid descriptor buffer length');
      }
      bytes.set(query.descriptors, 0);
      bytes.set(ref.descriptors, 32000);
      const count = match(query.count, ref.count, ratio, maxDistance);
      const matches: Match[] = [];
      for (let i = 0; i < count; i++) {
        matches.push({ queryIdx: results[i * 3], refIdx: results[i * 3 + 1], distance: results[i * 3 + 2] });
      }
      return matches.sort((a, b) => a.distance - b.distance);
    },
  };
}

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from './_generated/api';
import { makePair, summarize } from './benchHelpers';
import { verifyOrb } from './lib/orb';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

describe('measurement inputs and summaries', () => {
  it('uses linearly interpolated percentiles without changing samples', () => {
    const samples = [40, 10, 30, 20];
    expect(summarize(samples)).toEqual({ min: 10, p50: 25, p95: 38.5, max: 40 });
    expect(samples).toEqual([40, 10, 30, 20]);
    expect(summarize([7])).toEqual({ min: 7, p50: 7, p95: 7, max: 7 });
    expect(() => summarize([])).toThrow();
    expect(() => summarize([NaN])).toThrow();
  });

  it.each([300, 500])('measures exactly %i features on each side with positive and negative controls', (count) => {
    for (const profile of ['positive', 'unrelated', 'inconsistent'] as const) {
      const { query, ref } = makePair(count, 20260909, profile);
      for (const features of [query, ref]) {
        expect(features.count).toBe(count);
        expect(features.descriptors.byteLength).toBe(count * 32);
        expect(features.descriptors.buffer.byteLength).toBe(count * 32);
        expect(features.keypoints.byteLength).toBe(count * 16);
        expect(features.keypoints.buffer.byteLength).toBe(count * 16);
      }
      const result = verifyOrb(query, ref, { inputSize: 512 });
      expect(result.verified).toBe(profile === 'positive');
      if (profile !== 'unrelated') expect(result.matchCount).toBeGreaterThan(count * 0.7);
    }
  });
});

describe('benchmark actions', () => {
  it('returns one complete sample per run and excludes warmups', async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.orbBench.bench, { pairs: 2, keypoints: 40, runs: 3, warmups: 1 });
    expect(result.samples).toHaveLength(3);
    expect(result.featureBytes).toBe(2 * 2 * 40 * 48);
    for (const sample of result.samples) {
      expect(sample.pairMs).toHaveLength(2);
      expect(sample.verified).toBe(2);
      expect(sample.totalMs).toBeGreaterThanOrEqual(0);
    }
    await expect(t.action(internal.orbBench.bench, { pairs: 10.5, keypoints: 500, runs: 1 })).rejects.toThrow('pairs');
    await expect(t.action(internal.orbBench.bench, { pairs: 10, keypoints: 500, runs: 0 })).rejects.toThrow('runs');
  });

  it('seeds once, reads full byte payloads by object ID, and replaces changed feature sizes', async () => {
    const t = convexTest(schema, modules);
    const first = await t.action(internal.orbBench.benchRead, { n: 20, keypoints: 500, runs: 2 });
    expect(first.featureBytes).toBe(480000);
    expect(first.samples).toHaveLength(2);
    expect(first.samples.every((s) => s.bytes === 480000 && s.count === 10000)).toBe(true);
    const ids = await t.mutation(internal.orbBench.seedDescriptors, { n: 20, keypoints: 500 });
    const again = await t.mutation(internal.orbBench.seedDescriptors, { n: 20, keypoints: 300 });
    expect(again).toEqual(ids);
    const rows = await t.query(internal.orbBench.readDescriptors, { objectIds: ids });
    expect(rows.every((r) => r.keypointCount === 300 && r.descriptors.byteLength === 9600 && r.keypoints.byteLength === 4800)).toBe(true);
    const permuted = await t.action(internal.orbBench.benchRead, { n: 20, keypoints: 300, runs: 2, permute: true });
    expect(permuted.samples.every((s) => s.bytes === 288000 && s.count === 6000)).toBe(true);
    await expect(t.action(internal.orbBench.benchRead, { n: 41 })).rejects.toThrow('n');
  });

  it('retains and verifies all requested memory-probe pairs', async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.orbBench.memory, { pairs: 3, keypoints: 40 });
    expect(result.featureBytes).toBe(3 * 2 * 40 * 48);
    expect(result.verified).toBe(3);
    expect(result.checksum).toBeGreaterThan(0);
  });
});

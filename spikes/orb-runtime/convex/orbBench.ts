import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { boundedInteger, INPUT_SIZE, makePair, profileValidator, SEED, summarize, summaryValidator } from './benchHelpers';
import { decodeOrbFeatures, encodeOrbFeatures, verifyOrb } from './lib/orb';
import { mulberry32 } from './lib/orb/homography';
import { makeRandomFeatures } from './lib/orb/testFixtures';
import { descriptorFields } from './schema';

export const bench = internalAction({
  args: {
    pairs: v.number(), keypoints: v.number(), runs: v.number(),
    profile: v.optional(profileValidator), seed: v.optional(v.number()),
    warmups: v.optional(v.number()),
  },
  returns: v.object({
    pairs: v.number(), keypoints: v.number(), runs: v.number(), profile: profileValidator,
    seed: v.number(), warmups: v.number(), featureBytes: v.number(),
    totalMs: summaryValidator, perPairMs: summaryValidator,
    samples: v.array(v.object({ totalMs: v.number(), pairMs: v.array(v.number()), verified: v.number(), inliers: v.number() })),
  }),
  handler: async (_ctx, args) => {
    boundedInteger('pairs', args.pairs, 1, 40);
    boundedInteger('keypoints', args.keypoints, 4, 1000);
    boundedInteger('runs', args.runs, 1, 100);
    const profile = args.profile ?? 'positive';
    const seed = args.seed ?? SEED;
    const warmups = args.warmups ?? 5;
    boundedInteger('warmups', warmups, 0, 10);
    const pairs = Array.from({ length: args.pairs }, (_, i) => makePair(args.keypoints, seed + i, profile));
    const samples = [];
    for (let run = -warmups; run < args.runs; run++) {
      const pairMs = [];
      let verified = 0;
      let inliers = 0;
      const start = performance.now();
      for (const { query, ref } of pairs) {
        const pairStart = performance.now();
        const result = verifyOrb(query, ref, { inputSize: INPUT_SIZE });
        pairMs.push(performance.now() - pairStart);
        verified += Number(result.verified);
        inliers += result.inlierCount;
      }
      const totalMs = performance.now() - start;
      if (run >= 0) samples.push({ totalMs, pairMs, verified, inliers });
    }
    return {
      pairs: args.pairs, keypoints: args.keypoints, runs: args.runs, profile, seed, warmups,
      featureBytes: args.pairs * 2 * args.keypoints * 48,
      totalMs: summarize(samples.map((s) => s.totalMs)),
      perPairMs: summarize(samples.flatMap((s) => s.pairMs)), samples,
    };
  },
});

export const memory = internalAction({
  args: { pairs: v.number(), keypoints: v.number() },
  returns: v.object({ pairs: v.number(), keypoints: v.number(), featureBytes: v.number(), verified: v.number(), checksum: v.number(), verifyMs: v.number() }),
  handler: async (_ctx, { pairs: count, keypoints }) => {
    boundedInteger('pairs', count, 1, 2048);
    boundedInteger('keypoints', keypoints, 4, 1000);
    const pairs = Array.from({ length: count }, (_, i) => makePair(keypoints, SEED + i, 'positive'));
    const start = performance.now();
    let verified = 0;
    for (const { query, ref } of pairs) verified += Number(verifyOrb(query, ref, { inputSize: INPUT_SIZE }).verified);
    const verifyMs = performance.now() - start;
    // Read every retained buffer after verification so earlier pairs cannot be reclaimed during it.
    let checksum = 0;
    for (const { query, ref } of pairs) {
      for (const f of [query, ref]) {
        for (const x of f.descriptors) checksum += x;
        for (const x of f.keypoints) checksum += x;
      }
    }
    return { pairs: count, keypoints, featureBytes: count * 2 * keypoints * 48, verified, checksum, verifyMs };
  },
});

export const seedDescriptors = internalMutation({
  args: { n: v.number(), keypoints: v.number() },
  returns: v.array(v.id('objects')),
  handler: async (ctx, { n, keypoints }) => {
    boundedInteger('n', n, 1, 40);
    boundedInteger('keypoints', keypoints, 4, 1000);
    const ids: Id<'objects'>[] = [];
    for (let ordinal = 0; ordinal < n; ordinal++) {
      let object = await ctx.db.query('objects').withIndex('by_ordinal', (q) => q.eq('ordinal', ordinal)).unique();
      if (!object) {
        const id = await ctx.db.insert('objects', { ordinal });
        object = (await ctx.db.get('objects', id))!;
      }
      const existing = await ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', object._id)).unique();
      if (!existing || existing.keypointCount !== keypoints) {
        const features = makeRandomFeatures(mulberry32(SEED + ordinal), keypoints, INPUT_SIZE);
        const fields = {
          objectId: object._id, ...encodeOrbFeatures(features), keypointCount: keypoints,
          inputSize: INPUT_SIZE, extractedFrom: 'synthetic:orb-runtime',
        };
        if (existing) await ctx.db.replace('descriptors', existing._id, fields);
        else await ctx.db.insert('descriptors', fields);
      }
      ids.push(object._id);
    }
    return ids;
  },
});

export const readDescriptors = internalQuery({
  args: { objectIds: v.array(v.id('objects')) },
  returns: v.array(v.object({ ...descriptorFields, _id: v.id('descriptors'), _creationTime: v.number() })),
  handler: async (ctx, { objectIds }) => {
    boundedInteger('objectIds.length', objectIds.length, 1, 40);
    return await Promise.all(objectIds.map(async (objectId) => {
      const row = await ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', objectId)).unique();
      if (!row) throw new Error('Missing benchmark descriptors');
      return row;
    }));
  },
});

export const benchRead = internalAction({
  args: { n: v.number(), keypoints: v.optional(v.number()), runs: v.optional(v.number()), permute: v.optional(v.boolean()) },
  returns: v.object({
    n: v.number(), keypoints: v.number(), featureBytes: v.number(), permute: v.boolean(),
    firstReadMs: v.number(), readMs: summaryValidator, decodeMs: summaryValidator,
    samples: v.array(v.object({ readMs: v.number(), decodeMs: v.number(), bytes: v.number(), count: v.number() })),
  }),
  handler: async (ctx, { n, keypoints = 500, runs = 100, permute = false }) => {
    boundedInteger('runs', runs, 1, 100);
    const objectIds: Id<'objects'>[] = await ctx.runMutation(internal.orbBench.seedDescriptors, { n, keypoints });
    const samples = [];
    let firstReadMs = 0;
    for (let run = -1; run < runs; run++) {
      const orderedIds = [...objectIds];
      if (permute) {
        // Different argument permutations avoid reusing the same cached query result.
        const random = mulberry32(SEED + run);
        for (let i = orderedIds.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [orderedIds[i], orderedIds[j]] = [orderedIds[j], orderedIds[i]];
        }
      }
      const start = performance.now();
      const rows: Doc<'descriptors'>[] = await ctx.runQuery(internal.orbBench.readDescriptors, { objectIds: orderedIds });
      const readMs = performance.now() - start;
      const decodeStart = performance.now();
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const decoded = decodeOrbFeatures(row.descriptors, row.keypoints);
        if (decoded.count !== keypoints) throw new Error('Wrong keypoint count');
        count += decoded.count;
        bytes += row.descriptors.byteLength + row.keypoints.byteLength;
      }
      const decodeMs = performance.now() - decodeStart;
      if (rows.length !== n || bytes !== n * keypoints * 48) throw new Error('Incomplete descriptor read');
      if (run === -1) firstReadMs = readMs;
      else samples.push({ readMs, decodeMs, bytes, count });
    }
    return {
      n, keypoints, featureBytes: n * keypoints * 48, permute, firstReadMs,
      readMs: summarize(samples.map((s) => s.readMs)),
      decodeMs: summarize(samples.map((s) => s.decodeMs)), samples,
    };
  },
});

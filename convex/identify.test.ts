import { afterEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import { encodeOrbFeatures } from './lib/orb';
import { makeSyntheticPair } from './lib/orb/testFixtures';
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from './lib/testFactories';
import { harness, signIn } from './test.helpers';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const pair = makeSyntheticPair({ count: 120 });
const capture = () => ({
  localId: crypto.randomUUID(), vector: testVector(), ...encodeOrbFeatures(pair.query),
  modelVersion: model.modelVersion, capturedAt: Date.now(),
});

async function fixture(indexStatus: 'complete' | 'queued' | 'building' = 'complete', withWork = true) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, {
    indexStatus: { status: indexStatus, pagesMapped: 20, worksIndexed: 3, updatedAt: Date.now() },
  }));
  const visitId = await t.run((ctx) => ctx.db.insert('visits', {
    deviceId: user.deviceId, venueId, startedAt: Date.now(),
  }));
  const work = withWork ? await t.run((ctx) => seedArtworkWithObject(ctx, {
    descriptors: pair.ref,
    placement: { venueId, gallery: '4', onView: true, source: 'feed', confidence: 1 },
  })) : null;
  return { t, user, venueId, visitId, work, args: { ...capture(), venueId, visitId } };
}

describe('identify action', () => {
  it('returns verified corners and display data, persists the embedding, and updates the visit gallery', async () => {
    const { t, user, visitId, args, work } = await fixture();
    const result = await user.as.action(api.identify.identify, args);
    expect(result).toMatchObject({ status: 'identified', outcome: 'confident', calibratorVersion: 'lr-v1', best: {
      objectId: work!.objectId, title: 'Water Lilies', artist: 'Claude Monet', rightsStatus: 'public_domain',
    } });
    expect(result.best?.corners).toHaveLength(4);
    expect(await user.as.query(api.scans.get, { scanId: result.scanId })).toEqual(result);
    expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '4', lastConfidentAt: args.capturedAt });
    const scan = await t.run((ctx) => ctx.db.get(result.scanId));
    expect(scan?.vector).toEqual(args.vector);
    expect(scan?.descriptors).toBeUndefined();
  });

  it('returns an update status for unsupported models before decoding old feature formats', async () => {
    const { user, args } = await fixture();
    const result = await user.as.action(api.identify.identify, {
      ...args, modelVersion: 'obsolete', vector: [1], descriptors: new ArrayBuffer(1),
    });
    expect(result).toMatchObject({ status: 'unsupported_version', error: 'Update the app to identify.' });
    expect(result.best).toBeUndefined();
  });

  it.each([
    { vector: [1] }, { vector: Array(model.embeddingDim).fill(0) },
    { vector: [NaN, ...Array(model.embeddingDim - 1).fill(1)] },
  ])('rejects invalid vectors before creating a scan', async (invalid) => {
    const { t, user, args } = await fixture();
    await expect(user.as.action(api.identify.identify, { ...args, ...invalid })).rejects.toMatchObject({ data: { code: 'bad_vector' } });
    expect(await t.run((ctx) => ctx.db.query('scans').collect())).toEqual([]);
  });

  it.each([
    { descriptors: new ArrayBuffer(1) }, { keypoints: new ArrayBuffer(1) },
  ])('maps malformed ORB buffers to bad_features before creating a scan', async (invalid) => {
    const { t, user, args } = await fixture();
    await expect(user.as.action(api.identify.identify, { ...args, ...invalid })).rejects.toMatchObject({ data: { code: 'bad_features' } });
    expect(await t.run((ctx) => ctx.db.query('scans').collect())).toEqual([]);
  });

  it('requires an authenticated, registered, unbanned device', async () => {
    const t = harness();
    await expect(t.action(api.identify.identify, capture())).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    const unregistered = await signIn(t);
    await expect(unregistered.as.action(api.identify.identify, capture())).rejects.toMatchObject({ data: { code: 'device_not_registered' } });
    const user = await seedDevice(t);
    await t.run((ctx) => ctx.db.patch(user.deviceId, { banned: true }));
    await expect(user.as.action(api.identify.identify, capture())).rejects.toMatchObject({ data: { code: 'device_banned' } });
  });

  it('refuses a foreign visit before search or writes', async () => {
    const { t, args } = await fixture();
    const other = await seedDevice(t);
    await expect(other.as.action(api.identify.identify, args)).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
    expect(await t.run((ctx) => ctx.db.query('scans').collect())).toEqual([]);
  });

  it('filters vector search only by model version, including equally similar vectors from other models', async () => {
    const { t, user, args } = await fixture('complete', false);
    await t.run(async (ctx) => {
      for (let i = 0; i < 33; i++) await seedArtworkWithObject(ctx, { modelVersion: 'other-model', descriptors: pair.ref });
    });
    const result = await user.as.action(api.identify.identify, args);
    expect(result).toMatchObject({ status: 'identified', outcome: 'miss', runnerUps: [] });
    expect(result.best).toBeUndefined();
  });

  it('keeps a textured candidate soft when the query cannot verify it', async () => {
    const { user, args } = await fixture();
    const result = await user.as.action(api.identify.identify, { ...args, descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0) });
    expect(result.outcome).toBe('soft');
    expect(result.best?.corners).toBeUndefined();
  });

  it.each(['queued', 'building'] as const)('retains features and soft candidates while the venue is %s', async (status) => {
    const { t, user, args } = await fixture(status);
    const result = await user.as.action(api.identify.identify, { ...args, descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0) });
    expect(result).toMatchObject({ status: 'waiting', outcome: 'soft', indexStatus: { status, pagesMapped: 20, worksIndexed: 3 } });
    expect(result.best?.title).toBe('Water Lilies');
    expect(await t.run((ctx) => ctx.db.get(result.scanId))).toMatchObject({ keypointCount: 0, descriptors: new ArrayBuffer(0) });
  });

  it('returns confident results immediately even when the venue is building', async () => {
    const { user, args } = await fixture('building');
    expect(await user.as.action(api.identify.identify, args)).toMatchObject({ status: 'identified', outcome: 'confident' });
  });

  it('resolves a waiting scan with newly indexed candidates and clears temporary features', async () => {
    const { t, user, venueId, args } = await fixture('building', false);
    const waiting = await user.as.action(api.identify.identify, args);
    expect(waiting.status).toBe('waiting');
    await t.run(async (ctx) => {
      await seedArtworkWithObject(ctx, { descriptors: pair.ref,
        placement: { venueId, gallery: '4', onView: true, source: 'feed', confidence: 1 } });
      await ctx.db.patch(venueId, { indexStatus: { status: 'complete', pagesMapped: 20, worksIndexed: 20, updatedAt: Date.now() } });
    });
    await t.action(internal.identify.rerunWaiting, { venueId });
    const result = await user.as.query(api.scans.get, { scanId: waiting.scanId });
    expect(result).toMatchObject({ status: 'identified', outcome: 'confident' });
    expect((await t.run((ctx) => ctx.db.get(waiting.scanId)))?.descriptors).toBeUndefined();
  });

  it('forces a terminal result when rerunning even if index status still says building', async () => {
    const { t, user, venueId, args } = await fixture('building', false);
    const waiting = await user.as.action(api.identify.identify, args);
    await t.action(internal.identify.rerunWaiting, { venueId });
    expect(await user.as.query(api.scans.get, { scanId: waiting.scanId })).toMatchObject({ status: 'identified', outcome: 'miss' });
  });

  it('resolves every page of waiting scans as earlier pages leave the waiting index', async () => {
    vi.useFakeTimers();
    const { t, user, venueId, args } = await fixture('building', false);
    const scanIds = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 27; i++) ids.push(await ctx.db.insert('scans', {
        ...args, localId: String(i), deviceId: user.deviceId, keypointCount: pair.query.count,
        status: 'waiting', createdAt: Date.now(), updatedAt: Date.now(),
      }));
      return ids;
    });
    await t.action(internal.identify.rerunWaiting, { venueId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const scans = await t.run(async (ctx) => Promise.all(scanIds.map((id) => ctx.db.get(id))));
    expect(scans.every((scan) => scan?.status === 'identified' && scan.descriptors === undefined)).toBe(true);
    expect((await t.query(internal.scans.listWaiting, { venueId })).page).toEqual([]);
  });

  it('marks queued scans unsupported and clears features if their model is retired', async () => {
    const { t, user, venueId, args } = await fixture('building', false);
    const waiting = await user.as.action(api.identify.identify, args);
    vi.stubEnv('SUPPORTED_MODEL_VERSIONS', 'replacement-model');
    await t.action(internal.identify.rerunWaiting, { venueId });
    expect(await user.as.query(api.scans.get, { scanId: waiting.scanId })).toMatchObject({ status: 'unsupported_version' });
    expect((await t.run((ctx) => ctx.db.get(waiting.scanId)))?.keypoints).toBeUndefined();
  });

  it('returns the same stored result on retry even if the index has since changed', async () => {
    const { t, user, args, work } = await fixture();
    const first = await user.as.action(api.identify.identify, args);
    await t.run((ctx) => ctx.db.delete(work!.vectorId));
    expect(await user.as.action(api.identify.identify, args)).toEqual(first);
    expect(await t.run((ctx) => ctx.db.query('scans').collect())).toHaveLength(1);
  });

  it('rejects the 21st identify call in a burst', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { user, args } = await fixture('complete', false);
    for (let i = 0; i < 20; i++) await user.as.action(api.identify.identify, args);
    await expect(user.as.action(api.identify.identify, args)).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'identify' } });
  });

  it.each(['unique', 'multiple', 'unknown'] as const)('proposes a venue mismatch according to multiplicity (%s), deduplicating retries and devices', async (multiplicity) => {
    const { t, user, args, work } = await fixture();
    const otherVenue = await t.run((ctx) => seedMuseum(ctx));
    await t.run((ctx) => ctx.db.patch(work!.artworkId, { multiplicity }));
    const firstArgs = { ...args, venueId: otherVenue, visitId: undefined };
    const result = await user.as.action(api.identify.identify, firstArgs);
    expect(result.outcome).toBe('confident');
    await user.as.action(api.identify.identify, firstArgs);
    await user.as.action(api.identify.identify, { ...firstArgs, localId: 'another-capture' });
    const before = await t.run((ctx) => ctx.db.query('placementProposals').collect());
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ kind: multiplicity === 'unique' ? 'move' : 'new_object', readyForReview: false, deviceIds: [user.deviceId] });
    expect(before[0].scanIds).toHaveLength(2);
    const other = await seedDevice(t);
    await other.as.action(api.identify.identify, firstArgs);
    const proposal = await t.run((ctx) => ctx.db.get(before[0]._id));
    expect(proposal).toMatchObject({ readyForReview: true, deviceIds: [user.deviceId, other.deviceId] });
    expect(proposal?.scanIds).toHaveLength(3);
  });
});

describe('candidate loading', () => {
  it('collapses merged objects and duplicate vectors using their maximum score', async () => {
    const t = harness();
    const { target, merged, second, duplicate } = await t.run(async (ctx) => {
      const target = await seedArtworkWithObject(ctx);
      const merged = await seedArtworkWithObject(ctx, { object: { mergedInto: target.objectId } });
      const second = await seedArtworkWithObject(ctx);
      const duplicate = await ctx.db.insert('vectors', {
        objectId: target.objectId, modelVersion: model.modelVersion, source: 'user_scan',
        vector: Array(model.embeddingDim).fill(1),
      });
      return { target, merged, second, duplicate };
    });
    const candidates = await t.query(internal.identify.loadCandidates, {
      vectorIds: [target.vectorId, merged.vectorId, second.vectorId, duplicate],
      scores: [0.9, 0.99, 0.8, 0.95], now: Date.now(),
    });
    expect(candidates.map((c) => c.object._id)).toEqual([target.objectId, second.objectId]);
    expect(candidates[0]).toMatchObject({ similarity: 0.99, runnerUpSimilarity: 0.8, keypointCount: 0 });
    expect(candidates[1].runnerUpSimilarity).toBe(0.99);
  });

  it('excludes reverted objects, missing targets, and merge chains beyond one hop', async () => {
    const t = harness();
    const rows = await t.run(async (ctx) => {
      const reverted = await seedArtworkWithObject(ctx, { object: { reverted: true } });
      const toReverted = await seedArtworkWithObject(ctx, { object: { mergedInto: reverted.objectId } });
      const chain = await seedArtworkWithObject(ctx, { object: { mergedInto: toReverted.objectId } });
      const missing = await seedArtworkWithObject(ctx);
      await ctx.db.delete(missing.objectId);
      return [reverted, toReverted, chain, missing];
    });
    expect(await t.query(internal.identify.loadCandidates, {
      vectorIds: rows.map((r) => r.vectorId), scores: rows.map(() => 0.99), now: Date.now(),
    })).toEqual([]);
  });

  it('loads at most 20 candidates with full descriptor rows and treats venue and rights as attributes', async () => {
    const t = harness();
    const pair = makeSyntheticPair({ count: 375, outlierFraction: 0 });
    const { venueId, rows } = await t.run(async (ctx) => {
      const venueId = await seedMuseum(ctx);
      const rows = [];
      for (let i = 0; i < 25; i++) rows.push(await seedArtworkWithObject(ctx, {
        descriptors: pair.ref, artwork: { rightsStatus: 'in_copyright' },
        placement: { venueId, gallery: '2', onView: false, source: 'feed', confidence: 1 },
      }));
      return { venueId, rows };
    });
    const candidates = await t.query(internal.identify.loadCandidates, {
      vectorIds: rows.map((r) => r.vectorId), scores: rows.map((_, i) => 0.9 - i / 100),
      now: Date.now(), venueId: await t.run((ctx) => seedMuseum(ctx)),
    });
    expect(candidates).toHaveLength(20);
    expect(candidates[0]).toMatchObject({ placement: { venueId, onView: false, gallery: '2' }, institution: 'Test Museum' });
    expect(candidates.every((c) => c.keypointCount === 375)).toBe(true);
    expect(candidates[0].descriptors!.byteLength + candidates[0].keypoints!.byteLength).toBe(18000);
    expect(candidates.map((c) => c.object._id)).toEqual(rows.slice(0, 20).map((r) => r.objectId));
  });
});

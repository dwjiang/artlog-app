import { afterEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { encodeOrbFeatures } from '../shared/orb';
import { makeSyntheticPair } from '../shared/orb/test-fixtures';
import { seedArtworkWithObject, seedContribution, seedDevice, seedMuseum, seedScan, testVector } from './lib/testFactories';
import { harness } from './test.helpers';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const pair = makeSyntheticPair({ count: 120 });
const features = encodeOrbFeatures(pair.ref);

async function seedUserObject(ctx: MutationCtx, options: {
  venueId: Id<'museums'>; deviceIds: Id<'devices'>[]; contributionIds?: Id<'contributions'>[];
  thumbnailStorageId?: Id<'_storage'>; artworkId?: Id<'artworks'>; title?: string;
}) {
  const sourceId = crypto.randomUUID();
  const artworkId = options.artworkId ?? await ctx.db.insert('artworks', {
    key: `user:${sourceId}`, title: options.title ?? 'Water Lilies', artist: 'Claude Monet', rightsStatus: 'unknown', multiplicity: 'unknown',
  });
  const objectId = await ctx.db.insert('objects', {
    key: `user:${sourceId}`, artworkId, ownerId: options.venueId, source: 'user', sourceId,
    thumbnailStorageId: options.thumbnailStorageId,
    provenance: { contributionIds: options.contributionIds ?? [], deviceIds: options.deviceIds },
    confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false,
  });
  await ctx.db.insert('vectors', { objectId, modelVersion: model.modelVersion, source: 'user', vector: testVector() });
  await ctx.db.insert('placements', { objectId, venueId: options.venueId, onView: true, source: 'contribution', confidence: 0.7 });
  return { artworkId, objectId };
}

async function fixture() {
  vi.useFakeTimers({ now: Date.UTC(2026, 8, 10, 12) });
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const get = <T extends 'contributions' | 'objects' | 'devices' | 'artworks' | 'feedback' | 'museums' | 'placementProposals' | 'optOuts' | 'takedowns'>(id: Id<T>) =>
    t.run((ctx) => ctx.db.get(id)) as Promise<Doc<T> | null>;
  const all = <T extends 'objects' | 'vectors' | 'descriptors' | 'placements' | 'contributions'>(table: T) =>
    t.run((ctx) => ctx.db.query(table).collect()) as Promise<Doc<T>[]>;
  const finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const scheduled = () => t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
  return { t, alice, bob, venueId, get, all, finish, scheduled };
}

describe('revertObject', () => {
  it('keeps a shared ORB file until the last object reference is removed', async () => {
    const t = harness();
    const { first, second, storageId } = await t.run(async (ctx) => {
      const first = await seedArtworkWithObject(ctx, { descriptors: pair.ref });
      const second = await seedArtworkWithObject(ctx);
      const { _id: _referenceId, _creationTime: _createdAt, ...reference } = (await ctx.db.query('descriptors').unique())!;
      await ctx.db.insert('descriptors', { ...reference, objectId: second.objectId });
      return { first, second, storageId: reference.storageId };
    });
    await t.action(internal.revert.revertObjectById, { objectId: first.objectId, reason: 'test' });
    expect(await t.run((ctx) => ctx.db.system.get('_storage', storageId))).not.toBeNull();
    await t.action(internal.revert.revertObjectById, { objectId: second.objectId, reason: 'test' });
    expect(await t.run((ctx) => ctx.db.system.get('_storage', storageId))).toBeNull();
  });

  it('removes the work from identification, closes its placement, deletes the crop and rejects its contributions', async () => {
    const { t, alice, venueId, get, all } = await fixture();
    const cropStorageId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })));
    const contributionId = await t.run((ctx) => seedContribution(ctx, {
      deviceId: alice.deviceId, venueId, cropStorageId, ...features, keypointCount: pair.ref.count, evidence: ['qr'],
      fields: { title: { value: 'Water Lilies', edited: false, evidence: 'qr' }, artist: { value: 'Claude Monet', edited: false, evidence: 'qr' } },
    }));
    await t.action(internal.promotion.run, {});
    const [object] = await all('objects');
    const capture = () => ({
      localId: crypto.randomUUID(), venueId, vector: testVector(), ...encodeOrbFeatures(pair.query), modelVersion: model.modelVersion, capturedAt: Date.now(),
    });
    expect((await alice.as.action(api.identify.identify, capture())).best?.objectId).toBe(object._id);
    await t.action(internal.revert.revertObjectById, { objectId: object._id, reason: 'mislabeled' });
    expect(await get(object._id)).toMatchObject({ reverted: true, revertedReason: 'mislabeled' });
    expect((await get(object._id))?.thumbnailStorageId).toBeUndefined();
    expect(await all('vectors')).toEqual([]);
    expect(await all('descriptors')).toEqual([]);
    expect(await all('placements')).toMatchObject([{ objectId: object._id, closedAt: Date.now() }]);
    expect(await t.run((ctx) => ctx.db.system.get('_storage', cropStorageId))).toBeNull();
    expect(await get(contributionId)).toMatchObject({ status: 'rejected', rejectedReason: 'object_reverted', promotedObjectId: object._id });
    expect((await get(contributionId))?.cropStorageId).toBeUndefined();
    const after = await alice.as.action(api.identify.identify, capture());
    expect(after.outcome).toBe('miss');
    expect(after.best).toBeUndefined();
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({ vectors: 0, descriptors: 0 });
  });
});

describe('revertDevice', () => {
  it('bans the device and cascades to its objects, contributions, proposals and feedback across chunks', async () => {
    const { t, alice, bob, venueId, get, all, finish, scheduled } = await fixture();
    const seeded = await t.run(async (ctx) => {
      const promoted = await seedContribution(ctx, { deviceId: alice.deviceId, venueId, status: 'promoted' });
      const partner = await seedContribution(ctx, { deviceId: bob.deviceId, venueId, status: 'promoted' });
      const shared = await seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId, bob.deviceId], contributionIds: [promoted, partner] });
      await ctx.db.patch(promoted, { promotedObjectId: shared.objectId });
      await ctx.db.patch(partner, { promotedObjectId: shared.objectId });
      const mine: Id<'objects'>[] = [];
      for (let i = 0; i < 29; i++) mine.push((await seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId], title: `Study ${i}` })).objectId);
      const theirs = await seedUserObject(ctx, { venueId, deviceIds: [bob.deviceId] });
      const duplicate = await seedContribution(ctx, { deviceId: alice.deviceId, venueId, status: 'rejected', rejectedReason: 'duplicate' });
      const waiting = await seedContribution(ctx, { deviceId: alice.deviceId, venueId, status: 'pending' });
      const scanId = await seedScan(ctx, { deviceId: alice.deviceId, venueId });
      const proposal = (deviceIds: Id<'devices'>[]) => ctx.db.insert('placementProposals', {
        objectId: theirs.objectId, proposedVenueId: venueId, kind: 'move', scanIds: [scanId], deviceIds,
        firstSeenAt: Date.now(), lastSeenAt: Date.now(), status: 'pending', readyForReview: deviceIds.length >= 2,
      });
      const tainted = await proposal([bob.deviceId, alice.deviceId]);
      const clean = await proposal([bob.deviceId]);
      const multiViewVectorId = await ctx.db.insert('vectors', {
        objectId: theirs.objectId, modelVersion: model.modelVersion, source: 'user_scan', vector: testVector(0.9),
      });
      const feedbackId = await ctx.db.insert('feedback', {
        scanId, deviceId: alice.deviceId, vector: testVector(0.9), modelVersion: model.modelVersion, venueId,
        rejectedObjectId: shared.objectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9, calibratorVersion: 'lr-v1',
        venueMismatch: false, penaltyAdded: 0, resolution: { kind: 'runner_up', objectId: theirs.objectId },
        multiViewAt: Date.now(), multiViewVectorId, createdAt: Date.now(),
      });
      return { promoted, partner, shared, mine, theirs, duplicate, waiting, tainted, clean, multiViewVectorId, feedbackId };
    });
    const first = await t.mutation(internal.revert.revertDevice, { deviceId: alice.deviceId, reason: 'flooding' });
    expect(first).toEqual({ phase: 'objects', cursor: null });
    expect(await get(alice.deviceId)).toMatchObject({ banned: true, bannedReason: 'flooding' });
    expect(await get(seeded.promoted)).toMatchObject({ status: 'rejected', rejectedReason: 'device_reverted' });
    expect((await all('objects')).filter((object) => object.reverted)).toEqual([]);
    await finish();
    // Two object chunks for 31 user objects, then proposals and feedback.
    expect((await scheduled()).length).toBeGreaterThanOrEqual(4);
    for (const objectId of [seeded.shared.objectId, ...seeded.mine]) {
      expect(await get(objectId)).toMatchObject({ reverted: true, revertedReason: 'device_reverted: flooding' });
    }
    expect(await get(seeded.theirs.objectId)).toMatchObject({ reverted: false });
    expect((await all('vectors')).map((row) => row.objectId)).toEqual([seeded.theirs.objectId]);
    expect((await all('placements')).filter((row) => row.closedAt === undefined).map((row) => row.objectId)).toEqual([seeded.theirs.objectId]);
    expect(await get(seeded.promoted)).toMatchObject({ status: 'rejected', rejectedReason: 'device_reverted' });
    expect(await get(seeded.waiting)).toMatchObject({ status: 'rejected', rejectedReason: 'device_reverted' });
    expect(await get(seeded.duplicate)).toMatchObject({ status: 'rejected', rejectedReason: 'duplicate' });
    expect(await get(seeded.partner)).toMatchObject({ status: 'rejected', rejectedReason: 'object_reverted' });
    expect(await get(seeded.tainted)).toMatchObject({ status: 'rejected', reviewedAt: Date.now() });
    expect(await get(seeded.clean)).toMatchObject({ status: 'pending' });
    expect(await get(seeded.feedbackId)).toMatchObject({ resolution: { kind: 'unresolved' } });
    expect((await get(seeded.feedbackId))?.multiViewVectorId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(seeded.multiViewVectorId))).toBeNull();
    expect(await bob.as.query(api.devices.me, {})).toMatchObject({ deviceId: bob.deviceId });
    await expect(alice.as.query(api.devices.me, {})).rejects.toMatchObject({ data: { code: 'device_banned' } });
  });
});

describe('applyOptOut', () => {
  it('flips the venue, blocks its page fetches and reverts user objects placed there across chunks', async () => {
    const { t, alice, venueId, get, all, finish } = await fixture();
    const elsewhere = await t.run((ctx) => seedMuseum(ctx));
    const seeded = await t.run(async (ctx) => {
      const mine: Id<'objects'>[] = [];
      for (let i = 0; i < 30; i++) mine.push((await seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId], title: `Study ${i}` })).objectId);
      const corpus = await seedArtworkWithObject(ctx, { placement: { venueId, onView: true, source: 'feed', confidence: 1 } });
      const away = await seedUserObject(ctx, { venueId: elsewhere, deviceIds: [alice.deviceId] });
      return { mine, corpus, away };
    });
    const optOutId = await t.mutation(internal.revert.applyOptOut, { venueId, requester: 'registrar@museum.example' });
    expect(await get(venueId)).toMatchObject({ optOut: true });
    expect(await get(optOutId)).toMatchObject({ venueId, requester: 'registrar@museum.example', receivedAt: Date.now() });
    expect((await get(optOutId))?.appliedAt).toBeUndefined();
    expect(await t.query(internal.museums.getForProbe, { venueId })).toBeNull();
    await finish();
    expect((await get(optOutId))?.appliedAt).toBe(Date.now());
    for (const objectId of seeded.mine) expect(await get(objectId)).toMatchObject({ reverted: true, revertedReason: `opt_out: ${venueId}` });
    expect(await get(seeded.corpus.objectId)).toMatchObject({ reverted: false });
    expect(await get(seeded.away.objectId)).toMatchObject({ reverted: false });
    expect((await all('vectors')).map((row) => row.objectId).sort()).toEqual([seeded.corpus.objectId, seeded.away.objectId].sort());
  });
});

describe('applyTakedown', () => {
  const factSheet = [{ id: 'f1', text: 'Painted in 1916.', sourceUrl: 'https://museum.example/work', sourceLabel: 'Museum', sourceScore: 1 }];
  const docent = { en: [{ sentence: 'Painted in 1916.', factIds: ['f1'] }] };

  it('clears the artwork prose, holds regeneration, and reverts every object of the artwork', async () => {
    const { t, alice, venueId, get, all, finish } = await fixture();
    const seeded = await t.run(async (ctx) => {
      const corpus = await seedArtworkWithObject(ctx, {
        artwork: { factSheet, factSheetUpdatedAt: 1, docent, docentUpdatedAt: 1, enrichGeneration: 3 },
        placement: { venueId, onView: true, source: 'feed', confidence: 1 },
      });
      const user = await seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId], artworkId: corpus.artworkId });
      const other = await seedArtworkWithObject(ctx, { artwork: { title: 'Haystacks', factSheet, factSheetUpdatedAt: 1, docent } });
      return { corpus, user, other };
    });
    const takedownId = await t.mutation(internal.revert.applyTakedown, { artworkId: seeded.corpus.artworkId, requester: 'estate@example.org' });
    const artwork = await get(seeded.corpus.artworkId);
    expect(artwork).toMatchObject({ factSheetNeedsReview: true, enrichGeneration: 4 });
    for (const field of ['factSheet', 'factSheetUpdatedAt', 'docent', 'docentUpdatedAt', 'enrichClaimedAt'] as const) {
      expect(artwork?.[field]).toBeUndefined();
    }
    await finish();
    expect(await get(takedownId)).toMatchObject({ artworkId: seeded.corpus.artworkId, requester: 'estate@example.org', appliedAt: Date.now() });
    expect(await get(seeded.corpus.objectId)).toMatchObject({ reverted: true, revertedReason: `takedown: ${takedownId}` });
    expect(await get(seeded.user.objectId)).toMatchObject({ reverted: true });
    expect(await get(seeded.other.objectId)).toMatchObject({ reverted: false });
    expect(await get(seeded.other.artworkId)).toMatchObject({ factSheet, docent });
    expect((await all('vectors')).map((row) => row.objectId)).toEqual([seeded.other.objectId]);
    expect(await t.mutation(internal.docent.claim, { artworkId: seeded.corpus.artworkId })).toBeNull();
  });

  it('hides a single object immediately and completes its cleanup before marking the takedown applied', async () => {
    const { t, alice, venueId, get, finish } = await fixture();
    const { objectId, artworkId } = await t.run((ctx) => seedUserObject(ctx, { venueId, deviceIds: [alice.deviceId] }));
    const takedownId = await t.mutation(internal.revert.applyTakedown, { objectId, requester: 'estate@example.org' });
    expect(await get(objectId)).toMatchObject({ reverted: true, revertedReason: `takedown: ${takedownId}` });
    expect((await get(takedownId))?.appliedAt).toBeUndefined();
    await finish();
    expect(await get(takedownId)).toMatchObject({ objectId, appliedAt: Date.now() });
    expect((await get(artworkId))?.factSheetNeedsReview).toBeUndefined();
    await expect(t.mutation(internal.revert.applyTakedown, { requester: 'x' })).rejects.toMatchObject({ data: { code: 'takedown_target' } });
    await expect(t.mutation(internal.revert.applyTakedown, { objectId, artworkId, requester: 'x' })).rejects.toMatchObject({ data: { code: 'takedown_target' } });
  });
});

describe('cascade transaction limits', () => {
  it('cleans 25 objects with 60 views each before completing an opt-out', async () => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    for (let batch = 0; batch < 25; batch++) {
      await t.run(async (ctx) => {
        const work = await seedUserObject(ctx, { venueId, deviceIds: [] });
        for (let i = 0; i < 60; i++) {
          const vector = Array<number>(model.embeddingDim).fill(0);
          vector[i] = 1;
          await ctx.db.insert('vectors', { objectId: work.objectId, source: 'user_scan', modelVersion: model.modelVersion, vector });
        }
      });
    }
    const optOutId = await t.mutation(internal.revert.applyOptOut, { venueId, requester: 'museum' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(optOutId))).toMatchObject({ appliedAt: expect.any(Number) });
    expect(await t.run((ctx) => ctx.db.query('vectors').first())).toBeNull();
    expect((await t.run((ctx) => ctx.db.query('objects').collect())).every((row) => row.reverted)).toBe(true);
  });
});

describe('object cleanup resumption', () => {
  it('drains child pages and can restart without changing counters or rejection reasons twice', async () => {
    const t = harness({ transactionLimits: true });
    const device = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const work = await t.run((ctx) => seedUserObject(ctx, { venueId, deviceIds: [device.deviceId] }));
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 50; i++) await ctx.db.insert('vectors', {
          objectId: work.objectId, source: 'user_scan', modelVersion: model.modelVersion, vector: testVector(0.9),
        });
      });
    }
    for (let batch = 0; batch < 2; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 40; i++) await seedContribution(ctx, {
          deviceId: device.deviceId, venueId, promotedObjectId: work.objectId,
          status: i === 0 ? 'rejected' : 'promoted', rejectedReason: i === 0 ? 'device_reverted' : undefined,
        });
      });
    }
    await t.run((ctx) => ctx.db.insert('ingestCounters', { museums: 1, artworks: 1, objects: 1, placements: 1, vectors: 151, descriptors: 0 }));
    await t.mutation(internal.revert.beginObjectRevert, { objectId: work.objectId, reason: 'mislabeled' });
    expect(await t.mutation(internal.revert.cleanupObjectPage, { objectId: work.objectId, phase: 'vectors', cursor: null })).toEqual(expect.any(String));
    await t.action(internal.revert.revertObjectById, { objectId: work.objectId, reason: 'retry' });
    await t.action(internal.revert.revertObjectById, { objectId: work.objectId, reason: 'retry' });
    expect(await t.run((ctx) => ctx.db.query('vectors').first())).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query('contributions').collect());
    expect(rows).toHaveLength(80);
    expect(rows.every((row) => row.status === 'rejected')).toBe(true);
    expect(rows.filter((row) => row.rejectedReason === 'device_reverted')).toHaveLength(2);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({ vectors: 0 });
    expect(await t.run((ctx) => ctx.db.get(work.objectId))).toMatchObject({ revertedReason: 'mislabeled' });
  });
});

it.each(['first', 'second'] as const)('removes views when their %s agreement witness is banned', async (witness) => {
  vi.useFakeTimers();
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  for (const [deviceId, vector] of [[alice.deviceId, testVector(0.9)], [bob.deviceId, testVector(0.8)]] as const) {
    await t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId });
      await ctx.db.insert('feedback', {
        scanId, deviceId, vector, modelVersion: model.modelVersion, venueId,
        rejectedObjectId: wrong.objectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9,
        calibratorVersion: 'lr-v1', venueMismatch: false, penaltyAdded: 0,
        resolution: { kind: 'runner_up', objectId: work.objectId }, createdAt: Date.now(),
      });
    });
  }
  expect((await t.action(internal.promotion.run, {})).multiViewVectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, { deviceId: witness === 'first' ? alice.deviceId : bob.deviceId, reason: 'poisoning' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(internal.promotion.run, {});
  const remaining = await t.run((ctx) => ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source',
    (q) => q.eq('objectId', work.objectId).eq('modelVersion', model.modelVersion).eq('source', 'user_scan')).collect());
  expect(remaining).toHaveLength(0);
});

it('reconsiders duplicate views across witness pages and restores them with clean agreement', async () => {
  const { t, alice, bob, venueId, finish } = await fixture();
  const carol = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  const add = (deviceId: Id<'devices'>, vector: number[]) => t.run(async (ctx) => {
    const scanId = await seedScan(ctx, { deviceId, venueId });
    return ctx.db.insert('feedback', {
      scanId, deviceId, vector, modelVersion: model.modelVersion, venueId,
      rejectedObjectId: wrong.objectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9,
      calibratorVersion: 'lr-v1', venueMismatch: false, penaltyAdded: 0,
      resolution: { kind: 'runner_up', objectId: work.objectId }, createdAt: Date.now(),
    });
  });
  await add(alice.deviceId, testVector(0.9));
  const bobRows: Id<'feedback'>[] = [];
  for (let i = 0; i < 35; i++) bobRows.push(await add(bob.deviceId, testVector(0.8)));
  expect((await t.action(internal.promotion.run, {})).multiViewVectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, { deviceId: alice.deviceId, reason: 'poisoning' });
  await finish();
  for (const id of bobRows) {
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.resolution.kind).toBe('runner_up');
    expect(row?.multiViewAt).toBeUndefined();
    expect(row?.multiViewAgreement).toBeUndefined();
  }
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(0);
  await add(carol.deviceId, testVector(0.7));
  expect((await t.action(internal.promotion.run, {})).multiViewVectors).toBe(2);
  await t.mutation(internal.revert.revertDevice, { deviceId: alice.deviceId, reason: 'retry' });
  await finish();
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
});

it('removes a taken-down object from a previously identified scan card', async () => {
  vi.useFakeTimers();
  const t = harness();
  const user = await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, {
    deviceId: user.deviceId, outcome: 'confident',
    best: { objectId: work.objectId, artworkId: work.artworkId, probability: 0.99 },
  }));
  const requestId = await t.mutation(internal.revert.applyTakedown, { objectId: work.objectId, requester: 'owner' });
  expect((await user.as.query(api.scans.get, { scanId }))?.best).toBeUndefined();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.run((ctx) => ctx.db.get(requestId)))?.appliedAt).toEqual(expect.any(Number));
  expect((await user.as.query(api.scans.get, { scanId }))?.best).toBeUndefined();
  const cached = await user.as.action(api.identify.identify, {
    localId: (await t.run((ctx) => ctx.db.get(scanId)))!.localId, vector: testVector(),
    ...features, modelVersion: model.modelVersion, capturedAt: Date.now(),
  });
  expect(cached.best).toBeUndefined();
});


it('removes vectors learned at an opted-out venue while preserving the corpus vector', async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, { placement: { venueId, onView: true, source: 'feed', confidence: 1 } }));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  for (let i = 0; i < 30; i++) {
    const deviceId = i === 29 ? bob.deviceId : alice.deviceId;
    const vector = testVector(i === 29 ? 0.8 : 0.9);
    await t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId, vector });
      await ctx.db.insert('feedback', {
        scanId, deviceId, vector, modelVersion: model.modelVersion, venueId,
        rejectedObjectId: wrong.objectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9,
        calibratorVersion: 'lr-v1', venueMismatch: false, penaltyAdded: 0,
        resolution: { kind: 'runner_up', objectId: work.objectId }, createdAt: Date.now(),
      });
    });
  }
  expect((await t.action(internal.promotion.run, {})).multiViewVectors).toBe(2);
  const requestId = await t.mutation(internal.revert.applyOptOut, { venueId, requester: 'museum' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const remaining = await t.run((ctx) => ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) => q.eq('objectId', work.objectId)).collect());
  expect(remaining.map((row) => row.source)).toEqual(['corpus']);
  expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({ appliedAt: expect.any(Number) });
  await t.action(internal.promotion.run, {});
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(0);
});

it.each(['ban', 'opt_out', 'duplicate_opt_out'] as const)('preserves independently confirmed views through %s across duplicate pages', async (removal) => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const [alice, bob, carol, dan] = await Promise.all(Array.from({ length: 4 }, () => seedDevice(t)));
  const venueA = await t.run(seedMuseum);
  const venueB = await t.run(seedMuseum);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const wrong = await t.run((ctx) => seedArtworkWithObject(ctx));
  for (const [deviceId, venueId, vector] of [
    [alice.deviceId, venueA, testVector(0.9)], [bob.deviceId, venueA, testVector(0.8)],
    ...Array.from({ length: 35 }, () => [carol.deviceId, venueB, testVector(0.9)] as const),
    [dan.deviceId, venueB, testVector(0.8)],
  ] as const) {
    await t.run(async (ctx) => {
      const scanId = await seedScan(ctx, { deviceId, venueId, vector });
      await ctx.db.insert('feedback', {
        scanId, deviceId, vector, modelVersion: model.modelVersion, venueId,
        rejectedObjectId: wrong.objectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9,
        calibratorVersion: 'lr-v1', venueMismatch: false, penaltyAdded: 0,
        resolution: { kind: 'runner_up', objectId: work.objectId }, createdAt: Date.now(),
      });
    });
  }
  expect((await t.action(internal.promotion.run, {})).multiViewVectors).toBe(2);
  if (removal === 'ban') await t.mutation(internal.revert.revertDevice, { deviceId: alice.deviceId, reason: 'abuse' });
  else await t.mutation(internal.revert.applyOptOut, { venueId: removal === 'opt_out' ? venueA : venueB, requester: 'museum' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.action(internal.promotion.run, {});
  const rows = await t.run((ctx) => ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) =>
    q.eq('objectId', work.objectId).eq('modelVersion', model.modelVersion).eq('source', 'user_scan')).collect());
  expect(rows).toHaveLength(2);
  expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
});

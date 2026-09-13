import { afterEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { encodeOrbFeatures } from '../shared/orb';
import { makeSyntheticPair } from '../shared/orb/test-fixtures';
import { seedArtworkWithObject, seedContribution, seedDevice, seedMuseum, seedScan, testVector } from './lib/testFactories';
import type { EvidenceKind } from './lib/validators';
import { CONFIRMED_TRUST_WEIGHT, RUN_PAGE_SIZE } from './promotion';
import { harness, type Harness } from './test.helpers';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const DAY = 24 * 60 * 60 * 1000;
const pair = makeSyntheticPair({ count: 120 });
const features = encodeOrbFeatures(pair.ref);

function field(value: string, evidence: EvidenceKind) {
  return { value, edited: evidence === 'user_edited', evidence };
}

function strong(kind: 'accession' | 'qr' | 'tavily+image') {
  return {
    evidence: [kind, 'ocr'] as EvidenceKind[],
    fields: { title: field('Water Lilies', kind), artist: field('Claude Monet', kind), date: field('1916', 'ocr'), accession: field('1998.325', kind) },
  };
}

function storeCrop(t: Harness): Promise<Id<'_storage'>> {
  return t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })));
}

async function fixture() {
  const t = harness();
  const alice = await seedDevice(t);
  const bob = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const run = () => t.action(internal.promotion.run, {});
  const get = <T extends 'contributions' | 'objects' | 'devices' | 'artworks' | 'feedback'>(id: Id<T>) =>
    t.run((ctx) => ctx.db.get(id)) as Promise<Doc<T> | null>;
  const all = <T extends 'objects' | 'artworks' | 'vectors' | 'descriptors' | 'placements' | 'contributions'>(table: T) =>
    t.run((ctx) => ctx.db.query(table).collect()) as Promise<Doc<T>[]>;
  const seed = (overrides: Parameters<typeof seedContribution>[1]) => t.run((ctx) => seedContribution(ctx, overrides));
  return { t, alice, bob, venueId, run, get, all, seed };
}

describe('promotion.run with strong evidence', () => {
  it.each(['accession', 'qr', 'tavily+image'] as const)('promotes %s alone into the shared index', async (kind) => {
    const { t, alice, venueId, run, get, all, seed } = await fixture();
    const cropStorageId = await storeCrop(t);
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: alice.deviceId, venueId, gallery: '12' }));
    const contributionId = await seed({
      deviceId: alice.deviceId, venueId, scanId, cropStorageId, wikidataId: 'Q3374376', ...features, keypointCount: pair.ref.count, ...strong(kind),
    });
    expect(await run()).toEqual({ evaluated: 1, promoted: 1, pending: 0, multiViewVectors: 0 });
    const [object] = await all('objects');
    expect(object).toMatchObject({
      key: `user:${contributionId}`, ownerId: venueId, accession: '1998.325', source: 'user', sourceId: contributionId,
      imageRef: `storage:${cropStorageId}`, thumbnailStorageId: cropStorageId,
      provenance: { contributionIds: [contributionId], deviceIds: [alice.deviceId] },
      confirmCount: 0, rejectCount: 0, calibratorPenalty: 0, reverted: false,
    });
    expect(await get(object.artworkId)).toMatchObject({
      key: `user:${contributionId}`, wikidataId: 'Q3374376', title: 'Water Lilies', artist: 'Claude Monet', date: '1916',
      rightsStatus: 'unknown', multiplicity: 'unknown',
    });
    expect(await all('placements')).toMatchObject([{ objectId: object._id, venueId, gallery: '12', onView: true, source: 'contribution', confidence: 0.7 }]);
    expect(await all('vectors')).toMatchObject([{ objectId: object._id, modelVersion: model.modelVersion, source: 'user', vector: testVector() }]);
    expect(await all('descriptors')).toMatchObject([{ objectId: object._id, keypointCount: pair.ref.count, inputSize: model.inputSize, extractedFrom: `contribution:${contributionId}` }]);
    expect(await get(contributionId)).toMatchObject({ status: 'promoted', promotedObjectId: object._id, promotionNote: 'strong' });
    expect((await get(alice.deviceId))?.trustWeight).toBe(CONFIRMED_TRUST_WEIGHT);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({ artworks: 1, objects: 1, placements: 1, vectors: 1, descriptors: 1 });
  });

  it('attaches the object to an existing artwork with the same Wikidata id', async () => {
    const { t, alice, venueId, run, all, seed } = await fixture();
    const existing = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q3374376' } }));
    await seed({ deviceId: alice.deviceId, venueId, wikidataId: 'Q3374376', ...strong('qr') });
    expect(await run()).toMatchObject({ promoted: 1 });
    expect(await all('artworks')).toHaveLength(1);
    const promoted = (await all('objects')).find((object) => object.source === 'user');
    expect(promoted?.artworkId).toBe(existing.artworkId);
  });

  it('holds a strong contribution whose title or artist was edited until a partner agrees', async () => {
    const { alice, bob, venueId, run, get, all, seed } = await fixture();
    const edited = await seed({
      deviceId: alice.deviceId, venueId, evidence: ['accession', 'user_edited'],
      fields: { title: field('Water Lilies', 'user_edited'), artist: field('Claude Monet', 'accession') },
    });
    expect(await run()).toMatchObject({ evaluated: 1, promoted: 0, pending: 1 });
    expect(await all('objects')).toEqual([]);
    await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
    expect(await run()).toMatchObject({ evaluated: 1, promoted: 1 });
    expect((await get(edited))?.status).toBe('promoted');
  });
});

describe('promotion.run with agreement', () => {
  it('leaves single weak contributions pending, writes nothing, and does not re-evaluate them', async () => {
    const { alice, bob, venueId, run, get, all, seed } = await fixture();
    const tavily = await seed({ deviceId: alice.deviceId, venueId, evidence: ['tavily'] });
    const wikidata = await seed({ deviceId: bob.deviceId, venueId, fields: { title: field('Haystacks', 'wikidata'), artist: field('Claude Monet', 'wikidata') } });
    expect(await run()).toEqual({ evaluated: 2, promoted: 0, pending: 2, multiViewVectors: 0 });
    expect((await get(tavily))?.status).toBe('pending');
    expect((await get(wikidata))?.status).toBe('pending');
    for (const table of ['objects', 'artworks', 'vectors', 'descriptors', 'placements'] as const) expect(await all(table)).toEqual([]);
    expect(await run()).toMatchObject({ evaluated: 0 });
  });

  it('promotes weak evidence once an independent device names the same work with a matching embedding', async () => {
    const { t, alice, bob, venueId, run, get, all, seed } = await fixture();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 10, 12));
    const first = await seed({ deviceId: alice.deviceId, venueId, ...features, keypointCount: pair.ref.count });
    expect(await run()).toMatchObject({ pending: 1 });
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 11, 12));
    const second = await seed({
      deviceId: bob.deviceId, venueId, vector: testVector(0.95), keypointCount: 7,
      fields: { title: field('water-lilies!', 'wikidata'), artist: field('Claudé  Monet.', 'wikidata') },
    });
    expect(await run()).toEqual({ evaluated: 1, promoted: 1, pending: 0, multiViewVectors: 0 });
    const [object] = await all('objects');
    expect(object.provenance).toEqual({ contributionIds: [second, first], deviceIds: [bob.deviceId, alice.deviceId] });
    expect(object.key).toBe(`user:${second}`);
    expect((await all('vectors')).map((row) => row.vector)).toEqual([testVector(0.95), testVector()]);
    expect(await all('descriptors')).toMatchObject([{ keypointCount: 7, extractedFrom: `contribution:${second}` }]);
    expect(await get(first)).toMatchObject({ status: 'promoted', promotedObjectId: object._id, promotionNote: `agreement with ${second} on different days` });
    expect(await get(second)).toMatchObject({ status: 'promoted', promotedObjectId: object._id, promotionNote: `agreement with ${first} on different days` });
    expect((await get(alice.deviceId))?.trustWeight).toBe(1);
    expect((await get(bob.deviceId))?.trustWeight).toBe(1);
    expect(await t.query(internal.ingest.counts, {})).toMatchObject({ vectors: 2, objects: 1 });
  });

  it('never lets one device agree with itself', async () => {
    const { alice, venueId, run, all, seed } = await fixture();
    await seed({ deviceId: alice.deviceId, venueId });
    await seed({ deviceId: alice.deviceId, venueId, vector: testVector(0.95) });
    expect(await run()).toMatchObject({ evaluated: 2, promoted: 0, pending: 2 });
    expect(await all('objects')).toEqual([]);
  });

  it('rejects an identical embedding from another device as a replay', async () => {
    const { alice, bob, venueId, run, all, seed } = await fixture();
    await seed({ deviceId: alice.deviceId, venueId });
    await seed({ deviceId: bob.deviceId, venueId });
    expect(await run()).toMatchObject({ evaluated: 2, promoted: 0, pending: 2 });
    expect(await all('objects')).toEqual([]);
  });

  it('promotes a whole agreeing set at once and evaluates at most one page per run', async () => {
    const { t, alice, bob, venueId, run, all, seed } = await fixture();
    const carol = await seedDevice(t);
    await seed({ deviceId: alice.deviceId, venueId });
    await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
    await seed({ deviceId: carol.deviceId, venueId, vector: testVector(0.97) });
    for (let i = 0; i < RUN_PAGE_SIZE; i++) {
      await seed({ deviceId: alice.deviceId, venueId, vector: testVector(0.5), fields: { title: field(`Study ${i}`, 'ocr'), artist: field('Unknown', 'ocr') }, evidence: ['ocr'] });
    }
    const started = performance.now();
    expect(await run()).toMatchObject({ evaluated: RUN_PAGE_SIZE, promoted: 1 });
    process.stderr.write(`promotion.run over ${RUN_PAGE_SIZE} contributions took ${Math.round(performance.now() - started)} ms in convex-test\n`);
    const [object] = await all('objects');
    expect(object.provenance?.contributionIds).toHaveLength(3);
    expect(await all('vectors')).toHaveLength(3);
    expect((await all('contributions')).filter((row) => row.status === 'promoted')).toHaveLength(3);
    expect(await run()).toMatchObject({ evaluated: 3, promoted: 0, pending: 3 });
    expect((await all('contributions')).filter((row) => row.status === 'private')).toEqual([]);
  });

  it('refuses to apply when a partner changed between evaluation and the write', async () => {
    const { t, alice, bob, venueId, get, all, seed } = await fixture();
    const first = await seed({ deviceId: alice.deviceId, venueId });
    const second = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), status: 'rejected', rejectedReason: 'duplicate' });
    expect(await t.mutation(internal.promotion.apply, { contributionId: first, partners: [second] })).toBeNull();
    expect(await all('objects')).toEqual([]);
    expect((await get(first))?.status).toBe('private');
    await t.run((ctx) => ctx.db.patch(second, { status: 'pending', rejectedReason: undefined }));
    expect(await t.mutation(internal.promotion.apply, { contributionId: first, partners: [second] })).toEqual(expect.any(String));
    expect(await all('objects')).toHaveLength(1);
  });
});

describe('promoted works on the card', () => {
  it('are found by identify and show the contributor crop as the thumbnail', async () => {
    const { t, alice, venueId, run, all, seed } = await fixture();
    const cropStorageId = await storeCrop(t);
    await seed({ deviceId: alice.deviceId, venueId, cropStorageId, ...features, keypointCount: pair.ref.count, ...strong('accession') });
    await run();
    const [object] = await all('objects');
    const result = await alice.as.action(api.identify.identify, {
      localId: 'capture', venueId, vector: testVector(), ...encodeOrbFeatures(pair.query), modelVersion: model.modelVersion, capturedAt: Date.now(),
    });
    expect(result).toMatchObject({ outcome: 'confident', best: {
      objectId: object._id, title: 'Water Lilies', artist: 'Claude Monet', institution: 'Test Museum', rightsStatus: 'unknown',
      thumbnailUrl: expect.stringMatching(/\/api\/storage\//),
    } });
    expect(result.best?.corners).toHaveLength(4);
    expect(await alice.as.query(api.scans.get, { scanId: result.scanId })).toEqual(result);
  });
});

async function seedFeedback(ctx: MutationCtx, row: {
  deviceId: Id<'devices'>; venueId?: Id<'museums'>; objectId: Id<'objects'>; rejectedObjectId: Id<'objects'>;
  vector?: number[]; createdAt?: number;
}): Promise<Id<'feedback'>> {
  const scanId = await seedScan(ctx, { deviceId: row.deviceId, venueId: row.venueId });
  return ctx.db.insert('feedback', {
    scanId, deviceId: row.deviceId, vector: row.vector ?? testVector(0.9), modelVersion: model.modelVersion, venueId: row.venueId,
    rejectedObjectId: row.rejectedObjectId, score: 0.8, margin: 0.1, orbInliers: 20, probability: 0.9, calibratorVersion: 'lr-v1',
    venueMismatch: false, penaltyAdded: 0, resolution: { kind: 'runner_up', objectId: row.objectId }, createdAt: row.createdAt ?? Date.now(),
  });
}

describe('multi-view vectors from resolved rejections', () => {
  async function multiViewFixture() {
    const base = await fixture();
    const { t, venueId } = base;
    const { work, wrong } = await t.run(async (ctx) => ({
      work: await seedArtworkWithObject(ctx, { placement: { venueId, onView: true, source: 'feed', confidence: 1 } }),
      wrong: await seedArtworkWithObject(ctx, { artwork: { title: 'Haystacks' } }),
    }));
    const feedback = (row: Omit<Parameters<typeof seedFeedback>[1], 'objectId' | 'rejectedObjectId'> & { objectId?: Id<'objects'> }) =>
      t.run((ctx) => seedFeedback(ctx, { objectId: work.objectId, rejectedObjectId: wrong.objectId, ...row }));
    const userScanVectors = async () => (await base.all('vectors')).filter((row) => row.source === 'user_scan');
    return { ...base, work, feedback, userScanVectors };
  }

  it('adds one user_scan vector per resolution once two devices resolved to the work at the venue', async () => {
    const { t, alice, bob, venueId, run, get, feedback, userScanVectors, work } = await multiViewFixture();
    const first = await feedback({ deviceId: alice.deviceId, venueId, vector: testVector(0.9) });
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect((await get(first))?.multiViewAt).toBeUndefined();
    const second = await feedback({ deviceId: bob.deviceId, venueId, vector: testVector(0.8) });
    expect(await run()).toMatchObject({ multiViewVectors: 2 });
    const vectors = await userScanVectors();
    expect(vectors).toMatchObject([
      { objectId: work.objectId, modelVersion: model.modelVersion, vector: testVector(0.9) },
      { objectId: work.objectId, modelVersion: model.modelVersion, vector: testVector(0.8) },
    ]);
    expect(await get(first)).toMatchObject({ multiViewAt: expect.any(Number), multiViewVectorId: vectors[0]._id });
    expect(await get(second)).toMatchObject({ multiViewAt: expect.any(Number), multiViewVectorId: vectors[1]._id });
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toHaveLength(2);
    expect((await t.query(internal.ingest.counts, {})).vectors).toBe(2);
  });

  it('adds nothing for a single device and keeps its resolution waiting for a partner', async () => {
    const { alice, venueId, run, get, feedback, userScanVectors } = await multiViewFixture();
    const rows = [
      await feedback({ deviceId: alice.deviceId, venueId, vector: testVector(0.9) }),
      await feedback({ deviceId: alice.deviceId, venueId, vector: testVector(0.8) }),
    ];
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) expect((await get(id))?.multiViewAt).toBeUndefined();
  });

  it('suppresses near-duplicate views and settles rows that can never qualify', async () => {
    const { t, alice, bob, venueId, run, get, feedback, userScanVectors } = await multiViewFixture();
    const elsewhere = await t.run((ctx) => seedMuseum(ctx));
    const first = await feedback({ deviceId: alice.deviceId, venueId, vector: testVector(0.9) });
    const duplicate = await feedback({ deviceId: bob.deviceId, venueId, vector: testVector(0.9) });
    const lonely = await feedback({ deviceId: alice.deviceId, venueId: elsewhere });
    const expired = await feedback({ deviceId: bob.deviceId, venueId, createdAt: Date.now() - 100 * DAY });
    const noVenue = await feedback({ deviceId: bob.deviceId });
    expect(await run()).toMatchObject({ multiViewVectors: 1 });
    expect(await userScanVectors()).toHaveLength(1);
    expect(await get(first)).toMatchObject({ multiViewAt: expect.any(Number), multiViewVectorId: expect.any(String) });
    expect(await get(duplicate)).toMatchObject({ multiViewAt: expect.any(Number) });
    expect((await get(duplicate))?.multiViewVectorId).toBeUndefined();
    expect((await get(lonely))?.multiViewAt).toBeUndefined();
    expect((await get(expired))?.multiViewAt).toEqual(expect.any(Number));
    expect((await get(noVenue))?.multiViewAt).toEqual(expect.any(Number));
  });

  it('settles resolutions to a reverted work without adding vectors', async () => {
    const { t, alice, bob, venueId, run, get, feedback, userScanVectors, work } = await multiViewFixture();
    await t.run((ctx) => ctx.db.patch(work.objectId, { reverted: true }));
    const rows = [await feedback({ deviceId: alice.deviceId, venueId }), await feedback({ deviceId: bob.deviceId, venueId, vector: testVector(0.8) })];
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await userScanVectors()).toEqual([]);
    for (const id of rows) expect((await get(id))?.multiViewAt).toEqual(expect.any(Number));
  });
});

describe('promotion regression guards', () => {
  it.each(['accession', 'page', 'names'] as const)('honors a takedown when a new contribution identifies the work by %s', async (identity) => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, run, get, all } = await fixture();
    const verified = strong('qr');
    const contribution = {
      ...verified,
      fields: { ...verified.fields, accession: identity === 'accession' ? verified.fields.accession : undefined },
      ...(identity === 'page' ? { sourceUrl: 'https://museum.example/works/water-lilies' } : {}),
    };
    await seed({ deviceId: alice.deviceId, venueId, ...contribution });
    await run();
    const [original] = await all('objects');
    const requestId = await t.mutation(internal.revert.applyTakedown, { artworkId: original.artworkId, requester: 'owner' });
    // The hold must apply before the asynchronous cleanup as well as after it.
    const during = await seed({ deviceId: bob.deviceId, venueId, ...contribution });
    await run();
    expect((await get(during))?.status).not.toBe('promoted');
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = await seed({ deviceId: bob.deviceId, venueId, ...contribution, fields: {
      ...contribution.fields, title: field('  WATER-LILIES! ', 'qr'), artist: field('Claudé Monet', 'qr'),
    } });
    await run();
    expect((await get(later))?.status).not.toBe('promoted');
    expect(await all('artworks')).toHaveLength(1);
    expect((await all('objects')).filter((object) => !object.reverted)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({ appliedAt: expect.any(Number) });

    const elsewhere = await t.run(seedMuseum);
    await seed({ deviceId: bob.deviceId, venueId: elsewhere, ...contribution });
    expect(await run()).toMatchObject({ promoted: 1 });
    if (identity === 'accession') {
      await seed({ deviceId: bob.deviceId, venueId, ...contribution,
        fields: { ...contribution.fields, accession: field('1998.326', 'qr') } });
      expect(await run()).toMatchObject({ promoted: 1 });
    }
  });

  it('retains museum identity when promotion attaches to an existing Wikidata artwork', async () => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, run, get } = await fixture();
    const work = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q1' } }));
    const first = await seed({ deviceId: alice.deviceId, venueId, wikidataId: 'Q1', ...strong('qr') });
    await run();
    expect((await get((await get(first))!.promotedObjectId!))?.artworkId).toBe(work.artworkId);
    await t.mutation(internal.revert.applyTakedown, { artworkId: work.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = await seed({ deviceId: bob.deviceId, venueId, ...strong('qr') });
    await run();
    expect((await get(later))?.status).not.toBe('promoted');
  });

  it('recognizes a museum page when a later submission omits its accession', async () => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, run, get } = await fixture();
    const first = await seed({ deviceId: alice.deviceId, venueId, ...strong('qr'),
      sourceUrl: 'https://museum.example/work?id=123&lang=en#details' });
    await run();
    const object = await get((await get(first))!.promotedObjectId!);
    await t.mutation(internal.revert.applyTakedown, { artworkId: object!.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = await seed({ deviceId: bob.deviceId, venueId, ...strong('qr'),
      fields: { title: field('Water Lilies', 'qr'), artist: field('Claude Monet', 'qr') },
      sourceUrl: 'https://museum.example/work?lang=en&id=123' });
    await run();
    expect((await get(later))?.status).not.toBe('promoted');
  });

  it('settles large contributions within transaction limits and continues to multi-view promotion', async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run(seedMuseum);
    const contributionIds: Id<'contributions'>[] = [];
    for (let i = 0; i < 40; i++) {
      contributionIds.push(await t.run((ctx) => seedContribution(ctx, {
        deviceId: alice.deviceId, venueId,
        vector: Array.from({ length: model.embeddingDim }, (_, axis) => Number(axis === i)),
        fields: {
          title: field(`Study ${i}`, 'ocr'), artist: field('Artist', 'ocr'),
          creditLine: field('x'.repeat(450_000), 'user_edited'),
        },
      })));
    }
    const [work, wrong] = await t.run(async (ctx) => Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]));
    for (const [deviceId, vector] of [[alice.deviceId, testVector(0.9)], [bob.deviceId, testVector(0.8)]] as const) {
      await t.run((ctx) => seedFeedback(ctx, { deviceId, vector, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId }));
    }
    expect(await t.action(internal.promotion.run, {})).toMatchObject({ evaluated: 40, pending: 40, multiViewVectors: 2 });
    for (const id of contributionIds) expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe('pending');
    expect(await t.action(internal.promotion.run, {})).toMatchObject({ evaluated: 0 });
  });

  it('keeps queued contributions private after a completed venue opt-out', async () => {
    vi.useFakeTimers();
    const { t, alice, venueId, seed, run, get, all } = await fixture();
    const id = await seed({ deviceId: alice.deviceId, venueId, ...strong('qr') });
    await t.mutation(internal.revert.applyOptOut, { venueId, requester: 'museum' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await run();
    expect((await get(id))?.status).not.toBe('promoted');
    expect(await all('objects')).toEqual([]);
  });

  it('does not republish an artwork after its takedown completes', async () => {
    vi.useFakeTimers();
    const { t, alice, venueId, seed, run, all } = await fixture();
    const work = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q1' } }));
    await seed({ deviceId: alice.deviceId, venueId, wikidataId: 'Q1', ...strong('qr') });
    await t.mutation(internal.revert.applyTakedown, { artworkId: work.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await run();
    expect((await all('objects')).filter((row) => row.artworkId === work.artworkId && !row.reverted)).toEqual([]);
  });

  it('settles an older pending contribution when a strong agreeing partner arrives', async () => {
    const { alice, bob, venueId, seed, run, get, all } = await fixture();
    const weak = await seed({ deviceId: alice.deviceId, venueId });
    await run();
    const verified = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...strong('qr') });
    await run();
    expect(await get(weak)).toMatchObject({ status: 'promoted', promotedObjectId: (await get(verified))?.promotedObjectId });
    expect(await all('vectors')).toHaveLength(2);
  });

  it('excludes a banned partner whose contribution is still waiting for the ban cascade', async () => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, get } = await fixture();
    const carol = await seedDevice(t);
    for (let i = 0; i < 25; i++) await seed({ deviceId: carol.deviceId, venueId });
    const first = await seed({ deviceId: alice.deviceId, venueId });
    const second = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
    const banned = await seed({ deviceId: carol.deviceId, venueId, vector: testVector(0.97) });
    await t.mutation(internal.revert.revertDevice, { deviceId: carol.deviceId, reason: 'abuse' });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: first, partners: [second, banned] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await get(objectId!)).toMatchObject({ reverted: false, provenance: { contributionIds: [first, second], deviceIds: [alice.deviceId, bob.deviceId] } });
  });

  it('advances past a full page of waiting feedback and revisits it when a partner arrives', async () => {
    const { t, alice, bob, venueId, run, all } = await fixture();
    const [waiting, ready, wrong] = await t.run(async (ctx) => Promise.all([
      seedArtworkWithObject(ctx), seedArtworkWithObject(ctx), seedArtworkWithObject(ctx),
    ]));
    const add = (objectId: Id<'objects'>, deviceId: Id<'devices'>, vector = testVector(0.9)) => t.run((ctx) => seedFeedback(ctx, {
      objectId, deviceId, venueId, rejectedObjectId: wrong.objectId, vector,
    }));
    for (let i = 0; i < 100; i++) await add(waiting.objectId, alice.deviceId);
    await add(ready.objectId, alice.deviceId);
    await add(ready.objectId, bob.deviceId, testVector(0.8));
    expect(await run()).toMatchObject({ multiViewVectors: 0 });
    expect(await run()).toMatchObject({ multiViewVectors: 2 });
    await add(waiting.objectId, bob.deviceId, testVector(0.8));
    await run();
    await run();
    expect((await all('vectors')).filter((row) => row.objectId === waiting.objectId && row.source === 'user_scan')).toHaveLength(2);
  });

  it('handles a popular work with 1500 prior resolutions within transaction limits', async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const [work, wrong] = await t.run(async (ctx) => Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]));
    const first = await t.run((ctx) => seedFeedback(ctx, { deviceId: alice.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId }));
    for (let batch = 0; batch < 15; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 100; i++) {
          const id = await seedFeedback(ctx, { deviceId: bob.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId });
          await ctx.db.patch(id, { multiViewAt: Date.now() });
        }
      });
    }
    expect(await t.action(internal.promotion.run, {})).toMatchObject({ multiViewVectors: 1 });
    expect(await t.run((ctx) => ctx.db.get(first))).toMatchObject({ multiViewVectorId: expect.any(String) });
  });
});

describe('multi-view paginated validation', () => {
  it('finds a duplicate beyond the first vector page and adds a distinct later view', async () => {
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const [work, wrong] = await t.run(async (ctx) => Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]));
    const axis = (i: number) => Array.from({ length: model.embeddingDim }, (_, j) => Number(j === i));
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = batch * 50; i < (batch + 1) * 50; i++) {
          await ctx.db.insert('vectors', { objectId: work.objectId, source: 'user_scan', modelVersion: model.modelVersion, vector: axis(i) });
        }
      });
    }
    const duplicate = await t.run((ctx) => seedFeedback(ctx, { deviceId: alice.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId, vector: axis(149) }));
    const unique = await t.run((ctx) => seedFeedback(ctx, { deviceId: bob.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId, vector: axis(150) }));
    expect(await t.action(internal.promotion.run, {})).toMatchObject({ multiViewVectors: 1 });
    expect(await t.run((ctx) => ctx.db.get(duplicate))).toMatchObject({ multiViewAt: expect.any(Number) });
    expect((await t.run((ctx) => ctx.db.get(duplicate)))?.multiViewVectorId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(unique))).toMatchObject({ multiViewVectorId: expect.any(String) });
  });

  it('rechecks witnesses if a device is banned after agreement was loaded', async () => {
    const { t, alice, bob, venueId, all } = await fixture();
    const [work, wrong] = await t.run(async (ctx) => Promise.all([seedArtworkWithObject(ctx), seedArtworkWithObject(ctx)]));
    const first = await t.run((ctx) => seedFeedback(ctx, { deviceId: alice.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId }));
    const second = await t.run((ctx) => seedFeedback(ctx, { deviceId: bob.deviceId, venueId, objectId: work.objectId, rejectedObjectId: wrong.objectId, vector: testVector(0.8) }));
    await t.run((ctx) => ctx.db.patch(bob.deviceId, { banned: true }));
    expect(await t.mutation(internal.promotion.applyMultiView, { feedbackId: first, agreementIds: [first, second], cursor: null })).toEqual({ inserted: false, cursor: null });
    expect((await all('vectors')).filter((row) => row.source === 'user_scan')).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(first)))?.multiViewAt).toBeUndefined();
  });
});

it('promotes every member of a large agreeing set into one object within transaction limits', { timeout: 20_000 }, async () => {
  vi.useFakeTimers();
  const t = harness({ transactionLimits: true });
  const alice = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId }));
  for (let batch = 0; batch < 12; batch++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        const deviceId = await ctx.db.insert('devices', {
          firstSeenAt: Date.now(), trustWeight: 0.5, banned: false, platform: 'ios', attestCounter: 0,
        });
        await seedContribution(ctx, {
          deviceId, venueId,
          vector: Array.from({ length: model.embeddingDim }, (_, axis) => axis === 0 ? 0.95 : axis === batch * 50 + i + 1 ? Math.sqrt(1 - 0.95 ** 2) : 0),
          descriptors: new ArrayBuffer(16_000),
          keypoints: new ArrayBuffer(8_000), keypointCount: 500,
        });
      }
    });
  }
  expect((await t.action(internal.promotion.run, {})).promoted).toBe(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
  const objects = await t.run((ctx) => ctx.db.query('objects').collect());
  expect(objects).toHaveLength(1);
  expect(objects[0].provenance?.contributionIds).toHaveLength(601);
  expect(objects[0].provenance?.deviceIds).toHaveLength(601);
  expect(await t.query(internal.ingest.counts, {})).toMatchObject({ objects: 1, vectors: 601 });
  expect((await t.action(internal.promotion.run, {})).evaluated).toBe(0);
});

it('evaluates one new contribution at a venue with a large unrelated pending history', { timeout: 20_000 }, async () => {
  const t = harness({ transactionLimits: true });
  const venueId = await t.run(seedMuseum);
  for (let batch = 0; batch < 82; batch++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        const deviceId = await ctx.db.insert('devices', {
          firstSeenAt: Date.now(), trustWeight: 0.5, banned: false, platform: 'ios', attestCounter: 0,
        });
        await seedContribution(ctx, {
          deviceId, venueId, status: 'pending', fields: {
            title: { value: `Study ${batch * 50 + i}`, edited: false, evidence: 'ocr' },
            artist: { value: 'Artist', edited: false, evidence: 'ocr' },
          },
        });
      }
    });
  }
  const alice = await seedDevice(t);
  await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId }));
  expect((await t.action(internal.promotion.run, {})).evaluated).toBe(1);
});

it('revalidates late partners and appends each accepted contribution only once', async () => {
  const { t, alice, bob, venueId, seed, get, all } = await fixture();
  const anchor = await seed({ deviceId: alice.deviceId, venueId, ...strong('qr') });
  const objectId = await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [] });
  const partner = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
  const bannedDevice = await seedDevice(t);
  const banned = await seed({ deviceId: bannedDevice.deviceId, venueId, vector: testVector(0.95) });
  await t.run((ctx) => ctx.db.patch(bannedDevice.deviceId, { banned: true }));
  const differentWork = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95),
    fields: { title: field('Different work', 'ocr'), artist: field('Claude Monet', 'ocr') } });
  for (let i = 0; i < 2; i++) await t.mutation(internal.promotion.appendPartners, {
    contributionId: anchor, partners: [partner, banned, differentWork],
  });
  expect(await get(partner)).toMatchObject({ status: 'promoted', promotedObjectId: objectId });
  expect((await get(banned))?.status).toBe('private');
  expect((await get(differentWork))?.status).toBe('private');
  expect(await all('vectors')).toHaveLength(2);
  const late = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
  await t.mutation(internal.revert.beginObjectRevert, { objectId: objectId!, reason: 'mislabeled' });
  await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [late] });
  expect((await get(late))?.status).toBe('private');
  expect(await all('vectors')).toHaveLength(2);
});


describe('promotion identity regressions', () => {
  const pageVerified = {
    sourceUrl: 'https://museum.example/works/water-lilies', evidence: ['qr' as const],
    fields: { title: field('Water Lilies', 'qr'), artist: field('Claude Monet', 'qr') },
  };

  const museumSearchVerified = (accession: string) => ({
    sourceUrl: `https://museum.example/works/${accession}`, evidence: ['tavily+image', 'tavily'] as EvidenceKind[],
    fields: {
      title: field('Water Lilies', 'tavily+image'), artist: field('Claude Monet', 'tavily+image'),
      accession: field(accession, 'tavily'),
    },
  });

  it.each(['123', '456'])('compares museum-search accession %s with accession 123 before combining works', async (accession) => {
    const { alice, bob, venueId, seed, run, all } = await fixture();
    await seed({ deviceId: alice.deviceId, venueId, ...museumSearchVerified('123') });
    await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...museumSearchVerified(accession) });
    await run();
    const objects = await all('objects');
    const expectedWorks = accession === '123' ? 1 : 2;
    expect(objects).toHaveLength(expectedWorks);
    expect(new Set(objects.map((object) => object.artworkId)).size).toBe(expectedWorks);
    expect(objects.map((object) => object.provenance?.verifiedAccession).sort()).toEqual(
      accession === '123' ? ['123'] : ['123', '456'],
    );
  });

  it('rechecks museum-search accessions when appending contributions to a published work', async () => {
    const { t, alice, bob, venueId, seed, get, all } = await fixture();
    const anchor = await seed({ deviceId: alice.deviceId, venueId, ...museumSearchVerified('123') });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [] });
    const different = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...museumSearchVerified('456') });
    const same = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...museumSearchVerified('123') });
    await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [different, same] });
    expect((await get(different))?.status).toBe('private');
    expect(await get(same)).toMatchObject({ status: 'promoted', promotedObjectId: objectId });
    expect(await all('vectors')).toHaveLength(2);
  });

  it.each(['ocr', 'user_edited', 'tavily'] as const)('does not let a %s accession override the agreed artwork identity', async (evidence) => {
    const { t, alice, bob, venueId, seed, get } = await fixture();
    const original = await t.run((ctx) => seedArtworkWithObject(ctx, {
      vector: testVector(0), object: { ownerId: venueId, accession: '123' },
    }));
    const fields = { title: field('Haystacks', 'ocr'), artist: field('Claude Monet', 'ocr') };
    const first = await seed({ deviceId: alice.deviceId, venueId, fields, evidence: ['ocr'] });
    const second = await seed({
      deviceId: bob.deviceId, venueId, vector: testVector(0.95), evidence: ['ocr', evidence],
      fields: { ...fields, accession: field('123', evidence) },
    });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: first, partners: [second] });
    expect(objectId).not.toBeNull();
    const object = await get(objectId!);
    expect(object?.artworkId).not.toBe(original.artworkId);
    expect(await get(object!.artworkId)).toMatchObject({ title: 'Haystacks', artist: 'Claude Monet' });
    expect(await get(original.artworkId)).toMatchObject({ title: 'Water Lilies', artist: 'Claude Monet' });
  });

  it.each(['accession', 'page'] as const)('honors a corpus takedown identified by %s before and after cleanup', async (identity) => {
    vi.useFakeTimers();
    const { t, alice, venueId, seed, get } = await fixture();
    const known = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q12345' } }));
    const museum = await t.run((ctx) => ctx.db.get(venueId));
    const artwork = await t.run((ctx) => ctx.db.get(known.artworkId));
    const object = await t.run((ctx) => ctx.db.get(known.objectId));
    await t.mutation(internal.ingest.upsertObjects, { rows: [{
      key: object!.key, artworkKey: artwork!.key, ownerKey: museum!.key, source: 'corpus', sourceId: '123',
      accession: 'Ａ  123', pageUrl: 'https://museum.example/work?id=123&lang=en#details',
    }] });
    await t.mutation(internal.revert.applyTakedown, { artworkId: known.artworkId, requester: 'owner' });
    for (const cleanup of [false, true]) {
      if (cleanup) await t.finishAllScheduledFunctions(vi.runAllTimers);
      const contributionId = await seed({
        deviceId: alice.deviceId, venueId, evidence: ['qr'],
        fields: { ...pageVerified.fields, ...(identity === 'accession' ? { accession: field('a 123', 'qr') } : {}) },
        sourceUrl: identity === 'page' ? 'https://museum.example/work?lang=en&id=123' : undefined,
      });
      expect(await t.mutation(internal.promotion.apply, { contributionId, partners: [] })).toBeNull();
      expect((await get(contributionId))?.status).toBe('private');
    }
  });

  it('promotes distinct verified accessions separately even when names and vectors agree', async () => {
    const { alice, bob, venueId, seed, run, all } = await fixture();
    for (const [deviceId, accession, vector] of [
      [alice.deviceId, '123', testVector()], [bob.deviceId, '456', testVector(0.95)],
    ] as const) {
      await seed({ deviceId, venueId, vector, evidence: ['qr'],
        fields: { ...pageVerified.fields, accession: field(accession, 'qr') } });
    }
    expect((await run()).promoted).toBe(2);
    expect(await all('objects')).toHaveLength(2);
    expect(await all('artworks')).toHaveLength(2);
  });

  it('does not publish duplicate partner vectors or increase the replaying device trust', async () => {
    const { t, alice, bob, venueId, seed, run, all, get } = await fixture();
    const carol = await seedDevice(t);
    await seed({ deviceId: alice.deviceId, venueId });
    await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
    const replay = await seed({ deviceId: carol.deviceId, venueId, vector: testVector(0.95) });
    await run();
    expect(await all('vectors')).toHaveLength(2);
    expect((await get(replay))?.status).not.toBe('promoted');
    expect((await get(carol.deviceId))?.trustWeight).toBe(0.5);
  });

  it('rechecks replay vectors and verified accessions across appended batches', async () => {
    const { t, alice, bob, venueId, seed, get, all } = await fixture();
    const carol = await seedDevice(t);
    const anchor = await seed({ deviceId: alice.deviceId, venueId });
    const partner = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95),
      evidence: ['qr'], fields: { ...pageVerified.fields, accession: field('123', 'qr') } });
    await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [partner] });
    const replay = await seed({ deviceId: carol.deviceId, venueId, vector: testVector(0.95) });
    const different = await seed({ deviceId: carol.deviceId, venueId, vector: testVector(0.8),
      evidence: ['qr'], fields: { ...pageVerified.fields, accession: field('456', 'qr') } });
    await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [replay, different] });
    expect((await get(replay))?.status).not.toBe('promoted');
    expect((await get(different))?.status).not.toBe('promoted');
    expect((await get(carol.deviceId))?.trustWeight).toBe(0.5);
    expect(await all('vectors')).toHaveLength(2);
  });

  it('finds replayed partners beyond the first vector page and still appends a distinct view', async () => {
    vi.useFakeTimers();
    const t = harness({ transactionLimits: true });
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const carol = await seedDevice(t);
    const venueId = await t.run(seedMuseum);
    const view = (axis: number) => Array.from({ length: model.embeddingDim }, (_, i) =>
      i === 0 ? 0.95 : i === axis ? Math.sqrt(1 - 0.95 ** 2) : 0);
    const anchor = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId, ...pageVerified }));
    const objectId = (await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [] }))!;
    for (let batch = 0; batch < 2; batch++) await t.run(async (ctx) => {
      for (let i = 1; i <= 40; i++) await ctx.db.insert('vectors', {
        objectId, modelVersion: model.modelVersion, source: 'user', vector: view(batch * 40 + i),
      });
    });
    const replay = await t.run((ctx) => seedContribution(ctx, { deviceId: bob.deviceId, venueId, vector: view(75) }));
    const distinct = await t.run((ctx) => seedContribution(ctx, { deviceId: carol.deviceId, venueId, vector: view(81) }));
    await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [replay, distinct] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(replay)))?.status).not.toBe('promoted');
    expect((await t.run((ctx) => ctx.db.get(bob.deviceId)))?.trustWeight).toBe(0.5);
    expect((await t.run((ctx) => ctx.db.get(distinct)))?.status).toBe('promoted');
    expect(await t.run((ctx) => ctx.db.query('vectors').collect())).toHaveLength(82);
  });

  it('blocks a taken-down identity when it belongs to an agreeing partner', async () => {
    vi.useFakeTimers();
    const t = harness();
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run(seedMuseum);
    const original = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId, ...pageVerified }));
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: original, partners: [] });
    const object = await t.run((ctx) => ctx.db.get(objectId!));
    await t.mutation(internal.revert.applyTakedown, { artworkId: object!.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const weak = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId }));
    await t.run((ctx) => seedContribution(ctx, { deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...pageVerified }));
    await t.action(internal.promotion.run, {});
    expect((await t.run((ctx) => ctx.db.get(weak)))?.status).not.toBe('promoted');
  });

  it('passes the verified museum source to the existing enrichment loader', async () => {
    const t = harness();
    const alice = await seedDevice(t);
    const venueId = await t.run((ctx) => seedMuseum(ctx, { website: 'https://museum.example' }));
    const contributionId = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId, ...pageVerified }));
    const objectId = await t.mutation(internal.promotion.apply, { contributionId, partners: [] });
    const object = await t.run((ctx) => ctx.db.get(objectId!));
    const enrichment = await t.query(internal.docent.load, { artworkId: object!.artworkId });
    expect(enrichment?.pageUrl).toBe(pageVerified.sourceUrl);
    expect(enrichment?.owner?._id).toBe(venueId);
  });

  it('retains a partner museum identity and source through a later takedown', async () => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, get } = await fixture();
    const weak = await seed({ deviceId: alice.deviceId, venueId });
    const partner = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...pageVerified });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: weak, partners: [partner] });
    const object = await get(objectId!);
    expect(object?.pageUrl).toBe(pageVerified.sourceUrl);
    await t.mutation(internal.revert.applyTakedown, { artworkId: object!.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = await seed({ deviceId: bob.deviceId, venueId, ...pageVerified });
    expect(await t.mutation(internal.promotion.apply, { contributionId: later, partners: [] })).toBeNull();
    expect((await get(later))?.status).toBe('private');
  });

  it('checks a late partner takedown and continues to a clean later batch', async () => {
    vi.useFakeTimers();
    const { t, alice, bob, venueId, seed, get, all } = await fixture();
    const removed = await seed({ deviceId: alice.deviceId, venueId, ...pageVerified });
    const removedId = await t.mutation(internal.promotion.apply, { contributionId: removed, partners: [] });
    const removedObject = await get(removedId!);
    await t.mutation(internal.revert.applyTakedown, { artworkId: removedObject!.artworkId, requester: 'owner' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const anchor = await seed({ deviceId: alice.deviceId, venueId, ...strong('qr') });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [] });
    const blocked = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...pageVerified });
    const partners = [blocked];
    for (let i = 0; i < 7; i++) partners.push(await seed({
      deviceId: bob.deviceId, venueId, vector: testVector(0.95),
      fields: { title: field('Different work', 'ocr'), artist: field('Claude Monet', 'ocr') },
    }));
    const clean = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95) });
    await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [...partners, clean] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await get(blocked))?.status).toBe('private');
    expect(await get(clean)).toMatchObject({ status: 'promoted', promotedObjectId: objectId });
    expect((await all('vectors')).filter((row) => row.objectId === objectId)).toHaveLength(2);
  });

  it('keeps an appended partner museum source available to enrichment', async () => {
    const { t, alice, bob, venueId, seed, get } = await fixture();
    const anchor = await seed({ deviceId: alice.deviceId, venueId, ...strong('qr') });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: anchor, partners: [] });
    const partner = await seed({ deviceId: bob.deviceId, venueId, vector: testVector(0.95), ...pageVerified });
    await t.mutation(internal.promotion.appendPartners, { contributionId: anchor, partners: [partner] });
    const object = await get(objectId!);
    expect(await t.query(internal.docent.load, { artworkId: object!.artworkId })).toMatchObject({
      pageUrl: pageVerified.sourceUrl, owner: { _id: venueId },
    });
  });

  it('prefers a verified Wikidata artwork over an older names-only binding', async () => {
    const t = harness();
    const alice = await seedDevice(t);
    const bob = await seedDevice(t);
    const venueId = await t.run(seedMuseum);
    const first = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId }));
    const firstPartner = await t.run((ctx) => seedContribution(ctx, { deviceId: bob.deviceId, venueId, vector: testVector(0.95) }));
    const oldObject = await t.mutation(internal.promotion.apply, { contributionId: first, partners: [firstPartner] });
    const known = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q12345' } }));
    const second = await t.run((ctx) => seedContribution(ctx, { deviceId: alice.deviceId, venueId, wikidataId: 'Q12345', vector: testVector(0.8) }));
    const secondPartner = await t.run((ctx) => seedContribution(ctx, { deviceId: bob.deviceId, venueId, wikidataId: 'Q12345', vector: testVector(0.5) }));
    const newObject = await t.mutation(internal.promotion.apply, { contributionId: second, partners: [secondPartner] });
    expect(newObject).not.toBeNull();
    expect(newObject).not.toBe(oldObject);
    expect((await t.run((ctx) => ctx.db.get(newObject!)))?.artworkId).toBe(known.artworkId);
  });

  it('uses a partner Wikidata match when only the partner knows the identifier', async () => {
    const { t, alice, bob, venueId, seed, get } = await fixture();
    const known = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { wikidataId: 'Q12345' } }));
    const weak = await seed({ deviceId: alice.deviceId, venueId });
    const partner = await seed({ deviceId: bob.deviceId, venueId, wikidataId: 'Q12345', vector: testVector(0.95) });
    const objectId = await t.mutation(internal.promotion.apply, { contributionId: weak, partners: [partner] });
    expect((await get(objectId!))?.artworkId).toBe(known.artworkId);
  });
});

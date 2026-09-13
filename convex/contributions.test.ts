import { getFunctionName, type FunctionArgs, type FunctionReturnType } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { contribute as contributeAction } from './contributions';
import { labelField } from './lib/labelVerify';
import { loadOrb, storeOrb } from './lib/orbStorage';
import { encodeOrbFeatures } from '../shared/orb';
import { makeSyntheticPair } from '../shared/orb/test-fixtures';
import { seedArtworkWithObject, seedContribution, seedDevice, seedMuseum, seedScan, testVector } from './lib/testFactories';
import type { LabelFlow } from './lib/validators';
import { harness, signIn, type Harness } from './test.helpers';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// Wrap the actual handler to observe expensive work while retaining convex-test's auth and transactions.
const runContribute = (contributeAction as unknown as {
  _handler: (ctx: ActionCtx, args: FunctionArgs<typeof api.contributions.contribute>) =>
    Promise<FunctionReturnType<typeof api.contributions.contribute>>;
})._handler;

const pair = makeSyntheticPair({ count: 120 });
const features = encodeOrbFeatures(pair.query);
const fields = {
  title: { value: 'Water Lilies', edited: false },
  artist: { value: 'Claude Monet', edited: false },
  date: { value: '1916', edited: false },
};

function verifiedFlow(overrides: Partial<LabelFlow> = {}): LabelFlow {
  return {
    stage: 'verified',
    fields: {
      title: labelField('Water Lilies', 'wikidata'), artist: labelField('Claude Monet', 'wikidata'), date: labelField('1916', 'ocr'),
    },
    evidence: ['wikidata'], warnings: [], moderation: 'clear', wikidataId: 'Q3374376',
    rawOcr: { title: 'Water Lilies' }, updatedAt: Date.now(), ...overrides,
  };
}

async function storeCrop(t: Harness, { size = 1000, type = 'image/jpeg' } = {}): Promise<Id<'_storage'>> {
  return t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([new Uint8Array(size)], { type }));
    // convex-test keeps no content type for stored blobs; the real backend records the upload's header.
    const system = ctx.db as unknown as { patch(id: Id<'_storage'>, value: { contentType: string }): Promise<void> };
    await system.patch(id, { contentType: type });
    return id;
  });
}

async function fixture(flow: LabelFlow | null = verifiedFlow(), withVenue = true, t = harness()) {
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, {
    deviceId: user.deviceId, venueId: withVenue ? venueId : undefined, labelFlow: flow ?? undefined,
  }));
  const cropStorageId = await storeCrop(t);
  const sign = async (as = user.as) => ({
    nonce: (await as.mutation(api.devices.createChallenge, { purpose: 'assert' })).nonce, assertionBase64: 'AAAA',
  });
  const args = { scanId, ...features, fields, cropStorageId, consent: true as const };
  const contribute = async (overrides: Partial<typeof args> = {}) =>
    user.as.action(api.contributions.contribute, { ...args, ...overrides, ...(await sign()) });
  const rows = () => t.run((ctx) => ctx.db.query('contributions').collect());
  return { t, user, venueId, scanId, cropStorageId, args, sign, contribute, rows };
}

describe('withdraw', () => {
  // An object promoted from the user's contribution (its crop and features) with one partner from another device.
  async function promotedWithPartner(t: Harness, contributionId: Id<'contributions'>) {
    const partner = await seedDevice(t);
    const partnerCrop = await storeCrop(t);
    const { partnerId, objectId } = await t.run(async (ctx) => {
      const own = (await ctx.db.get(contributionId))!;
      const partnerId = await seedContribution(ctx, {
        deviceId: partner.deviceId, venueId: own.venueId, vector: testVector(0.95), cropStorageId: partnerCrop,
        descriptors: new Uint8Array(64).fill(1).buffer, keypoints: new Float32Array(8).buffer, keypointCount: 2,
      });
      const { objectId, vectorId } = await seedArtworkWithObject(ctx, {
        object: {
          source: 'user', sourceId: contributionId, thumbnailStorageId: own.cropStorageId, imageRef: `storage:${own.cropStorageId}`,
          provenance: { contributionIds: [contributionId, partnerId], deviceIds: [own.deviceId, partner.deviceId] },
        },
      });
      await ctx.db.delete(vectorId);
      for (const row of [own, (await ctx.db.get(partnerId))!]) {
        await ctx.db.insert('vectors', { objectId, modelVersion: row.modelVersion, source: 'user', vector: row.vector });
        await ctx.db.patch(row._id, { status: 'promoted', promotedObjectId: objectId });
      }
      await ctx.db.insert('descriptors', {
        objectId, storageId: own.orbStorageId!, sha256: own.orbSha256!, keypointCount: own.keypointCount,
        inputSize: model.inputSize, extractedFrom: `contribution:${contributionId}`,
      });
      return { partnerId, objectId };
    });
    return { partner, partnerId, partnerCrop, objectId };
  }
  const stored = (t: Harness, id: Id<'_storage'>) => t.run(async (ctx) => (await ctx.storage.get(id)) !== null);
  const objectState = (t: Harness, objectId: Id<'objects'>) => t.run(async (ctx) => ({
    object: (await ctx.db.get(objectId))!,
    vectors: (await ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) => q.eq('objectId', objectId)).collect())
      .map((row) => row.vector),
    descriptors: (await ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', objectId)).unique())!,
  }));

  it('keeps an object another device still backs and hands its thumbnail and features to the partner', async () => {
    const { t, user, contribute, cropStorageId } = await fixture();
    const { contributionId } = await contribute();
    const { partner, partnerId, partnerCrop, objectId } = await promotedWithPartner(t, contributionId);
    const ownOrb = (await t.run((ctx) => ctx.db.get(contributionId)))!.orbStorageId!;
    const partnerOrb = (await t.run((ctx) => ctx.db.get(partnerId)))!.orbStorageId!;
    await user.as.mutation(api.contributions.withdraw, { contributionId });
    const { object, vectors, descriptors } = await objectState(t, objectId);
    expect(object).toMatchObject({
      reverted: false, thumbnailStorageId: partnerCrop, imageRef: `storage:${partnerCrop}`,
      provenance: { contributionIds: [partnerId], deviceIds: [partner.deviceId] },
    });
    expect(vectors).toEqual([testVector(0.95)]);
    expect(descriptors).toMatchObject({ extractedFrom: `contribution:${partnerId}`, keypointCount: 2 });
    expect(descriptors.storageId).toBe(partnerOrb);
    expect(await stored(t, ownOrb)).toBe(false);
    expect(await stored(t, partnerOrb)).toBe(true);
    expect(await stored(t, cropStorageId)).toBe(false);
    expect(await stored(t, partnerCrop)).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(contributionId))).toMatchObject({ status: 'rejected', rejectedReason: 'withdrawn' });
    expect(await t.run((ctx) => ctx.db.get(partnerId))).toMatchObject({ status: 'promoted', cropStorageId: partnerCrop });
  });

  it('removes only the partner\'s vector and crop when the partner withdraws', async () => {
    const { t, user, contribute, cropStorageId } = await fixture();
    const { contributionId } = await contribute();
    const { partner, partnerId, partnerCrop, objectId } = await promotedWithPartner(t, contributionId);
    await partner.as.mutation(api.contributions.withdraw, { contributionId: partnerId });
    const { object, vectors, descriptors } = await objectState(t, objectId);
    expect(object).toMatchObject({
      reverted: false, thumbnailStorageId: cropStorageId, provenance: { contributionIds: [contributionId], deviceIds: [user.deviceId] },
    });
    expect(vectors).toEqual([testVector()]);
    expect(descriptors.extractedFrom).toBe(`contribution:${contributionId}`);
    expect(await stored(t, partnerCrop)).toBe(false);
    expect(await stored(t, cropStorageId)).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(partnerId))).toMatchObject({ status: 'rejected', rejectedReason: 'withdrawn' });
  });

  it('withdraws a private contribution, deletes its crop and tolerates a retry', async () => {
    const { t, user, contribute, cropStorageId } = await fixture();
    const { contributionId } = await contribute();
    const orbStorageId = (await t.run((ctx) => ctx.db.get(contributionId)))!.orbStorageId!;
    await user.as.mutation(api.contributions.withdraw, { contributionId });
    await user.as.mutation(api.contributions.withdraw, { contributionId });
    expect(await t.run((ctx) => ctx.db.get(contributionId))).toMatchObject({ status: 'rejected', rejectedReason: 'withdrawn' });
    expect(await t.run((ctx) => ctx.storage.get(cropStorageId))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.get(orbStorageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(contributionId))).not.toHaveProperty('orbStorageId');
    expect(await user.as.query(api.contributions.mine, {})).toMatchObject([{ rejectedReason: 'withdrawn' }]);
  });

  it('refuses another device and an unauthenticated caller', async () => {
    const { t, contribute } = await fixture();
    const { contributionId } = await contribute();
    const other = await seedDevice(t);
    await expect(other.as.mutation(api.contributions.withdraw, { contributionId })).rejects.toMatchObject({ data: { code: 'contribution_not_found' } });
    await expect(t.mutation(api.contributions.withdraw, { contributionId })).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    expect(await t.run((ctx) => ctx.db.get(contributionId))).not.toMatchObject({ rejectedReason: 'withdrawn' });
  });

  it('immediately hides an object no other device backs and cleans its index entries', async () => {
    vi.useFakeTimers();
    try {
      const { t, user, contribute, cropStorageId } = await fixture();
      const { contributionId } = await contribute();
      const { objectId } = await t.run(async (ctx) => {
        const work = await seedArtworkWithObject(ctx);
        await ctx.db.patch(work.objectId, {
          source: 'user', thumbnailStorageId: cropStorageId, provenance: { contributionIds: [contributionId], deviceIds: [user.deviceId] },
        });
        await ctx.db.patch(contributionId, { status: 'promoted', promotedObjectId: work.objectId });
        return work;
      });
      await user.as.mutation(api.contributions.withdraw, { contributionId });
      expect(await t.run((ctx) => ctx.db.get(objectId))).toMatchObject({ reverted: true, revertedReason: 'withdrawn' });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.run((ctx) => ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) => q.eq('objectId', objectId)).collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query('descriptors').withIndex('by_objectId', (q) => q.eq('objectId', objectId)).collect())).toEqual([]);
      expect(await t.run((ctx) => ctx.db.get(contributionId))).toMatchObject({ status: 'rejected', rejectedReason: 'withdrawn' });
    } finally { vi.useRealTimers(); }
  });

  it('withdraws from a heavily backed object within transaction limits and keeps a same-device partner listed', async () => {
    const { t, user, contribute } = await fixture(verifiedFlow(), true, harness({ transactionLimits: true }));
    const { contributionId } = await contribute();
    const { objectId, venueId } = await t.run(async (ctx) => {
      const own = (await ctx.db.get(contributionId))!;
      const { objectId } = await seedArtworkWithObject(ctx, {
        object: { source: 'user', sourceId: contributionId, provenance: { contributionIds: [contributionId], deviceIds: [own.deviceId] } },
      });
      await ctx.db.insert('vectors', { objectId, modelVersion: own.modelVersion, source: 'user', vector: own.vector });
      await ctx.db.patch(contributionId, { status: 'promoted', promotedObjectId: objectId });
      return { objectId, venueId: own.venueId };
    });
    // Backers together exceed what one transaction may read; a second own contribution keeps the device in provenance.
    const partnerIds: Id<'contributions'>[] = [];
    for (let i = 0; i < 40; i++) {
      const deviceId = i === 0 ? user.deviceId : (await seedDevice(t)).deviceId;
      const cropStorageId = await storeCrop(t);
      partnerIds.push(await t.run(async (ctx) => {
        const vector = testVector(0.9 + i * 0.002);
        const id = await seedContribution(ctx, {
          deviceId, venueId, vector, status: 'promoted', promotedObjectId: objectId, cropStorageId,
          fields: {
            title: { value: 'Water Lilies', edited: false, evidence: 'ocr' }, artist: { value: 'Claude Monet', edited: false, evidence: 'ocr' },
            creditLine: { value: 'x'.repeat(450_000), edited: true, evidence: 'user_edited' },
          },
        });
        await ctx.db.insert('vectors', { objectId, modelVersion: model.modelVersion, source: 'user', vector });
        const object = (await ctx.db.get(objectId))!;
        await ctx.db.patch(objectId, { provenance: {
          contributionIds: [...object.provenance!.contributionIds, id], deviceIds: [...new Set([...object.provenance!.deviceIds, deviceId])],
        } });
        return id;
      }));
    }
    await user.as.mutation(api.contributions.withdraw, { contributionId });
    const object = (await t.run((ctx) => ctx.db.get(objectId)))!;
    expect(object.reverted).toBe(false);
    expect(object.provenance!.contributionIds).toEqual(partnerIds);
    expect(object.provenance!.deviceIds).toContain(user.deviceId);
    expect(object.provenance!.deviceIds).toHaveLength(40);
    const vectors = await t.run((ctx) => ctx.db.query('vectors').withIndex('by_objectId_modelVersion_source', (q) => q.eq('objectId', objectId)).collect());
    expect(vectors.filter((row) => row.source === 'user')).toHaveLength(40);
    expect(await t.run((ctx) => ctx.db.get(partnerIds[0]))).toMatchObject({ status: 'promoted' });
  });
});

describe('contribute', () => {
  it.each(['challenge_invalid', 'device_not_attested', 'rate_limited', 'label_unverified'] as const)(
    'does no duplicate search when authorization fails with %s', async (code) => {
      vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
      const { t, user, scanId, args, sign } = await fixture();
      const signed = await sign();
      if (code === 'challenge_invalid') signed.nonce = 'not-a-challenge';
      if (code === 'device_not_attested') vi.stubEnv('APP_ATTEST_REQUIRED', 'true');
      if (code === 'label_unverified') await t.run((ctx) => ctx.db.patch(scanId, { labelFlow: undefined }));
      if (code === 'rate_limited') {
        for (let i = 0; i < 20; i++) await user.as.mutation(api.contributions.requestCropUpload, {});
      }
      const work: string[] = [];
      await expect(user.as.action(async (ctx) => {
        const search = vi.spyOn(ctx, 'vectorSearch');
        const queries = vi.spyOn(ctx, 'runQuery');
        try {
          return await runContribute(ctx, { ...args, ...signed });
        } finally {
          work.push(...queries.mock.calls.map(([fn]) => getFunctionName(fn)));
          if (search.mock.calls.length) work.push('vectorSearch');
        }
      })).rejects.toMatchObject({ data: { code } });
      expect(work).not.toContain('vectorSearch');
      expect(work).not.toContain('contributions:checkDuplicatePage');
    },
  );

  it('charges failed searches before they run and refuses them after the budget is spent', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { user, args, sign } = await fixture();
    let searches = 0;
    for (let i = 0; i < 21; i++) {
      const signed = await sign();
      const call = user.as.action(async (ctx) => {
        vi.spyOn(ctx, 'vectorSearch').mockImplementation(async () => {
          searches++;
          throw new Error('search unavailable');
        });
        return runContribute(ctx, { ...args, ...signed });
      });
      if (i < 20) await expect(call).rejects.toThrow('search unavailable');
      else await expect(call).rejects.toMatchObject({ data: { code: 'rate_limited' } });
    }
    expect(searches).toBe(20);
  });

  it('stores a private contribution with the scan vector, the verified evidence and the consented crop', async () => {
    const { t, user, venueId, scanId, cropStorageId, contribute, rows } = await fixture();
    const result = await contribute();
    expect(result).toEqual({ contributionId: expect.any(String), status: 'private' });
    const [row] = await rows();
    expect(row).toMatchObject({
      _id: result.contributionId, deviceId: user.deviceId, venueId, scanId, vector: testVector(), keypointCount: pair.query.count,
      cropStorageId, status: 'private', wikidataId: 'Q3374376', rawOcr: { title: 'Water Lilies' }, evidence: ['wikidata', 'ocr'],
      fields: {
        title: { value: 'Water Lilies', edited: false, evidence: 'wikidata' },
        artist: { value: 'Claude Monet', edited: false, evidence: 'wikidata' },
        date: { value: '1916', edited: false, evidence: 'ocr' },
      },
    });
    expect(row).not.toHaveProperty('descriptors');
    expect(row).not.toHaveProperty('keypoints');
    expect(await t.run((ctx) => loadOrb(ctx, row.orbStorageId!, row.keypointCount))).toEqual(features);
    expect(row.rejectedReason).toBeUndefined();
    const mine = await user.as.query(api.contributions.mine, {});
    expect(mine).toMatchObject([{ contributionId: result.contributionId, status: 'private', venueId, scanId, wikidataId: 'Q3374376' }]);
    expect(mine[0]).not.toHaveProperty('vector');
    expect(mine[0]).not.toHaveProperty('descriptors');
  });

  it('keeps the verified museum page identity after the scan label flow changes', async () => {
    const sourceUrl = 'https://museum.example/works/water-lilies';
    const { t, scanId, contribute, rows } = await fixture(verifiedFlow({ sourceUrl, wikidataId: undefined }));
    await contribute();
    await t.run((ctx) => ctx.db.patch(scanId, { labelFlow: verifiedFlow({ sourceUrl: 'https://museum.example/works/haystacks' }) }));
    expect((await rows())[0].sourceUrl).toBe(sourceUrl);
  });

  it.each([
    { name: 'date', edited: { date: { value: '1916', edited: true } }, wikidataId: 'Q3374376' },
    { name: 'title', edited: { title: { value: 'Water Lilies', edited: true } }, wikidataId: undefined },
    { name: 'artist', edited: { artist: { value: 'Claude Monet', edited: true } }, wikidataId: undefined },
  ])('marks an edited $name user_edited and keeps the Wikidata binding only while the pair is untouched', async ({ name, edited, wikidataId }) => {
    const { contribute, rows } = await fixture();
    await contribute({ fields: { ...fields, ...edited } });
    const [row] = await rows();
    expect(row.fields[name as keyof typeof fields]).toMatchObject({ edited: true, evidence: 'user_edited' });
    expect(row.wikidataId).toBe(wikidataId);
    expect(row.evidence).toContain('user_edited');
  });

  it.each([
    ['a value that differs from the verified one', { title: { value: 'Water Lily Pond', edited: false } }],
    ['an edited value the label flow never verified', { title: { value: 'Water Lily Pond', edited: true } }],
    ['a field the label flow does not hold', { medium: { value: 'Oil on canvas', edited: false } }],
  ])('rejects %s', async (_name, override) => {
    const { contribute, rows } = await fixture();
    await expect(contribute({ fields: { ...fields, ...override } })).rejects.toMatchObject({ data: { code: 'field_mismatch' } });
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['a label that was only read', verifiedFlow({ stage: 'read' })],
    ['a moderated label', verifiedFlow({ moderation: 'flagged', fields: {} })],
    ['no label flow', null],
  ])('refuses %s', async (_name, flow) => {
    const { contribute, rows } = await fixture(flow);
    await expect(contribute()).rejects.toMatchObject({ data: { code: 'label_unverified' } });
    expect(await rows()).toEqual([]);
  });

  it('requires the device’s own venue-resolved scan', async () => {
    const unresolved = await fixture(verifiedFlow(), false);
    await expect(unresolved.contribute()).rejects.toMatchObject({ data: { code: 'invalid_scan' } });
    const { t, args, sign, rows } = await fixture();
    const stranger = await seedDevice(t);
    await expect(stranger.as.action(api.contributions.contribute, { ...args, ...(await sign(stranger.as)) }))
      .rejects.toMatchObject({ data: { code: 'invalid_scan' } });
    expect(await unresolved.rows()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('rejects a vector that near-duplicates an indexed work and discards its crop', async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    await t.run((ctx) => seedArtworkWithObject(ctx, { vector: testVector() }));
    const result = await contribute();
    expect(result).toMatchObject({ status: 'rejected', reason: 'duplicate' });
    const [row] = await rows();
    expect(row).toMatchObject({ _id: result.contributionId, status: 'rejected', rejectedReason: 'duplicate' });
    expect(row.cropStorageId).toBeUndefined();
    expect(row.orbStorageId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.system.get('_storage', cropStorageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toEqual([]);
  });

  it('ignores indexed vectors below the duplicate threshold or from another model version', async () => {
    const { t, contribute } = await fixture();
    await t.run(async (ctx) => {
      await seedArtworkWithObject(ctx, { vector: testVector(0.99) });
      await seedArtworkWithObject(ctx, { vector: testVector(), modelVersion: 'other-model' });
    });
    expect(await contribute()).toMatchObject({ status: 'private' });
  });

  it('returns the accepted contribution on retry and keeps its crop', async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    const accepted = await contribute();
    expect(await contribute()).toEqual(accepted);
    expect(await rows()).toHaveLength(1);
    expect(await t.run((ctx) => ctx.storage.getUrl(cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(accepted.contributionId))).toMatchObject({ cropStorageId });
  });

  it('discards only the unused replacement upload on retry', async () => {
    const { t, cropStorageId, contribute } = await fixture();
    const accepted = await contribute();
    const replacement = await storeCrop(t);
    expect(await contribute({ cropStorageId: replacement })).toEqual(accepted);
    expect(await t.run((ctx) => ctx.storage.getUrl(cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(replacement))).toBeNull();
  });

  it('does not let a retry delete storage files that are not contribution crops', async () => {
    const { t, contribute } = await fixture();
    const accepted = await contribute();
    const unrelated = await storeCrop(t, { type: 'application/vnd.sqlite3' });
    expect(await contribute({ cropStorageId: unrelated })).toEqual(accepted);
    expect(await t.run((ctx) => ctx.storage.getUrl(unrelated))).not.toBeNull();
  });

  it.each(['pending', 'promoted'] as const)('returns the existing %s status when a contribution has advanced before retry', async (status) => {
    const { t, contribute } = await fixture();
    const accepted = await contribute();
    await t.run((ctx) => ctx.db.patch(accepted.contributionId, { status }));
    expect(await contribute()).toEqual({ ...accepted, status });
  });

  it('retries a rejected submission even after its crop was discarded', async () => {
    const { t, contribute, rows } = await fixture();
    await t.run((ctx) => seedArtworkWithObject(ctx));
    const rejected = await contribute();
    expect(rejected.status).toBe('rejected');
    expect(await contribute()).toEqual(rejected);
    expect(await rows()).toHaveLength(1);
  });

  it('does not delete an accepted crop reused by another scan', async () => {
    const { t, user, venueId, cropStorageId, contribute } = await fixture();
    const accepted = await contribute();
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    expect(await contribute({ scanId })).toMatchObject({ status: 'rejected', reason: 'duplicate' });
    expect(await t.run((ctx) => ctx.storage.getUrl(cropStorageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(accepted.contributionId))).toMatchObject({ cropStorageId });
  });

  it.each(['same', 'different'] as const)('accepts new works after a large contribution history at the %s venue', async (scope) => {
    const t = harness({ transactionLimits: true });
    const { user, venueId, contribute } = await fixture(verifiedFlow(), true, t);
    const historyVenue = scope === 'same' ? venueId : await t.run((ctx) => seedMuseum(ctx));
    const vectorAt = (index: number) => {
      const vector = Array<number>(model.embeddingDim).fill(0);
      vector[index] = 1;
      return vector;
    };
    for (let batch = 0; batch < 12; batch++) {
      await t.run(async (ctx) => {
        for (let index = 1; index <= 50; index++) await seedContribution(ctx, {
          deviceId: user.deviceId, venueId: historyVenue, vector: vectorAt(batch * 50 + index), modelVersion: model.modelVersion,
          descriptors: new ArrayBuffer(16_000), keypoints: new ArrayBuffer(8_000), keypointCount: 500,
          fields: {
            title: { ...fields.title, evidence: 'wikidata' }, artist: { ...fields.artist, evidence: 'wikidata' },
          },
          evidence: ['wikidata'], status: 'private', createdAt: Date.now(),
        });
      });
    }
    expect(await contribute()).toMatchObject({ status: 'private' });
    const scanId = await t.run((ctx) => seedScan(ctx, {
      deviceId: user.deviceId, venueId, vector: vectorAt(600), labelFlow: verifiedFlow(),
    }));
    expect(await contribute({ scanId, cropStorageId: await storeCrop(t) }))
      .toMatchObject({ status: scope === 'same' ? 'rejected' : 'private' });
  });

  it('accepts only one of two concurrent duplicate scans', async () => {
    const { t, user, venueId, args, sign, rows } = await fixture();
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    const cropStorageId = await storeCrop(t);
    const contribute = async (overrides: Partial<typeof args>) => {
      const signed = await sign();
      return user.as.action((ctx) => runContribute({
        ...ctx,
        // convex-test's action storage writes race with concurrent mutation transactions.
        storage: { ...ctx.storage, store: (blob) => t.run((transaction) => transaction.storage.store(blob)) },
      }, { ...args, ...overrides, ...signed }));
    };
    const results = await Promise.all([contribute({}), contribute({ scanId, cropStorageId })]);
    expect(results.map((result) => result.status).sort()).toEqual(['private', 'rejected']);
    expect((await rows()).filter((row) => row.status === 'private')).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toHaveLength(2);
  });

  it('refuses a stale duplicate check and retries the commit without another authorization', async () => {
    const { t, user, venueId, args, sign, contribute, rows } = await fixture();
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    const cropStorageId = await storeCrop(t);
    const signed = await sign();
    await user.as.mutation(internal.contributions.authorize, { scanId, cropStorageId, fields, ...signed });
    const first = await contribute();
    const { consent: _consent, descriptors, keypoints, ...submission } = args;
    const orb = await t.run((ctx) => storeOrb(ctx, descriptors, keypoints));
    const rest = { ...submission, orbStorageId: orb.storageId, orbSha256: orb.sha256 };
    await expect(user.as.mutation(internal.contributions.commit, {
      ...rest, scanId, cropStorageId, generation: 0, keypointCount: pair.query.count,
      duplicate: false, previousContributionId: null,
    })).rejects.toMatchObject({ data: { code: 'contributions_changed' } });
    expect(await rows()).toHaveLength(1);
    expect(await user.as.mutation(internal.contributions.commit, {
      ...rest, scanId, cropStorageId, generation: 0, keypointCount: pair.query.count,
      duplicate: true, previousContributionId: first.contributionId,
    })).toMatchObject({ status: 'rejected', reason: 'duplicate' });
    await expect(user.as.action(api.contributions.contribute, { ...args, ...signed, scanId, cropStorageId }))
      .rejects.toMatchObject({ data: { code: 'challenge_invalid' } });
  });

  it('rejects a repeat of the device’s own contribution at the venue, not a different work or another device', async () => {
    const { t, user, venueId, contribute, rows } = await fixture();
    expect(await contribute()).toMatchObject({ status: 'private' });
    const repeat = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    expect(await contribute({ scanId: repeat, cropStorageId: await storeCrop(t) })).toMatchObject({ status: 'rejected', reason: 'duplicate' });
    const different = await t.run((ctx) => seedScan(ctx, {
      deviceId: user.deviceId, venueId, vector: testVector(0.9), labelFlow: verifiedFlow(),
    }));
    expect(await contribute({ scanId: different, cropStorageId: await storeCrop(t) })).toMatchObject({ status: 'private' });
    const other = await seedDevice(t);
    const otherScan = await t.run((ctx) => seedScan(ctx, { deviceId: other.deviceId, venueId, labelFlow: verifiedFlow() }));
    const { nonce } = await other.as.mutation(api.devices.createChallenge, { purpose: 'assert' });
    expect(await other.as.action(api.contributions.contribute, {
      scanId: otherScan, ...features, fields, cropStorageId: await storeCrop(t), consent: true, nonce, assertionBase64: 'AAAA',
    })).toMatchObject({ status: 'private' });
    expect((await rows()).map((row) => row.status)).toEqual(['private', 'rejected', 'private', 'private']);
  });

  it.each([
    ['a non-JPEG file', { type: 'image/png' }],
    ['an oversized file', { size: 200 * 1024 + 1 }],
  ])('rejects %s as the crop', async (_name, crop) => {
    const { t, contribute, rows } = await fixture();
    await expect(contribute({ cropStorageId: await storeCrop(t, crop) })).rejects.toMatchObject({ data: { code: 'bad_crop' } });
    expect(await rows()).toEqual([]);
  });

  it('rejects a crop that is no longer in storage', async () => {
    const { t, cropStorageId, contribute, rows } = await fixture();
    await t.run((ctx) => ctx.storage.delete(cropStorageId));
    await expect(contribute()).rejects.toMatchObject({ data: { code: 'bad_crop' } });
    expect(await rows()).toEqual([]);
  });

  it('rejects malformed features before spending the challenge, and never accepts a spent one', async () => {
    const { user, args, sign } = await fixture();
    const signed = await sign();
    await expect(user.as.action(api.contributions.contribute, { ...args, ...signed, descriptors: new ArrayBuffer(1) }))
      .rejects.toMatchObject({ data: { code: 'bad_features' } });
    expect(await user.as.action(api.contributions.contribute, { ...args, ...signed })).toMatchObject({ status: 'private' });
    await expect(user.as.action(api.contributions.contribute, { ...args, ...signed }))
      .rejects.toMatchObject({ data: { code: 'challenge_invalid' } });
  });

  it('ignores a contribution whose scan was restarted meanwhile', async () => {
    const { t, user, args, sign, rows } = await fixture();
    await user.as.mutation(internal.contributions.authorize, {
      scanId: args.scanId, cropStorageId: args.cropStorageId, fields, ...(await sign()),
    });
    const { consent: _consent, descriptors, keypoints, ...submission } = args;
    const orb = await t.run((ctx) => storeOrb(ctx, descriptors, keypoints));
    const rest = { ...submission, orbStorageId: orb.storageId, orbSha256: orb.sha256 };
    await expect(user.as.mutation(internal.contributions.commit, {
      ...rest, generation: 1, keypointCount: pair.query.count, duplicate: false, previousContributionId: null,
    })).rejects.toMatchObject({ data: { code: 'scan_restarted' } });
    expect(await rows()).toEqual([]);
  });

  it('requires an attested device when attestation is enforced', async () => {
    vi.stubEnv('APP_ATTEST_REQUIRED', 'true');
    const t = harness();
    const user = await signIn(t);
    const { deviceId } = await user.as.mutation(api.devices.registerDevice, { platform: 'ios' });
    const venueId = await t.run((ctx) => seedMuseum(ctx));
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId, venueId, labelFlow: verifiedFlow() }));
    const { nonce } = await user.as.mutation(api.devices.createChallenge, { purpose: 'assert' });
    await expect(user.as.action(api.contributions.contribute, {
      scanId, ...features, fields, cropStorageId: await storeCrop(t), consent: true, nonce, assertionBase64: 'AAAA',
    })).rejects.toMatchObject({ data: { code: 'device_not_attested' } });
    expect(await t.run((ctx) => ctx.db.query('contributions').collect())).toEqual([]);
  });

  it('shares one hourly budget between crop uploads and contributions', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { user, contribute } = await fixture();
    for (let i = 0; i < 20; i++) {
      expect((await user.as.mutation(api.contributions.requestCropUpload, {})).uploadUrl).toMatch(/^https:/);
    }
    await expect(contribute()).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'contribute' } });
  });

  it('lists only the caller’s contributions and requires a registered device throughout', async () => {
    const { t, user, args, contribute } = await fixture();
    await contribute();
    const other = await seedDevice(t);
    expect(await other.as.query(api.contributions.mine, {})).toEqual([]);
    expect(await user.as.query(api.contributions.mine, {})).toHaveLength(1);
    await expect(t.query(api.contributions.mine, {})).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    await expect(t.mutation(api.contributions.requestCropUpload, {})).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    const unregistered = await signIn(t);
    await expect(unregistered.as.action(api.contributions.contribute, { ...args, nonce: 'n', assertionBase64: 'a' }))
      .rejects.toMatchObject({ data: { code: 'device_not_registered' } });
  });
});

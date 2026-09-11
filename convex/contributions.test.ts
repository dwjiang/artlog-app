import { getFunctionName, type FunctionArgs, type FunctionReturnType } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { contribute as contributeAction } from './contributions';
import { labelField } from './lib/labelVerify';
import { encodeOrbFeatures } from './lib/orb';
import { makeSyntheticPair } from './lib/orb/testFixtures';
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan, testVector } from './lib/testFactories';
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
    const { user, venueId, scanId, cropStorageId, contribute, rows } = await fixture();
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
    expect(row.descriptors.byteLength).toBe(features.descriptors.byteLength);
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
    expect(await t.run((ctx) => ctx.db.system.get('_storage', cropStorageId))).toBeNull();
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
        for (let index = 1; index <= 50; index++) await ctx.db.insert('contributions', {
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
    const { t, user, venueId, contribute, rows } = await fixture();
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    const cropStorageId = await storeCrop(t);
    const results = await Promise.all([contribute(), contribute({ scanId, cropStorageId })]);
    expect(results.map((result) => result.status).sort()).toEqual(['private', 'rejected']);
    expect((await rows()).filter((row) => row.status === 'private')).toHaveLength(1);
  });

  it('refuses a stale duplicate check and retries the commit without another authorization', async () => {
    const { t, user, venueId, args, sign, contribute, rows } = await fixture();
    const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId, labelFlow: verifiedFlow() }));
    const cropStorageId = await storeCrop(t);
    const signed = await sign();
    await user.as.mutation(internal.contributions.authorize, { scanId, cropStorageId, fields, ...signed });
    const first = await contribute();
    const { consent: _consent, ...rest } = args;
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
    const { user, args, sign, rows } = await fixture();
    await user.as.mutation(internal.contributions.authorize, {
      scanId: args.scanId, cropStorageId: args.cropStorageId, fields, ...(await sign()),
    });
    const { consent: _consent, ...rest } = args;
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

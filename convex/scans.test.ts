import { afterEach, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { api, internal } from './_generated/api';
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from './lib/testFactories';
import { harness } from './test.helpers';

afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, { object: { ownerId: venueId } }));
  const args = {
    deviceId: user.deviceId, localId: 'capture-1', modelVersion: model.modelVersion,
    vector: testVector(), capturedAt: Date.now(), venueId,
  };
  const created = await t.mutation(internal.scans.create, args);
  const best = { objectId: work.objectId, artworkId: work.artworkId, probability: 0.99, gallery: '4' };
  return { t, user, venueId, work, args, scanId: created.scanId, best };
}

it('creates one pending scan per device and local capture id', async () => {
  const { t, args, scanId } = await fixture();
  expect(await t.mutation(internal.scans.create, args)).toEqual({ scanId, existing: true });
  expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({ status: 'pending', vector: args.vector });
  const other = await seedDevice(t);
  expect((await t.mutation(internal.scans.create, { ...args, deviceId: other.deviceId })).scanId).not.toBe(scanId);
});

it('requires authentication and hides scans belonging to other devices', async () => {
  const { t, user, scanId } = await fixture();
  await expect(t.query(api.scans.get, { scanId })).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  const other = await seedDevice(t);
  expect(await other.as.query(api.scans.get, { scanId })).toBeNull();
  expect(await user.as.query(api.scans.get, { scanId })).toMatchObject({ scanId, status: 'pending' });
});

it.each(['public_domain', 'in_copyright', 'unknown'] as const)(
  'joins display data and only exposes public-domain thumbnails (%s)', async (rightsStatus) => {
    const { t, user, work, scanId, best } = await fixture();
    await t.run((ctx) => ctx.db.patch(work.artworkId, { rightsStatus }));
    await t.mutation(internal.scans.setResult, {
      scanId, status: 'identified', outcome: 'soft', best,
      runnerUps: [{ objectId: best.objectId, artworkId: best.artworkId, probability: 0.5 }],
      calibratorVersion: 'lr-v1',
    });
    const result = await user.as.query(api.scans.get, { scanId });
    expect(result?.best).toMatchObject({ title: 'Water Lilies', artist: 'Claude Monet', institution: 'Test Museum', rightsStatus });
    for (const candidate of [result?.best, ...result!.runnerUps!]) {
      if (rightsStatus === 'public_domain') expect(candidate?.thumbnailUrl).toBe('https://museum.example/work.jpg');
      else expect(candidate).not.toHaveProperty('thumbnailUrl');
    }
    expect(result).not.toHaveProperty('vector');
    expect(result).not.toHaveProperty('deviceId');
  },
);

it('keeps waiting features, then clears them while retaining the embedding', async () => {
  const { t, scanId, args } = await fixture();
  const keepFeatures = { descriptors: new ArrayBuffer(32), keypoints: new ArrayBuffer(16), keypointCount: 1 };
  await t.mutation(internal.scans.setResult, { scanId, status: 'waiting', keepFeatures, calibratorVersion: 'lr-v1' });
  expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject(keepFeatures);
  await t.mutation(internal.scans.setResult, { scanId, status: 'identified', outcome: 'miss', calibratorVersion: 'lr-v1' });
  const scan = await t.run((ctx) => ctx.db.get(scanId));
  expect(scan?.descriptors).toBeUndefined();
  expect(scan?.keypoints).toBeUndefined();
  expect(scan?.keypointCount).toBeUndefined();
  expect(scan?.vector).toEqual(args.vector);
  expect(scan?.calibratorVersion).toBe('lr-v1');
});

it('updates gallery history only for a confident result and never rolls it backwards', async () => {
  const { t, user, venueId, args, best } = await fixture();
  const visitId = await t.run((ctx) => ctx.db.insert('visits', {
    deviceId: user.deviceId, venueId, startedAt: 0, lastConfidentGallery: '1', lastConfidentAt: 100,
  }));
  const { scanId } = await t.mutation(internal.scans.create, { ...args, localId: 'visit-scan', visitId, capturedAt: 200 });
  const result = { scanId, status: 'identified' as const, best, calibratorVersion: 'lr-v1' };
  await t.mutation(internal.scans.setResult, { ...result, outcome: 'soft' });
  expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '1', lastConfidentAt: 100 });
  await t.mutation(internal.scans.setResult, { ...result, outcome: 'confident' });
  expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '4', lastConfidentAt: 200 });
  await t.run((ctx) => ctx.db.patch(visitId, { lastConfidentGallery: '9', lastConfidentAt: 300 }));
  await t.mutation(internal.scans.setResult, { ...result, outcome: 'confident' });
  expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '9', lastConfidentAt: 300 });
});

it('refuses another device’s visit or a visit at another venue', async () => {
  const { t, user, venueId, args } = await fixture();
  const other = await seedDevice(t);
  const visitId = await t.run((ctx) => ctx.db.insert('visits', { deviceId: other.deviceId, venueId, startedAt: 0 }));
  await expect(t.mutation(internal.scans.create, { ...args, localId: 'foreign', visitId })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
  const otherVenue = await t.run((ctx) => seedMuseum(ctx));
  await t.run((ctx) => ctx.db.patch(visitId, { deviceId: user.deviceId, venueId: otherVenue }));
  await expect(t.mutation(internal.scans.create, { ...args, localId: 'wrong-venue', visitId })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
});

it('paginates only waiting scans for the requested venue', async () => {
  const { t, scanId, venueId, args } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId, status: 'waiting', calibratorVersion: 'lr-v1',
    keepFeatures: { descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0), keypointCount: 0 },
  });
  await t.mutation(internal.scans.create, { ...args, localId: 'pending' });
  const page = await t.query(internal.scans.listWaiting, { venueId });
  expect(page.page.map((scan) => scan._id)).toEqual([scanId]);
  expect(page.isDone).toBe(true);
  expect((await t.query(internal.scans.listWaiting, { venueId: await t.run((ctx) => seedMuseum(ctx)) })).page).toEqual([]);
});

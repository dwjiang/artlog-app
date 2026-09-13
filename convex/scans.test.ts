import { afterEach, expect, it, vi } from 'vitest';

import model from '../shared/model/model-version.json';
import { api, internal } from './_generated/api';
import { labelField } from './lib/labelVerify';
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from './lib/testFactories';
import { harness } from './test.helpers';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

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
  return { t, user, venueId, work, args, scanId: created.scan._id, best };
}

it('creates one pending scan per device and local capture id', async () => {
  const { t, args, scanId } = await fixture();
  expect(await t.mutation(internal.scans.create, args)).toMatchObject({ scan: { _id: scanId }, existing: true });
  expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({ status: 'pending', vector: args.vector });
  const other = await seedDevice(t);
  expect((await t.mutation(internal.scans.create, { ...args, deviceId: other.deviceId })).scan._id).not.toBe(scanId);
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
      scanId, generation: 0, status: 'identified', outcome: 'soft', best,
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

it.each(['confident', 'soft'] as const)('joins docent sentences and source chips from the artwork only for a confident card (%s)', async (outcome) => {
  const { t, user, work, scanId, best } = await fixture();
  const factSheet = [{ id: 'f1', text: 'Painted in 1916.', sourceUrl: 'https://www.metmuseum.org/art/1', sourceLabel: 'The Met', sourceScore: 1 }];
  const docent = { en: [{ sentence: 'Monet painted these water lilies in 1916.', factIds: ['f1'] }] };
  await t.run((ctx) => ctx.db.patch(work.artworkId, { factSheet, factSheetUpdatedAt: 1, docent, docentUpdatedAt: 2 }));
  await t.mutation(internal.scans.setResult, { scanId, generation: 0, status: 'identified', outcome, best, calibratorVersion: 'lr-v1' });
  const result = await user.as.query(api.scans.get, { scanId });
  if (outcome === 'confident') {
    expect(result?.docent).toEqual(docent.en);
    expect(result?.factSheet).toEqual([{ id: 'f1', sourceUrl: 'https://www.metmuseum.org/art/1', sourceLabel: 'The Met' }]);
  } else {
    expect(result?.docent).toBeUndefined();
    expect(result?.factSheet).toBeUndefined();
  }
});

it('updates gallery history only for a confident result and never rolls it backwards', async () => {
  const { t, user, venueId, args, best } = await fixture();
  const visitId = await t.run((ctx) => ctx.db.insert('visits', {
    deviceId: user.deviceId, venueId, startedAt: 0, lastConfidentGallery: '1', lastConfidentAt: 100,
  }));
  const result = { generation: 0, status: 'identified' as const, best, calibratorVersion: 'lr-v1' };
  const soft = await t.mutation(internal.scans.create, { ...args, localId: 'soft', visitId, capturedAt: 150 });
  await t.mutation(internal.scans.setResult, { ...result, scanId: soft.scan._id, outcome: 'soft' });
  expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '1', lastConfidentAt: 100 });
  const confident = await t.mutation(internal.scans.create, { ...args, localId: 'confident', visitId, capturedAt: 200 });
  await t.mutation(internal.scans.setResult, { ...result, scanId: confident.scan._id, outcome: 'confident' });
  expect(await t.run((ctx) => ctx.db.get(visitId))).toMatchObject({ lastConfidentGallery: '4', lastConfidentAt: 200 });
  await t.run((ctx) => ctx.db.patch(visitId, { lastConfidentGallery: '9', lastConfidentAt: 300 }));
  const older = await t.mutation(internal.scans.create, { ...args, localId: 'older', visitId, capturedAt: 250 });
  await t.mutation(internal.scans.setResult, { ...result, scanId: older.scan._id, outcome: 'confident' });
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

it('ignores results from an older payload after an unsupported capture is restarted', async () => {
  const { t, args, scanId } = await fixture();
  await t.mutation(internal.scans.setResult, {
    scanId, generation: 0, status: 'unsupported_version', calibratorVersion: 'lr-v1', error: 'Update the app to identify.',
  });
  const restarted = await t.mutation(internal.scans.create, args);
  expect(restarted.scan).toMatchObject({ _id: scanId, status: 'pending', generation: 1 });
  expect(restarted.scan.error).toBeUndefined();
  await t.mutation(internal.scans.setResult, {
    scanId, generation: 0, status: 'unsupported_version', calibratorVersion: 'lr-v1', error: 'Update the app to identify.',
  });
  expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({ status: 'pending', generation: 1 });
  await t.mutation(internal.scans.setResult, {
    scanId, generation: 1, status: 'identified', outcome: 'miss', calibratorVersion: 'lr-v1',
  });
  expect(await t.run((ctx) => ctx.db.get(scanId))).toMatchObject({ status: 'identified', outcome: 'miss' });
});

it('exposes the museum-site search state and the label flow without raw OCR to the owner only', async () => {
  const { t, user, scanId } = await fixture();
  await t.mutation(internal.scans.setResult, { scanId, generation: 0, status: 'identified', outcome: 'miss', calibratorVersion: 'lr-v1' });
  const before = await user.as.query(api.scans.get, { scanId });
  expect(before?.labelFlow).toBeUndefined();
  expect(before?.museumSearch).toBeUndefined();
  const candidate = {
    sourceUrl: 'https://www.metmuseum.org/art/collection/search/437137',
    fields: { title: 'Water Lilies', artist: 'Claude Monet', accession: '1998.325.2' },
    imageUrls: ['https://images.metmuseum.org/work.jpg'],
  };
  const write = async (museumSearch: Parameters<typeof t.mutation<typeof internal.museumSearch.write>>[1]['museumSearch']) => {
    const revision = await t.mutation(internal.museumSearch.beginSearch, { scanId, deviceId: user.deviceId, generation: 0 });
    return t.mutation(internal.museumSearch.write, { scanId, deviceId: user.deviceId, generation: 0, revision, museumSearch });
  };
  await write({ stage: 'candidates', candidates: [candidate], promptVersion: 'describe-v1', updatedAt: 1 });
  expect((await user.as.query(api.scans.get, { scanId }))?.museumSearch).toEqual({
    stage: 'candidates', candidates: [candidate], promptVersion: 'describe-v1', updatedAt: 1,
  });
  await write({ stage: 'none', reason: 'cap', updatedAt: 2 });
  expect((await user.as.query(api.scans.get, { scanId }))?.museumSearch).toEqual({ stage: 'none', reason: 'cap', updatedAt: 2 });
  await write({ stage: 'none', reason: 'no_candidates', promptVersion: 'describe-v1', updatedAt: 3 });
  expect((await user.as.query(api.scans.get, { scanId }))?.museumSearch).toMatchObject({ reason: 'no_candidates', promptVersion: 'describe-v1' });

  const fields = {
    title: labelField('Water Lilies', 'tavily+image'), artist: labelField('Claude Monet', 'tavily+image'),
    accession: labelField('1998.325.2', 'tavily'),
  };
  const selected = { sourceUrl: candidate.sourceUrl, imageUrl: candidate.imageUrls[0] };
  await t.run((ctx) => ctx.db.patch(scanId, {
    labelFlow: {
      stage: 'verified', fields, evidence: ['tavily+image', 'tavily'], warnings: [], moderation: 'clear',
      rawOcr: { title: 'Water Lilies' }, sourceUrl: candidate.sourceUrl, imageUrls: candidate.imageUrls, updatedAt: 4,
    },
    museumSearch: { stage: 'confirmed', candidates: [candidate], selected, promptVersion: 'describe-v1', updatedAt: 4 },
  }));
  const confirmed = await user.as.query(api.scans.get, { scanId });
  expect(confirmed?.museumSearch).toEqual({ stage: 'confirmed', candidates: [candidate], selected, promptVersion: 'describe-v1', updatedAt: 4 });
  expect(confirmed?.labelFlow).toEqual({
    stage: 'verified', fields, evidence: ['tavily+image', 'tavily'], warnings: [], moderation: 'clear',
    sourceUrl: candidate.sourceUrl, imageUrls: candidate.imageUrls, updatedAt: 4,
  });
  expect(confirmed?.labelFlow).not.toHaveProperty('rawOcr');
  expect(confirmed).not.toHaveProperty('vector');
  expect(confirmed).not.toHaveProperty('deviceId');
  expect(confirmed).not.toHaveProperty('museumSearchRevision');
  const other = await seedDevice(t);
  expect(await other.as.query(api.scans.get, { scanId })).toBeNull();
  expect(await t.query(internal.scans.getDisplay, { scanId, deviceId: user.deviceId })).toEqual(confirmed);
  await expect(t.query(internal.scans.getDisplay, { scanId, deviceId: other.deviceId })).rejects.toMatchObject({ data: { code: 'scan_not_found' } });
});

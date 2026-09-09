import { afterEach, expect, it, vi } from 'vitest';

import model from '../shared/model-version.json';
import { placementProposalPayload } from '../shared/placement-proposal';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { sha256 } from './lib/appAttest';
import { authenticatorData, makeSigner, signAssertion } from './lib/appAttest.fixtures';
import { encodeOrbFeatures } from './lib/orb';
import { makeSyntheticPair } from './lib/orb/testFixtures';
import { seedArtworkWithObject, seedMuseum, testVector } from './lib/testFactories';
import { harness, signIn } from './test.helpers';

const APP_ID = 'TEAMID.app.artlog.ios';
afterEach(() => vi.unstubAllEnvs());

async function fixture(attested = true) {
  vi.stubEnv('APP_ATTEST_REQUIRED', 'true');
  vi.stubEnv('APP_ATTEST_APP_ID', APP_ID);
  const t = harness();
  const user = await signIn(t);
  const { deviceId } = await user.as.mutation(api.devices.registerDevice, { platform: 'ios' });
  const signer = await makeSigner();
  if (attested) await user.as.mutation(internal.devices.markAttested, {
    deviceId, keyId: 'test-key', publicKeySpkiBase64: signer.publicKeySpkiBase64, counter: 0,
  });
  const pair = makeSyntheticPair({ count: 120 });
  const { venueId, work } = await t.run(async (ctx) => {
    const owner = await seedMuseum(ctx);
    const venueId = await seedMuseum(ctx);
    const work = await seedArtworkWithObject(ctx, { descriptors: pair.ref,
      placement: { venueId: owner, onView: true, source: 'feed', confidence: 1 } });
    return { venueId, work };
  });
  const capture = {
    localId: 'capture', venueId, vector: testVector(), ...encodeOrbFeatures(pair.query),
    modelVersion: model.modelVersion, capturedAt: Date.now(),
  };
  const scan = await user.as.action(api.identify.identify, capture);
  const sign = async (scanId: Id<'scans'>, counter = 1) => {
    const { nonce } = await user.as.mutation(api.devices.createChallenge, { purpose: 'assert' });
    const assertionBase64 = await signAssertion(signer, authenticatorData(await sha256(APP_ID), counter),
      `${nonce}.${placementProposalPayload(scanId)}`);
    return { scanId, nonce, assertionBase64 };
  };
  return { t, user, deviceId, work, venueId, capture, scan, sign };
}

it('requires an attested device before creating placement evidence', async () => {
  const { t, user, scan, sign } = await fixture(false);
  expect(scan.outcome).toBe('confident');
  await expect(user.as.mutation(api.identify.proposeFromScan, await sign(scan.scanId)))
    .rejects.toMatchObject({ data: { code: 'device_not_attested' } });
  expect(await t.run((ctx) => ctx.db.query('placementProposals').collect())).toEqual([]);
});

it('verifies scan-bound signatures, rejects nonce replays, and deduplicates fresh retries', async () => {
  const { t, user, deviceId, work, venueId, scan, sign } = await fixture();
  const args = await sign(scan.scanId);
  await user.as.mutation(api.identify.proposeFromScan, args);
  expect(await t.run((ctx) => ctx.db.query('placementProposals').collect())).toMatchObject([{
    objectId: work.objectId, proposedVenueId: venueId, deviceIds: [deviceId], scanIds: [scan.scanId], readyForReview: false,
  }]);
  await expect(user.as.mutation(api.identify.proposeFromScan, args))
    .rejects.toMatchObject({ data: { code: 'challenge_invalid' } });
  await user.as.mutation(api.identify.proposeFromScan, await sign(scan.scanId, 2));
  expect((await t.run((ctx) => ctx.db.query('placementProposals').unique()))?.scanIds).toEqual([scan.scanId]);
  expect((await t.run((ctx) => ctx.db.get(deviceId)))?.attestCounter).toBe(2);
});

it('rejects substituting another scan into a signed request', async () => {
  const { t, user, scan, capture, sign } = await fixture();
  const other = await user.as.action(api.identify.identify, { ...capture, localId: 'other' });
  await expect(user.as.mutation(api.identify.proposeFromScan, {
    ...await sign(scan.scanId), scanId: other.scanId,
  })).rejects.toMatchObject({ data: { code: 'invalid_assertion', reason: 'invalid_signature' } });
  expect(await t.run((ctx) => ctx.db.query('placementProposals').collect())).toEqual([]);
});

it('rejects another device’s scan even when the assertion is valid', async () => {
  const { t, user, capture, sign } = await fixture();
  const other = await signIn(t);
  await other.as.mutation(api.devices.registerDevice, { platform: 'ios' });
  const scan = await other.as.action(api.identify.identify, capture);
  await expect(user.as.mutation(api.identify.proposeFromScan, await sign(scan.scanId)))
    .rejects.toMatchObject({ data: { code: 'invalid_scan' } });
  expect(await t.run((ctx) => ctx.db.query('placementProposals').collect())).toEqual([]);
});

it('rejects a soft scan as placement evidence', async () => {
  const { t, user, capture, sign } = await fixture();
  const scan = await user.as.action(api.identify.identify, {
    ...capture, localId: 'soft', descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
  });
  expect(scan.outcome).toBe('soft');
  await expect(user.as.mutation(api.identify.proposeFromScan, await sign(scan.scanId)))
    .rejects.toMatchObject({ data: { code: 'invalid_scan' } });
  expect(await t.run((ctx) => ctx.db.query('placementProposals').collect())).toEqual([]);
});

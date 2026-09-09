import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { stableStringify } from '../shared/stable-stringify';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { authenticatorData, makeSigner, signAssertion } from './lib/appAttest.fixtures';
import { sha256 } from './lib/appAttest';
import { seedDevice, seedMuseum } from './lib/testFactories';
import { harness, type SignedIn } from './test.helpers';

const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('APP_ATTEST_REQUIRED', 'false'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function proof(user: SignedIn, payload: object) {
  const { nonce } = await user.as.mutation(api.devices.createChallenge, { purpose: 'assert' });
  return { nonce, assertionBase64: '', payloadJson: stableStringify(payload) };
}

async function fixture(overrides: Partial<Doc<'museums'>> = {}) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, {
    collectionSiteUrl: 'https://museum.example/collection',
    indexStatus: { status: 'none', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() },
    ...overrides,
  }));
  const bump = async () => user.as.mutation(api.museums.bumpVenue, {
    venueId, ...await proof(user, { action: 'museums.bumpVenue', venueId }),
  });
  return { t, user, venueId, bump };
}

it('returns only the public venue status', async () => {
  const { t, venueId } = await fixture();
  expect(await t.query(api.museums.getStatus, { venueId })).toEqual({
    name: 'Test Museum', region: 'US',
    indexStatus: { status: 'none', pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() },
  });
});

it('queues an unindexed venue using the simulator attestation bypass', async () => {
  const { t, venueId, bump } = await fixture();
  expect(await bump()).toMatchObject({ bumped: true, indexStatus: { status: 'queued' } });
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({ queuePriority: 10, lastBumpedAt: Date.now() });
  const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
  expect(scheduled).toContainEqual(expect.objectContaining({ name: 'crawl:maybeLaunch' }));
});

it('allows queued venues to gain priority again after the venue cooldown', async () => {
  const { t, venueId, bump } = await fixture();
  await bump();
  expect(await bump()).toMatchObject({ bumped: false });
  vi.advanceTimersByTime(DAY + 1);
  expect(await bump()).toMatchObject({ bumped: true });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.queuePriority).toBe(20);
});

it('requeues a completed index only after thirty days', async () => {
  const { t, venueId, bump } = await fixture({
    lastCrawledAt: Date.now() - 30 * DAY,
    indexStatus: { status: 'complete', pagesMapped: 20, worksIndexed: 15, updatedAt: Date.now() },
  });
  expect(await bump()).toMatchObject({ bumped: false });
  vi.advanceTimersByTime(1);
  expect(await bump()).toMatchObject({ bumped: true, indexStatus: { status: 'queued', worksIndexed: 15 } });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.queuePriority).toBe(10);
});

it.each(['building', 'no_index', 'opted_out'] as const)('never bumps a venue in %s', async (status) => {
  const { bump } = await fixture({ indexStatus: { status, pagesMapped: 0, worksIndexed: 0, updatedAt: Date.now() } });
  expect(await bump()).toMatchObject({ bumped: false });
});

it('opt-out prevents both queue bumps and site probes', async () => {
  const { t, bump } = await fixture({ optOut: true, collectionSiteUrl: undefined, website: 'https://museum.example' });
  expect(await bump()).toMatchObject({ bumped: false });
  expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0);
});

it.each([undefined, 'https://museum.example/collection'])('honors registry-only opt-outs when the collection URL is %s', async (collectionSiteUrl) => {
  const { t, venueId, bump } = await fixture({ website: 'https://museum.example', collectionSiteUrl });
  await t.run((ctx) => ctx.db.insert('optOuts', { venueId, requester: 'museum', receivedAt: Date.now() }));
  const fetchMock = vi.fn(async () => new Response('eMuseum'));
  vi.stubGlobal('fetch', fetchMock);
  expect(await bump()).toMatchObject({ bumped: false });
  await t.action(internal.museums.probeCollectionSite, { venueId });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0);
});

it('ignores a successful probe if an opt-out is recorded while it is fetching', async () => {
  const { t, venueId } = await fixture({ website: 'https://museum.example', collectionSiteUrl: undefined });
  vi.stubGlobal('fetch', vi.fn(async () => {
    await t.run((ctx) => ctx.db.insert('optOuts', { venueId, requester: 'museum', receivedAt: Date.now() }));
    return new Response('eMuseum');
  }));
  await t.action(internal.museums.probeCollectionSite, { venueId });
  const venue = await t.run((ctx) => ctx.db.get(venueId));
  expect(venue?.collectionSiteUrl).toBeUndefined();
  expect(venue?.indexStatus.status).toBe('none');
  expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0);
});

it.each([429, 503, 'network'] as const)('retries a probe after a temporary %s failure and the venue cooldown', async (failure) => {
  const { t, venueId, bump } = await fixture({ website: 'https://museum.example', collectionSiteUrl: undefined });
  const fetchMock = vi.fn(async () => {
    if (failure === 'network') throw new TypeError('Network unavailable');
    return new Response('Try later', { status: failure });
  });
  vi.stubGlobal('fetch', fetchMock);
  await bump();
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus.status).toBe('none');
  expect(fetchMock).toHaveBeenCalledTimes(6);
  fetchMock.mockImplementation(async () => new Response('eMuseum'));
  await bump();
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(fetchMock).toHaveBeenCalledTimes(6);
  vi.advanceTimersByTime(DAY + 1);
  await bump();
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus.status).toBe('queued');
  expect(fetchMock).toHaveBeenCalledTimes(7);
});

it('rejects the fourth queue request in a day', async () => {
  const { bump } = await fixture();
  for (let i = 0; i < 3; i++) await bump();
  await expect(bump()).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'queueBump' } });
});

it('requires a device and a fresh challenge even in simulator mode', async () => {
  const { t, user, venueId } = await fixture();
  const args = { venueId, ...await proof(user, { action: 'museums.bumpVenue', venueId }) };
  await expect(t.mutation(api.museums.bumpVenue, args)).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  await user.as.mutation(api.museums.bumpVenue, args);
  await expect(user.as.mutation(api.museums.bumpVenue, args)).rejects.toMatchObject({ data: { code: 'challenge_invalid' } });
});

it('verifies real signatures and binds the signature to the operation and venue', async () => {
  const { t, user, venueId, bump } = await fixture();
  vi.stubEnv('APP_ATTEST_REQUIRED', 'true');
  await expect(bump()).rejects.toMatchObject({ data: { code: 'device_not_attested' } });
  const appId = 'TEAM.app.artlog.ios';
  vi.stubEnv('APP_ATTEST_APP_ID', appId);
  const signer = await makeSigner();
  await t.run((ctx) => ctx.db.patch(user.deviceId, { platform: 'ios', attestPublicKey: signer.publicKeySpkiBase64 }));
  const signed = await proof(user, { action: 'museums.bumpVenue', venueId });
  signed.assertionBase64 = await signAssertion(signer, authenticatorData(await sha256(appId), 1), `${signed.nonce}.${signed.payloadJson}`);
  const another = await t.run((ctx) => seedMuseum(ctx));
  await expect(user.as.mutation(api.museums.bumpVenue, { venueId: another, ...signed })).rejects.toMatchObject({ data: { code: 'invalid_payload' } });
  await expect(user.as.mutation(api.museums.bumpVenue, {
    venueId: another, ...signed, payloadJson: stableStringify({ action: 'museums.bumpVenue', venueId: another }),
  })).rejects.toMatchObject({ data: { code: 'invalid_assertion' } });
  expect(await user.as.mutation(api.museums.bumpVenue, { venueId, ...signed })).toMatchObject({ bumped: true });
});

it('schedules a cooldown-limited probe when a collection URL is unknown', async () => {
  const { t, bump } = await fixture({ collectionSiteUrl: undefined, website: 'https://museum.example' });
  expect(await bump()).toMatchObject({ bumped: false });
  await bump();
  const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].name).toBe('museums:probeCollectionSite');
});

const poi = { name: 'New Museum', website: 'https://new.example', lat: 10, lng: 20 };
async function confirm(user: SignedIn, fields: Omit<typeof poi, 'website'> & { website?: string } = poi) {
  return user.as.mutation(api.museums.confirmPoiVenue, {
    ...fields, ...await proof(user, { action: 'museums.confirmPoiVenue', ...fields }),
  });
}

it('confirms a POI, inherits the nearest seeded region, probes and queues it', async () => {
  const { t, user } = await fixture({ lat: 10.1, lng: 20, region: 'nearby' });
  await t.run((ctx) => seedMuseum(ctx, { lat: 10, lng: 20.5, region: 'farther' }));
  await t.run((ctx) => seedMuseum(ctx, { lat: 10, lng: 20, seedSource: 'poi', region: 'ignore' }));
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<a href="/objects/1">Work</a>'))));
  const { venueId } = await confirm(user);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get(venueId))).toMatchObject({
    key: expect.stringMatching(/^poi:/), seedSource: 'poi', region: 'nearby', failureCount: 0,
    queuePriority: 5, platform: 'emuseum', indexStatus: { status: 'queued' },
  });
  expect((await t.query(internal.ingest.counts, {})).museums).toBe(1);
});

it('deduplicates names within 100 m without replacing the existing website or probing again', async () => {
  const { t, user, venueId } = await fixture({ name: 'New Museum', lat: 10, lng: 20 });
  expect(await confirm(user, { ...poi, name: '  NEW   MUSEUM ', lat: 10.0005 })).toEqual({ venueId });
  expect(await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0);
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.website).toBeUndefined();
});

it('does not deduplicate distant names and uses unknown region beyond 60 km', async () => {
  const { t, user, venueId } = await fixture({ name: poi.name, lat: 11, lng: 20 });
  const result = await confirm(user, { ...poi, website: undefined });
  expect(result.venueId).not.toBe(venueId);
  expect((await t.run((ctx) => ctx.db.get(result.venueId)))?.region).toBe('country:unknown');
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await t.run((ctx) => ctx.db.get(result.venueId)))?.indexStatus.status).toBe('none');
});

it('deduplicates across the date line', async () => {
  const { user, venueId } = await fixture({ name: poi.name, lat: 0, lng: 179.9998 });
  expect(await confirm(user, { ...poi, lat: 0, lng: -179.9998 })).toEqual({ venueId });
});

it('rate limits the sixth POI confirmation and validates coordinates and website', async () => {
  const { user } = await fixture();
  await expect(confirm(user, { ...poi, lat: 91 })).rejects.toThrow();
  await expect(confirm(user, { ...poi, website: 'http://127.0.0.1' })).rejects.toThrow();
  for (let i = 0; i < 5; i++) await confirm(user);
  await expect(confirm(user)).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'venueConfirm' } });
});

it('a probe with no collection marks no_index, but a late result cannot override opt-out', async () => {
  const { t, venueId } = await fixture({ website: 'https://museum.example', collectionSiteUrl: undefined });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('About us'))));
  await t.action(internal.museums.probeCollectionSite, { venueId });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.indexStatus.status).toBe('no_index');
  await t.run((ctx) => ctx.db.patch(venueId, { optOut: true }));
  await t.mutation(internal.museums.applyProbe, {
    venueId, website: 'https://museum.example', result: { collectionSiteUrl: 'https://museum.example/collection', platform: 'generic' },
  });
  expect((await t.run((ctx) => ctx.db.get(venueId)))?.collectionSiteUrl).toBeUndefined();
});

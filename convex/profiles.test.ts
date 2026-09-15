import { expect, it } from 'vitest';
import { api } from './_generated/api';
import { seedDevice } from './lib/testFactories';
import { harness } from './test.helpers';
import { validateLayout, validateMedia, validateReport, validateSelection, validateWallItems, validateProfile, validateGeography } from '../shared/social/contracts';
import { projectArtwork, projectSharedVisitCard, projectWallArtwork } from './lib/projections';
import { requirePublicWallItem, requireSharedVisit } from './lib/publicationAccess';

async function fixture() {
  const t = harness();
  async function account(sub: string) {
    const device = await seedDevice(t);
    await t.run((ctx) => ctx.db.patch(device.deviceId, { appleLinkProof: { sub, expiresAt: Date.now() + 10000 } }));
    const accountId = await device.as.mutation(api.accounts.linkAccount, { appleUserId: sub, nonce: (await device.as.mutation(api.devices.createChallenge, { purpose: 'assert' })).nonce, assertionBase64: '' });
    const { scope } = await device.as.query(api.accounts.me, {});
    while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) { /* bounded claim phases */ }
    return { ...device, accountId, scope };
  }
  return { t, account };
}
it('requires Apple linkage; signing in alone creates no profile or publication', async () => {
  const { t, account } = await fixture();
  const anonymous = await seedDevice(t);
  await expect(anonymous.as.mutation(api.profiles.create, { username: 'reader', name: 'Reader' })).rejects.toMatchObject({ data: { code: 'apple_sign_in_required' } });
  await account('a');
  expect(await t.run((ctx) => ctx.db.query('profiles').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('walls').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('sharedVisits').collect())).toEqual([]);
});
it('has one winner for simultaneous username requests and never replaces an existing profile username', async () => {
  const { account } = await fixture();
  const a = await account('a'), b = await account('b');
  const requests = await Promise.allSettled([a, b].map((user) => user.as.mutation(api.profiles.create, { username: 'same-reader', name: ' Reader ' })));
  expect(requests.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(requests.find((r) => r.status === 'rejected')).toMatchObject({ reason: { data: { code: 'username_taken' } } });
  const winner = requests[0].status === 'fulfilled' ? a : b;
  const again = await winner.as.mutation(api.profiles.create, { username: 'new-name', name: 'Other' });
  expect(again).toMatchObject({ username: 'same-reader', name: 'Reader', publishedWallCount: 0 });
  expect(await winner.as.mutation(api.profiles.update, { name: 'New display', bio: ' Short bio ' })).toMatchObject({ username: 'same-reader', name: 'New display', bio: 'Short bio' });
});
it('normalizes accents, case, and whitespace; paginates bounded public allowlists', async () => {
  const { t, account } = await fixture();
  const a = await account('a');
  const profile = await a.as.mutation(api.profiles.create, { username: 'elodie-art', name: ' Élodie  Martin ', bio: 'Art' });
  const publicResult = await t.query(api.profiles.getPublic, { profileId: profile.profileId });
  expect(Object.keys(publicResult!).sort()).toEqual(['bio', 'name', 'profileId', 'publishedWallCount', 'username']);
  const found = await t.query(api.profiles.search, { query: '  ÉLODiE  ', limit: 1 });
  expect(found.page).toEqual([profile]);
  for (const args of [{ query: 'x' }, { query: 'x'.repeat(101) }, { query: 'elo', limit: 51 }, { query: 'elo', cursor: 'x'.repeat(8193) }]) await expect(t.query(api.profiles.search, args)).rejects.toThrow();
});
it.each(['ab', '-abc', 'abc-', 'ab--cd', 'Abcd', 'élodie', 'a'.repeat(31)])('rejects invalid username %s', async (username) => {
  const { account } = await fixture(); const user = await account('a');
  await expect(user.as.mutation(api.profiles.create, { username, name: 'Reader' })).rejects.toMatchObject({ data: { code: 'invalid_profile' } });
});
it('deletion revokes profile and publication access immediately', async () => {
  const { t, account } = await fixture(); const user = await account('a');
  const profile = await user.as.mutation(api.profiles.create, { username: 'reader', name: 'Reader' });
  const postId = crypto.randomUUID();
  await t.run(async (ctx) => {
    const venueId = await ctx.db.insert('museums', { key: 'v', name: 'Museum', lat: 0, lng: 0, seedSource: 'manual', region: 'US', optOut: false });
    const localId = crypto.randomUUID();
    const visitId = await ctx.db.insert('visits', { owner: { kind: 'account', accountId: user.accountId }, localId, venueId, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC', updatedAt: 1, updatedBy: user.deviceId, changeVersion: 1 });
    await ctx.db.insert('sharedVisits', { postId, profileId: profile.profileId, visitId, visitLocalId: localId, visitedOn: '2026-09-01', status: 'active', reflection: '', publishedAt: 1, updatedAt: 1, publicationRevision: 0 });
  });
  expect(await t.run((ctx) => requireSharedVisit(ctx, postId, profile.profileId))).toMatchObject({ postId });
  await user.as.mutation(api.accounts.deleteAccount, {});
  expect(await t.query(api.profiles.getPublic, { profileId: profile.profileId })).toBeNull();
  expect((await t.query(api.profiles.search, { query: 'reader' })).page).toEqual([]);
  await expect(t.run((ctx) => requireSharedVisit(ctx, postId, profile.profileId))).rejects.toMatchObject({ data: { code: 'not_found' } });
});
it('projects only permitted artwork fields, no artwork notes on shared cards, and a square placeholder', () => {
  const save = { snapshot: { title: 'Work', artist: 'Artist', date: '1900', medium: 'Oil', institution: 'Private context' },
    localId: 'private-save', note: 'Private note', photoStorageId: 'private-storage', scanId: 'private-scan' } as never;
  const artwork = projectArtwork(save);
  expect(artwork).toEqual({ title: 'Work', artist: 'Artist', date: '1900', medium: 'Oil', media: { kind: 'placeholder', width: 1, height: 1 } });
  expect(projectSharedVisitCard({ _id: 'item' } as never, save)).toEqual({ itemId: 'item', artwork });
  expect(projectWallArtwork({ _id: 'wall', noteVisible: false, layout: {} } as never, save)).not.toHaveProperty('note');
  expect(projectWallArtwork({ _id: 'wall', noteVisible: true, layout: {} } as never, save)).toHaveProperty('note', 'Private note');
});
it('invalidates reverse save references, consent and revisions while keeping the visit and empty post', async () => {
  const { t, account } = await fixture(); const user = await account('a');
  const profile = await user.as.mutation(api.profiles.create, { username: 'reader', name: 'Reader' });
  const ids = await t.run(async (ctx) => {
    const venueId = await ctx.db.insert('museums', { key: 'v', name: 'Museum', lat: 0, lng: 0, seedSource: 'manual', region: 'US', optOut: false });
    const visitId = await ctx.db.insert('visits', { owner: { kind: 'account', accountId: user.accountId }, localId: crypto.randomUUID(), venueId, venueName: 'Museum', visitedOn: '2026-09-01', timeZone: 'UTC', updatedAt: 1, updatedBy: user.deviceId, changeVersion: 1 });
    const localId = crypto.randomUUID();
    const saveId = await ctx.db.insert('collections', { owner: { kind: 'account', accountId: user.accountId }, localId, snapshot: { title: 'Work', artist: '' }, savedAt: 1, note: 'Note', updatedAt: 1, updatedBy: user.deviceId, changeVersion: 2 });
    const wallId = await ctx.db.insert('walls', { profileId: profile.profileId, color: '#fff', layoutRevision: 3 });
    const itemId = await ctx.db.insert('wallItems', { wallId, profileId: profile.profileId, saveId, saveLocalId: localId, active: true, noteVisible: true, noteRevision: 2, layout: { x: 0, y: 0, width: 1, layer: 0, frame: 'none' } });
    const post = await ctx.db.insert('sharedVisits', { profileId: profile.profileId, visitId, visitLocalId: 'visit', postId: crypto.randomUUID(), visitedOn: '2026-09-01', status: 'active', reflection: '', publishedAt: 1, updatedAt: 1, publicationRevision: 5 });
    await ctx.db.insert('sharedVisitItems', { publicationId: post, saveId, saveLocalId: localId, position: 0 });
    await ctx.db.patch(profile.profileId, { publishedWallCount: 1 });
    return { localId, visitId, wallId, itemId, post };
  });
  await user.as.mutation(api.collections.remove, { scope: user.scope, localId: ids.localId });
  await expect(t.run((ctx) => requirePublicWallItem(ctx, ids.itemId))).rejects.toMatchObject({ data: { code: 'not_found' } });
  expect(await t.run((ctx) => ctx.db.get(ids.itemId))).toMatchObject({ active: false, noteVisible: false, noteRevision: 3 });
  expect(await t.run((ctx) => ctx.db.get(ids.wallId))).toMatchObject({ layoutRevision: 4 });
  expect(await t.run((ctx) => ctx.db.get(ids.post))).toMatchObject({ publicationRevision: 6, status: 'active' });
  expect(await t.run((ctx) => ctx.db.get(ids.visitId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.query('sharedVisitItems').collect())).toEqual([]);
});
it('validates shared layout, dimensions, and reporting boundaries', () => {
  expect(() => validateLayout({ x: 0, y: 3, width: 0.5, layer: 2, frame: 'oak' })).not.toThrow();
  for (const width of [0, -1, 2, Infinity]) expect(() => validateLayout({ x: 0, y: 0, width, layer: 0, frame: 'none' })).toThrow();
  expect(() => validateMedia({ kind: 'catalog', url: 'https://museum.test/art', sourceUrl: 'https://museum.test', rights: 'public_domain', width: 0, height: 2 })).toThrow();
  expect(() => validateReport({ target: { kind: 'profile', profileId: 'profile' as never }, reason: '', details: '' })).toThrow();
});

it('publishes eligible media with an allowlist and binds derivatives to a public context', () => {
  const save = { _id: 'save', snapshot: { title: 'Work', artist: 'Artist' } } as never;
  const source = { kind: 'catalog', url: 'https://museum.example/image.jpg', sourceUrl: 'https://museum.example/art', rights: 'public_domain', width: 800, height: 600, owner: 'private', storageId: 'private' };
  const asset = { saveId: 'save', storageId: 'private-storage', source };
  expect(projectArtwork(save, asset as never).media).toEqual({ kind: 'catalog', url: source.url, sourceUrl: source.sourceUrl, rights: source.rights, width: 800, height: 600 });
  for (const url of ['https://dev.convex.cloud/api/storage/private', 'https://app.example/collection-photos?localId=private']) {
    expect(projectArtwork(save, { ...asset, source: { ...source, url } } as never).media.kind).toBe('placeholder');
  }
  const derivative = { ...asset, source: { kind: 'derivative', rights: 'contributor_consent', width: 256, height: 192,
    sourceUrl: 'https://private.example/raw' } } as never;
  expect(projectArtwork(save, derivative).media.kind).toBe('placeholder');
  const projected = projectWallArtwork({ _id: 'wall-item', layout: {}, noteVisible: false } as never, save, derivative);
  expect(projected.artwork.media).toMatchObject({ kind: 'derivative', reference: { kind: 'wallItem', itemId: 'wall-item' } });
  expect(JSON.stringify(projected)).not.toContain('private');
  expect(projectArtwork(save, { ...asset, saveId: 'other' } as never).media.kind).toBe('placeholder');
  expect(projectArtwork(save, { ...asset, revokedAt: 1 } as never).media.kind).toBe('placeholder');
});
it('enforces shared selection, profile, and geography boundaries', () => {
  const id = crypto.randomUUID();
  expect(() => validateSelection({ saveLocalIds: [id], reflection: '', revision: 0 })).not.toThrow();
  for (const input of [{ saveLocalIds: [id, id], reflection: '', revision: 0 }, { saveLocalIds: [], reflection: 'x'.repeat(1201), revision: 0 }, { saveLocalIds: ['bad'], reflection: '', revision: 0 }, { saveLocalIds: [], reflection: '', revision: -1 }]) expect(() => validateSelection(input)).toThrow();
  expect(() => validateWallItems([], Infinity)).toThrow();
  for (const input of [{ name: ' ' }, { name: 'x'.repeat(61) }, { name: 'Reader', bio: 'x'.repeat(161) }]) expect(() => validateProfile(input)).toThrow();
  expect(() => validateGeography({})).not.toThrow();
  expect(() => validateGeography({ city: 'Reykjavík', country: 'IS' })).not.toThrow();
  for (const input of [{ city: 'x'.repeat(121) }, { country: 'ZZ' }, { country: 'usa' }]) expect(() => validateGeography(input)).toThrow();
});

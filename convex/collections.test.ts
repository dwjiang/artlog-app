import { afterEach, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { seedArtworkWithObject, seedDevice, seedMuseum, seedScan } from './lib/testFactories';
import { harness } from './test.helpers';

afterEach(() => { vi.restoreAllMocks(); });

const snapshot = { title: 'Water Lilies', artist: 'Claude Monet', date: '1916', medium: 'Oil on canvas', institution: 'Test Museum' };
const suggested = { title: 'Water Lilies', artist: 'Claude Monet' };
const page = { paginationOpts: { numItems: 10, cursor: null } };

async function fixture() {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx));
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const scanId = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, venueId }));
  const visitId = await t.run((ctx) => ctx.db.insert('visits', { deviceId: user.deviceId, venueId, startedAt: Date.now() }));
  const args: {
    localId: string; scanId?: Id<'scans'>; objectId?: Id<'objects'>; artworkId?: Id<'artworks'>; venueId?: Id<'museums'>;
    visitId?: Id<'visits'>; gallery?: string; snapshot: typeof snapshot; suggested: typeof suggested | null;
  } = {
    localId: 'saved-1', scanId, objectId: work.objectId, artworkId: work.artworkId, venueId, visitId, gallery: '4', snapshot, suggested,
  };
  const save = (overrides: Partial<typeof args> = {}, as = user.as) => as.mutation(api.collections.saveToCollection, { ...args, ...overrides });
  const object = () => t.run((ctx) => ctx.db.get(work.objectId));
  const list = (as = user.as) => as.query(api.collections.listMine, page);
  const rows = () => t.run((ctx) => ctx.db.query('collections').collect());
  return { t, user, venueId, work, args, save, object, list, rows };
}

it('saves a snapshot once per local id and confirms an untouched suggestion exactly once', async () => {
  const { user, args, save, object, list, rows } = await fixture();
  const { collectionId } = await save({ snapshot: { ...snapshot, title: ' Water Lilies ' } });
  expect(await save()).toEqual({ collectionId });
  const saved = await rows();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    _id: collectionId, deviceId: user.deviceId, localId: 'saved-1', scanId: args.scanId, objectId: args.objectId,
    artworkId: args.artworkId, venueId: args.venueId, visitId: args.visitId, gallery: '4',
    snapshot: { ...snapshot, title: ' Water Lilies ' }, savedAt: expect.any(Number),
  });
  expect(saved[0]).not.toHaveProperty('suggested');
  expect(await object()).toMatchObject({ confirmCount: 1 });
  expect((await list()).page).toMatchObject([{ _id: collectionId }]);
});

it.each([
  ['an edited title', { snapshot: { ...snapshot, title: 'Water Lilies (Nymphéas)' } }],
  ['an edited artist', { snapshot: { ...snapshot, artist: 'Monet' } }],
  ['a save without a suggestion', { suggested: null }],
  ['a suggestion that is not the object’s artwork', { suggested: { title: 'Haystacks', artist: 'Claude Monet' }, snapshot: { ...snapshot, title: 'Haystacks' } }],
  ['a save without an object', { objectId: undefined }],
])('does not count %s as a confirm', async (_name, overrides) => {
  const { save, object, rows } = await fixture();
  await save(overrides);
  expect(await rows()).toHaveLength(1);
  expect(await object()).toMatchObject({ confirmCount: 0 });
});

it('lists the caller’s saved works newest first and hides removed ones', async () => {
  const now = vi.spyOn(Date, 'now');
  const { t, user, save, list } = await fixture();
  now.mockReturnValue(1_800_000_000_000);
  await save({ localId: 'first' });
  now.mockReturnValue(1_800_000_001_000);
  await save({ localId: 'second' });
  expect((await list()).page.map((row) => row.localId)).toEqual(['second', 'first']);
  const other = await seedDevice(t);
  expect((await list(other.as)).page).toEqual([]);
  await user.as.mutation(api.collections.remove, { localId: 'first' });
  await user.as.mutation(api.collections.remove, { localId: 'first' });
  expect((await list()).page.map((row) => row.localId)).toEqual(['second']);
  const removed = await t.run((ctx) => ctx.db.query('collections')
    .withIndex('by_device_localId', (q) => q.eq('deviceId', user.deviceId).eq('localId', 'first')).unique());
  expect(removed).toMatchObject({ deletedAt: 1_800_000_001_000 });
  await expect(other.as.mutation(api.collections.remove, { localId: 'second' })).rejects.toMatchObject({ data: { code: 'not_found' } });
  await expect(t.query(api.collections.listMine, page)).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
});

it('refuses another device’s scan or visit, a missing object and a blank title or id', async () => {
  const { t, venueId, save, rows } = await fixture();
  const other = await seedDevice(t);
  const foreignScan = await t.run((ctx) => seedScan(ctx, { deviceId: other.deviceId }));
  await expect(save({ scanId: foreignScan })).rejects.toMatchObject({ data: { code: 'invalid_scan' } });
  const foreignVisit = await t.run((ctx) => ctx.db.insert('visits', { deviceId: other.deviceId, venueId, startedAt: 0 }));
  await expect(save({ visitId: foreignVisit })).rejects.toMatchObject({ data: { code: 'invalid_visit' } });
  const missing = await t.run(async (ctx) => {
    const work = await seedArtworkWithObject(ctx);
    await ctx.db.delete(work.objectId);
    return work.objectId;
  });
  await expect(save({ objectId: missing })).rejects.toMatchObject({ data: { code: 'invalid_object' } });
  await expect(save({ snapshot: { ...snapshot, title: '  ' } })).rejects.toMatchObject({ data: { code: 'invalid_save' } });
  await expect(save({ localId: ' ' })).rejects.toMatchObject({ data: { code: 'invalid_save' } });
  expect(await rows()).toEqual([]);
});

it('rate-limits a burst of saves', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  const { save } = await fixture();
  for (let i = 0; i < 10; i++) await save({ localId: `burst-${i}` });
  await expect(save({ localId: 'burst-10' })).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'sync' } });
});

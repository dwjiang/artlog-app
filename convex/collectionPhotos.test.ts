import { afterEach, expect, it, vi } from 'vitest';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';

import { api } from './_generated/api';
import { seedDevice } from './lib/testFactories';
import { harness } from './test.helpers';

const work = { localId: 'saved-photo', snapshot: { title: 'Water Lilies', artist: 'Monet' }, savedAt: 1 };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
const path = '/collection-photo?localId=saved-photo&kind=photo';
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const t = harness();
  const owner = await seedDevice(t), sibling = await seedDevice(t), outsider = await seedDevice(t);
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert('accounts', {
      appleUserId: 'photo-owner', deviceIds: [owner.deviceId, sibling.deviceId], createdAt: Date.now(),
    });
    await ctx.db.patch(owner.deviceId, { accountId });
    await ctx.db.patch(sibling.deviceId, { accountId });
  });
  await owner.as.mutation(api.collections.saveToCollection, { ...work, suggested: null });
  const upload = (device = owner, url = path) => device.as.fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg,
  });
  async function sync(device = sibling, since = 0) {
    const { scope } = await device.as.query(api.accounts.me, {});
    const pulled: FunctionReturnType<typeof api.sync.syncCollection>['pulled'] = [];
    let cursor: FunctionArgs<typeof api.sync.syncCollection>['cursor'];
    let calls = 0, serverTime = 0;
    do {
      const result = await device.as.mutation(api.sync.syncCollection, { push: [], since, scope, cursor });
      calls++; pulled.push(...result.pulled); serverTime = result.serverTime;
      cursor = result.cursor ?? undefined;
    } while (cursor);
    return { calls, pulled, serverTime };
  }
  return { t, owner, sibling, outsider, upload, sync };
}

it('stores a private photo reference and serves the image only to an authorized collection owner', async () => {
  const { t, owner, outsider, upload } = await fixture();
  const response = await upload();
  expect(response.status).toBe(200);
  const { storageId } = await response.json();
  const rows = await t.run((ctx) => ctx.db.query('collections').collect());
  expect(rows[0].photoStorageId).toBe(storageId);
  const image = await owner.as.fetch(path);
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
  expect(image.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await outsider.as.fetch(path)).status).toBe(404);
  expect((await t.fetch(path)).status).toBe(401);
});

it('does not grant access by guessing the save UUID or attaching someone else’s storage ID', async () => {
  const { owner, outsider, upload } = await fixture();
  const { storageId } = await (await upload()).json();
  expect((await upload(outsider)).status).toBe(404);
  await outsider.as.mutation(api.collections.saveToCollection, { ...work, suggested: null });
  expect((await outsider.as.fetch(path)).status).toBe(404);
  const { scope } = await outsider.as.query(api.accounts.me, {});
  await expect(outsider.as.mutation(api.sync.syncCollection, {
    scope, since: 0, push: [{ ...work, photoStorageId: storageId } as typeof work],
  })).rejects.toThrow();
  expect((await owner.as.fetch(path)).status).toBe(200);
});

it('makes uploads idempotent, including concurrent requests', async () => {
  const { t, upload } = await fixture();
  const responses = await Promise.all([upload(), upload()]);
  const ids = await Promise.all(responses.map((r) => r.json()));
  expect(ids[0]).toEqual(ids[1]);
  expect(await (await upload()).json()).toEqual(ids[0]);
  expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toHaveLength(1);
});

it('rejects unauthenticated, invalid and oversized uploads without storing files', async () => {
  const { t, owner } = await fixture();
  expect((await t.fetch(path, { method: 'POST', body: jpeg })).status).toBe(401);
  for (const body of [new Uint8Array(), new TextEncoder().encode('<svg/>')]) {
    expect((await owner.as.fetch(path, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body })).status).toBe(400);
  }
  expect((await owner.as.fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '20000000' }, body: jpeg,
  })).status).toBe(413);
  expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

it('syncs both image references to a sibling and keeps access after the originating device disconnects', async () => {
  const { owner, sibling, upload, sync } = await fixture();
  await upload();
  await upload(owner, path.replace('kind=photo', 'kind=crop'));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
  await sync();
  expect((await sibling.as.fetch(path)).status).toBe(200);
  expect((await sibling.as.fetch(path.replace('kind=photo', 'kind=crop'))).status).toBe(200);
  await owner.as.mutation(api.accounts.unlink, {});
  expect((await sibling.as.fetch(path)).status).toBe(200);
});

it('pulls a photo that arrived after the last sync in one extra round trip, and none when nothing arrived', async () => {
  const { owner, sibling, upload, sync } = await fixture();
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
  const first = await sync(sibling);
  expect(first.calls).toBe(2);
  vi.mocked(Date.now).mockReturnValue(now + 2000);
  await upload();
  vi.mocked(Date.now).mockReturnValue(now + 3000);
  const second = await sync(sibling, first.serverTime);
  expect(second.calls).toBe(3);
  expect(second.pulled.map((row) => row.photoStorageId)).toEqual([expect.any(String)]);
  expect((await sibling.as.fetch(path)).status).toBe(200);
  vi.mocked(Date.now).mockReturnValue(now + 4000);
  expect(await sync(sibling, second.serverTime)).toMatchObject({ calls: 2, pulled: [] });
});

it('imports a late photo even if the sibling has a newer note', async () => {
  const { owner, sibling, upload, sync } = await fixture();
  await upload();
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
  const { scope } = await sibling.as.query(api.accounts.me, {});
  await sibling.as.mutation(api.sync.syncCollection, { push: [{ ...work, note: 'My newer note' }], scope, since: 0 });
  await sync();
  expect((await sibling.as.fetch(path)).status).toBe(200);
  expect((await owner.as.fetch(path)).status).toBe(200);
});

it('removes stored bytes after deletion reaches all copies and refuses upload to a deleted save', async () => {
  const { t, owner, sibling, upload, sync } = await fixture();
  await upload();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
  await sync();
  await owner.as.mutation(api.collections.remove, { localId: work.localId });
  expect((await owner.as.fetch(path)).status).toBe(404);
  expect((await upload()).status).toBe(404);
  expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toHaveLength(1);
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1000);
  await sync();
  expect((await sibling.as.fetch(path)).status).toBe(404);
  expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

it('does not make an older note win a conflict when its device uploads a photo later', async () => {
  const { t, owner, sibling, upload, sync } = await fixture();
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
  const { scope } = await sibling.as.query(api.accounts.me, {});
  await sibling.as.mutation(api.sync.syncCollection, { push: [{ ...work, note: 'The newest note' }], scope, since: 0 });
  vi.mocked(Date.now).mockReturnValue(now + 2000);
  await upload();
  vi.mocked(Date.now).mockReturnValue(now + 3000);
  await sync(owner); await sync(sibling);
  const rows = await t.run((ctx) => ctx.db.query('collections').collect());
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toMatchObject({ note: 'The newest note', updatedAt: now + 1000 });
    expect(row.photoStorageId).toBeDefined();
  }
});

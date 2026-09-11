import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import { seedDevice } from './lib/testFactories';
import { harness } from './test.helpers';
import { db } from '../src/db/client';
import { notes, savedWorks } from '../src/db/schema';
import * as repo from '../src/db/repos/saved-works';
import { getNote, setNote } from '../src/db/repos/notes';
import { syncCollection } from '../src/lib/account/sync';

vi.mock('../src/db/client', async () => {
  const { createTestDatabase } = await import('../src/db/test-db');
  return { db: createTestDatabase() };
});

const snapshot = { title: 'Water Lilies', artist: 'Monet' };
const work = { localId: 'local-1', snapshot, savedAt: 10 };
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  await db.delete(notes);
  await db.delete(savedWorks);
});
afterEach(() => vi.restoreAllMocks());

async function fixture(linked = true) {
  const t = harness(); const a = await seedDevice(t), b = await seedDevice(t), outsider = await seedDevice(t);
  if (linked) await t.run(async (ctx) => {
    const accountId = await ctx.db.insert('accounts', { appleUserId: 'apple', deviceIds: [a.deviceId, b.deviceId], createdAt: Date.now() });
    await ctx.db.patch(a.deviceId, { accountId }); await ctx.db.patch(b.deviceId, { accountId });
  });
  async function sync(device = a, overrides: Partial<FunctionArgs<typeof api.sync.syncCollection>> = {}) {
    const { scope } = await device.as.query(api.accounts.me, {});
    return device.as.mutation(api.sync.syncCollection, { push: [], since: 0, scope, ...overrides });
  }
  async function pull(device = b, since = 0) {
    const rows: FunctionReturnType<typeof api.sync.syncCollection>['pulled'] = [];
    let cursor: FunctionArgs<typeof api.sync.syncCollection>['cursor'];
    do {
      const result = await sync(device, { since, cursor });
      rows.push(...result.pulled); cursor = result.cursor ?? undefined;
    } while (cursor);
    return rows;
  }
  return { t, a, b, outsider, sync, pull };
}

it('pushes idempotently, preserves snapshots and never stores photos', async () => {
  const { t, a, sync } = await fixture();
  await sync(a, { push: [work] });
  await sync(a, { push: [{ ...work, snapshot: { title: 'Changed', artist: 'Other' }, savedAt: 20, note: 'A note' }] });
  const rows = await t.run((ctx) => ctx.db.query('collections').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ localId: work.localId, snapshot, savedAt: 10, note: 'A note' });
  expect(rows[0]).not.toHaveProperty('photoPath');
});

it('pulls sibling rows only when linked, and never returns the caller’s unchanged saves', async () => {
  const { a, b, outsider, sync, pull } = await fixture();
  await sync(a, { push: [work] }); await sync(b, { push: [{ ...work, localId: 'b-save' }] });
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  expect((await pull()).map((row) => row.localId)).toEqual(['local-1']);
  expect(await pull(outsider)).toEqual([]);
  await b.as.mutation(api.accounts.unlink, {});
  expect(await pull()).toEqual([]);
});

it('does not let another account read or edit a save by guessing its UUID', async () => {
  const { t, a, outsider, sync, pull } = await fixture();
  await sync(a, { push: [{ ...work, note: 'Private note' }] });
  await sync(outsider, { push: [{ ...work, note: 'Forged edit' }] });
  const original = await t.run((ctx) => ctx.db.query('collections')
    .withIndex('by_device_localId', (q) => q.eq('deviceId', a.deviceId).eq('localId', work.localId)).unique());
  expect(original?.note).toBe('Private note');
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  expect(await pull(outsider)).toEqual([]);
});

it('syncs an imported edit back to its originating phone without changing the save UUID', async () => {
  const { a, b, sync, pull } = await fixture();
  await sync(a, { push: [work] });
  await sync(b, { push: [{ ...work, note: 'Seen together', deletedAt: 20 }] });
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  expect(await pull(a)).toMatchObject([{ localId: work.localId, note: 'Seen together', deletedAt: 20, snapshot }]);
  expect((await sync(b, { push: [{ ...work, note: 'Stale' }] })).accepted).toMatchObject([{ deletedAt: 20 }]);
});

it('pages beyond 500 without advancing past omitted rows', async () => {
  const { t, a, b, sync, pull } = await fixture();
  await t.run(async (ctx) => {
    for (let i = 0; i < 501; i++) await ctx.db.insert('collections', {
      ...work, localId: `saved-${i}`, deviceId: a.deviceId, updatedAt: Date.now() - 1, updatedBy: a.deviceId,
    });
  });
  const rows = await pull(b);
  expect(rows).toHaveLength(501);
  expect(new Set(rows.map((row) => row._id)).size).toBe(501);
  expect((await sync(a)).pulled).toEqual([]);
});

it('includes writes in the previous checkpoint’s millisecond on the next round', async () => {
  const { a, b, sync, pull } = await fixture();
  const checkpoint = (await sync(b)).serverTime;
  await sync(a, { push: [work] });
  vi.mocked(Date.now).mockReturnValue(checkpoint + 1);
  expect(await pull(b, checkpoint)).toHaveLength(1);
});

it('refuses stale membership scopes before writes or paginated reads', async () => {
  const { a, b, sync } = await fixture();
  const { scope } = await a.as.query(api.accounts.me, {});
  await b.as.mutation(api.accounts.unlink, {});
  await expect(sync(a, { scope, push: [work] })).rejects.toThrow('sync_scope_changed');
});

it('rejects unauthenticated calls, oversized batches and invalid timestamps', async () => {
  const { t, a, sync } = await fixture();
  await expect(t.mutation(api.sync.syncCollection, { push: [], since: 0, scope: '' })).rejects.toThrow('unauthenticated');
  await expect(sync(a, { push: Array(501).fill(work) })).rejects.toThrow('invalid_sync');
  await expect(sync(a, { since: -1 })).rejects.toThrow('invalid_sync');
});

function phone(device: Awaited<ReturnType<typeof seedDevice>>) {
  let checkpoint: string | undefined;
  return async () => {
    vi.mocked(Date.now).mockReturnValue(Date.now() + 100_000);
    const account = await device.as.query(api.accounts.me, {});
    await syncCollection({
      ...repo,
      getCheckpoint: async () => checkpoint,
      setCheckpoint: async (value) => { checkpoint = value; },
      sync: (args) => device.as.mutation(api.sync.syncCollection, args),
    }, { ...account, deviceId: device.deviceId });
  };
}

it.each(['note', 'delete'] as const)('syncs cached %s changes and new saves after the originating device signs out', async (change) => {
  const { t, a, b, sync } = await fixture();
  await sync(a, { push: [work] });
  const syncB = phone(b);
  await syncB();
  expect(await repo.listSavedWorks()).toHaveLength(1);
  await a.as.mutation(api.accounts.unlink, {});
  if (change === 'note') await setNote(work.localId, 'Kept on this phone');
  else await repo.softDeleteSavedWork(work.localId, Date.now());
  await repo.insertSavedWork({ localId: 'new-work', title: 'New painting', artist: 'Artist', savedAt: 20 });
  await syncB();
  await syncB();
  expect(await repo.listUnsynced()).toEqual([]);
  const rows = await t.run((ctx) => ctx.db.query('collections')
    .withIndex('by_device_savedAt', (q) => q.eq('deviceId', b.deviceId)).collect());
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.localId === work.localId)).toMatchObject(change === 'note'
    ? { note: 'Kept on this phone' } : { deletedAt: expect.any(Number) });
});

it('merges a returning device’s copies without duplicating saves or losing photos', async () => {
  const { t, a, b, sync } = await fixture();
  const originalAccount = (await a.as.query(api.accounts.me, {})).accountId!;
  await sync(a, { push: [work] });
  const syncB = phone(b);
  await syncB();
  await b.as.mutation(api.accounts.unlink, {});
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert('accounts', { appleUserId: 'another', deviceIds: [b.deviceId], createdAt: Date.now() });
    await ctx.db.patch(b.deviceId, { accountId });
  });
  await syncB();
  await setNote(work.localId, 'A note on the other account');
  await syncB();
  await b.as.mutation(api.accounts.unlink, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(b.deviceId, { accountId: originalAccount });
    await ctx.db.patch(originalAccount, { deviceIds: [a.deviceId, b.deviceId] });
  });
  await syncB();
  expect(await repo.listSavedWorks()).toHaveLength(1);
  expect(await getNote(work.localId)).toMatchObject({ text: 'A note on the other account' });

  // Switch the local test database to A's original installation and pull B's returning copy.
  await db.delete(notes);
  await db.delete(savedWorks);
  await repo.insertSavedWork({ localId: work.localId, ...snapshot, savedAt: work.savedAt, photoPath: 'original.jpg', syncedAt: 1 });
  await phone(a)();
  expect(await repo.listSavedWorks()).toMatchObject([{ localId: work.localId, photoPath: 'original.jpg' }]);
  expect(await getNote(work.localId)).toMatchObject({ text: 'A note on the other account' });
});

it('preserves a pulled deletion against a concurrent local edit and uploads the tombstone', async () => {
  const { t, a, b, sync } = await fixture();
  await sync(a, { push: [work] });
  const syncB = phone(b);
  await syncB();
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  await sync(a, { push: [{ ...work, deletedAt: Date.now() }] });
  await setNote(work.localId, 'Written offline');
  await syncB();
  expect(await repo.listSavedWorks()).toEqual([]);
  expect(await repo.listUnsynced()).toEqual([]);
  const copy = await t.run((ctx) => ctx.db.query('collections')
    .withIndex('by_device_localId', (q) => q.eq('deviceId', b.deviceId).eq('localId', work.localId)).unique());
  expect(copy?.deletedAt).toEqual(expect.any(Number));
});

it.each(['save', 'note', 'delete'] as const)('retains an imported %s for a new phone after the source signs out', async (change) => {
  const { t, a, b, outsider: c, sync } = await fixture();
  const accountId = (await b.as.query(api.accounts.me, {})).accountId!;
  const original = await sync(a, { push: [work] });
  const syncB = phone(b);
  await syncB();
  if (change !== 'save') {
    vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
    await sync(a, { push: [{ ...work, ...(change === 'note' ? { note: 'Latest note' } : { deletedAt: Date.now() }) }] });
    await syncB();
  }
  await a.as.mutation(api.accounts.unlink, {});
  await syncB();
  await t.run(async (ctx) => {
    await ctx.db.patch(accountId, { deviceIds: [b.deviceId, c.deviceId] });
    await ctx.db.patch(c.deviceId, { accountId });
  });
  await db.delete(notes);
  await db.delete(savedWorks);
  await phone(c)();
  expect(await repo.getSavedWork(work.localId)).toMatchObject({
    title: snapshot.title, photoPath: null, cropPath: null,
    deletedAt: change === 'delete' ? expect.any(Number) : null,
    ...(change === 'save' ? { syncedAt: original.accepted[0].updatedAt, syncedBy: a.deviceId } : {}),
  });
  expect(await getNote(work.localId)).toMatchObject({ text: change === 'note' ? 'Latest note' : '' });
});

it('keeps a newer note when a remaining phone imports an older copy', async () => {
  const { t, a, b, outsider: c, sync, pull } = await fixture();
  const accountId = (await b.as.query(api.accounts.me, {})).accountId!;
  await sync(a, { push: [{ ...work, note: 'Old note' }] });
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  const newest = await sync(b, { push: [{ ...work, note: 'New note' }] });
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  await pull(b);
  await a.as.mutation(api.accounts.unlink, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(accountId, { deviceIds: [b.deviceId, c.deviceId] });
    await ctx.db.patch(c.deviceId, { accountId });
  });
  expect(await pull(c)).toMatchObject([{ note: 'New note', updatedAt: newest.accepted[0].updatedAt, updatedBy: b.deviceId }]);
});

it('recovers an import after its response is lost and its source signs out', async () => {
  const { a, b, sync, pull } = await fixture();
  await sync(a, { push: [work] });
  vi.mocked(Date.now).mockReturnValue(Date.now() + 1);
  await pull(b);
  await a.as.mutation(api.accounts.unlink, {});
  await phone(b)();
  expect(await repo.listSavedWorks()).toMatchObject([{ localId: work.localId, title: snapshot.title }]);
});

it('retains a deletion even when the surviving copy has the caller’s newer note version', async () => {
  const { t, a, b, outsider: c, pull } = await fixture();
  const accountId = (await a.as.query(api.accounts.me, {})).accountId!;
  await t.run(async (ctx) => {
    await ctx.db.patch(accountId, { deviceIds: [a.deviceId, b.deviceId, c.deviceId] });
    await ctx.db.patch(c.deviceId, { accountId });
    for (const deviceId of [a.deviceId, b.deviceId]) {
      await ctx.db.insert('collections', { ...work, deviceId, updatedAt: Date.now() - 1, updatedBy: a.deviceId, note: 'Newer note' });
    }
    await ctx.db.insert('collections', { ...work, deviceId: c.deviceId, updatedAt: Date.now() - 2, updatedBy: c.deviceId, deletedAt: 20 });
  });
  await pull(b);
  await c.as.mutation(api.accounts.unlink, {});
  expect(await pull(a)).toMatchObject([{ localId: work.localId, deletedAt: 20, note: 'Newer note', updatedBy: a.deviceId }]);
});

it('rejects an oversized local note before it can block other uploads and pulls', async () => {
  const { a, b, sync } = await fixture();
  await sync(b, { push: [work] });
  await repo.insertSavedWork({ localId: 'local', title: 'Local', artist: 'Artist', savedAt: 20 });
  const text = 'a'.repeat(20_000);
  await setNote('local', text);
  await expect(setNote('local', `${text}a`)).rejects.toThrow();
  await repo.insertSavedWork({ localId: 'other', title: 'Other', artist: 'Artist', savedAt: 30 });
  await phone(a)();
  expect(await repo.listUnsynced()).toEqual([]);
  expect(await repo.listSavedWorks()).toHaveLength(3);
  expect(await getNote('local')).toMatchObject({ text });
});

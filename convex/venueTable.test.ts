import { describe, expect, it } from 'vitest';

import { api, internal } from './_generated/api';
import { harness } from './test.helpers';
import { publish, requestUpload } from './venueTable';

describe('venue table publication', () => {
  it('has no refresh before the first publication and keeps writes internal', async () => {
    const t = harness();
    expect(await t.query(api.venueTable.latest)).toBeNull();
    expect(requestUpload.isInternal).toBe(true);
    expect(publish.isInternal).toBe(true);
    expect(await t.mutation(internal.venueTable.requestUpload)).toEqual(expect.any(String));
  });

  it('returns the greatest version even if an older table is published later', async () => {
    const t = harness();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['SQLite fixture'])));
    await t.mutation(internal.venueTable.publish, { storageId, rowCount: 42, version: 200 });
    await t.mutation(internal.venueTable.publish, { storageId, rowCount: 30, version: 100 });
    const url = await t.run((ctx) => ctx.storage.getUrl(storageId));
    expect(await t.query(api.venueTable.latest)).toEqual({ version: 200, rowCount: 42, url });
  });

  it('retries a publication idempotently and rejects conflicting reuse of a version', async () => {
    const t = harness();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['SQLite fixture'])));
    const args = { storageId, rowCount: 42, version: 200 };
    const id = await t.mutation(internal.venueTable.publish, args);
    expect(await t.mutation(internal.venueTable.publish, args)).toBe(id);
    await expect(t.mutation(internal.venueTable.publish, { ...args, rowCount: 43 })).rejects.toThrow(
      'already describes another asset'
    );
    expect(await t.run((ctx) => ctx.db.query('venueTables').take(2))).toHaveLength(1);
  });

  it.each([
    { rowCount: 0, version: 1 },
    { rowCount: 150_001, version: 1 },
    { rowCount: 1.5, version: 1 },
    { rowCount: 1, version: 0 },
    { rowCount: 1, version: 1.5 },
  ])('rejects invalid metadata %j', async (metadata) => {
    const t = harness();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['SQLite fixture'])));
    await expect(t.mutation(internal.venueTable.publish, { storageId, ...metadata })).rejects.toThrow();
    expect(await t.query(api.venueTable.latest)).toBeNull();
  });

  it('rejects a missing upload and returns no broken download URL after deletion', async () => {
    const t = harness();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['SQLite fixture'])));
    await t.mutation(internal.venueTable.publish, { storageId, rowCount: 42, version: 1 });
    await t.run((ctx) => ctx.storage.delete(storageId));
    expect(await t.query(api.venueTable.latest)).toBeNull();
    await expect(t.mutation(internal.venueTable.publish, { storageId, rowCount: 42, version: 2 }))
      .rejects.toThrow('upload is missing');
  });
});

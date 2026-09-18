import { expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { harness } from './test.helpers';
import { wallFixture } from './lib/wallFixtures';
import { upsertJournalSave } from './lib/journal';
import { seedDevice } from './lib/testFactories';
import { clearEmptyNoteVisibility } from './lib/publicationAccess';

it('creates exactly one wall on first write, normalizes color and acknowledges unchanged retries', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  expect(await a.as.query(api.walls.getMine, {})).toMatchObject({ revision: 0, color: '#FBFBF6', items: [] });
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({ color: '#FBFBF6', items: [] });
  expect(await t.run((ctx) => ctx.db.query('walls').collect())).toHaveLength(0);
  const results = await Promise.all([1, 2].map(() => a.as.mutation(api.walls.setLayout, { ...a.input, color: '#abcdef' })));
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ revision: 1, color: '#ABCDEF', items: [{ placementId: a.input.items[0].placementId, saveLocalId: a.saveLocalId, noteVisible: false, noteRevision: 0 }] });
  expect(await t.run((ctx) => ctx.db.query('walls').collect())).toHaveLength(1);
  expect(await t.query(api.profiles.getPublic, { profileId: a.profile.profileId })).toMatchObject({ publishedWallCount: 1 });
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, color: '#123456' })).rejects.toMatchObject({ data: { code: 'conflict' } });
});

it('preserves an existing wall color, frame, photo choice and geometry on reads', async () => {
  const t = harness(), a = await wallFixture(t, 'custom');
  const customized = await a.as.mutation(api.walls.setLayout, { ...a.input, color: '#45524B',
    items: [{ ...a.selection, layout: { ...a.layout, frame: 'walnut' } }] });
  expect(await a.as.query(api.walls.getMine, {})).toEqual(customized);
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({ color: '#45524B',
    items: [{ layout: { ...a.layout, frame: 'walnut' } }] });
});

it('requires a linked profile, completed claim and current owner scope', async () => {
  const t = harness(), a = await wallFixture(t, 'a'), b = await wallFixture(t, 'b'), anonymous = await seedDevice(t);
  await expect(anonymous.as.mutation(api.walls.setLayout, { ...a.input, scope: anonymous.scope })).rejects.toMatchObject({ data: { code: 'apple_sign_in_required' } });
  await expect(b.as.mutation(api.walls.setLayout, a.input)).rejects.toMatchObject({ data: { code: 'sync_scope_changed' } });
  await expect(b.as.mutation(api.walls.setLayout, { ...a.input, scope: b.scope })).rejects.toMatchObject({ data: { code: 'not_found' } });
  await t.run(async (ctx) => {
    const claim = await ctx.db.query('journalClaims').withIndex('by_deviceId', (q) => q.eq('deviceId', a.deviceId)).unique();
    await ctx.db.patch(claim!._id, { phase: 'saves' });
  });
  await expect(a.as.mutation(api.walls.setLayout, a.input)).rejects.toMatchObject({ data: { code: 'claim_required' } });
});

it('shares wall state across devices on the same account', async () => {
  const t = harness(), a = await wallFixture(t, 'a'), other = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch(other.deviceId, { accountId: a.accountId }));
  const mine = await a.as.mutation(api.walls.setLayout, a.input);
  expect(await other.as.query(api.walls.getMine, {})).toMatchObject({ items: mine.items, revision: mine.revision });
});

it.each([
  { color: '#fff' }, { color: '45524B' }, { color: '#gggggg' }, { revision: -1 },
  { layout: { width: 0 } }, { layout: { x: -0.1 } }, { layout: { x: 0.6, width: 0.5 } },
  { layout: { y: 100.01 } }, { layout: { layer: 100 } }, { layout: { layer: 0.5 } }, { layout: { frame: 'fake' } },
])('rejects invalid wall input %j', async (invalid) => {
  const t = harness(), a = await wallFixture(t, 'a');
  const { layout, ...fields } = invalid;
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, ...fields,
    items: [{ ...a.selection, layout: { ...a.layout, ...layout } }] } as never)).rejects.toThrow();
});

it('enforces unique selections and layers, item limits, frame IDs and geometry boundaries', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, items: [a.selection, a.selection] })).rejects.toThrow();
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, items: [a.selection, { ...a.selection, saveLocalId: crypto.randomUUID() }] })).rejects.toThrow();
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, items: Array(101).fill(a.selection) })).rejects.toThrow();
  let revision = 0;
  for (const frame of ['gilt', 'baroque', 'walnut', 'oak', 'black', 'white', 'mat', 'none'] as const) {
    const result = await a.as.mutation(api.walls.setLayout, { ...a.input, revision,
      items: [{ ...a.selection, layout: { x: 0, y: 100, width: 1, layer: 99, frame } }] });
    revision = result.revision;
  }
});

it('keeps note consent independent of layout, preserves identity on re-add and resets consent', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const original = await a.as.mutation(api.walls.setLayout, a.input), itemId = original.items[0].itemId;
  const visible = await a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [{ itemId, noteRevision: 0, visible: true }] });
  expect(visible).toMatchObject({ revision: 1, items: [{ noteVisible: true, noteRevision: 1 }] });
  const moved = await a.as.mutation(api.walls.setLayout, { ...a.input, revision: 1, color: '#123456' });
  expect(moved.items[0]).toMatchObject({ noteVisible: true, noteRevision: 1 });
  await a.as.mutation(api.walls.setLayout, { ...a.input, revision: 2, items: [] });
  expect(await t.query(api.walls.getArtwork, { itemId })).toBeNull();
  const readded = await a.as.mutation(api.walls.setLayout, { ...a.input, revision: 3 });
  expect(readded.items[0]).toMatchObject({ itemId, noteVisible: false, noteRevision: 2 });
  await expect(a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [{ itemId, noteRevision: 1, visible: true }] })).rejects.toMatchObject({ data: { code: 'conflict' } });
});

it('shows full current notes and never restores consent after emptying and later editing a note', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const { items: [item] } = await a.as.mutation(api.walls.setLayout, a.input);
  await a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [{ itemId: item.itemId, noteRevision: 0, visible: true }] });
  async function note(value: string) {
    await t.run(async (ctx) => {
      const save = (await ctx.db.get(a.saveId))!;
      await upsertJournalSave(ctx, save.owner, a.deviceId, { localId: save.localId, savedAt: save.savedAt, snapshot: save.snapshot, note: value });
    });
  }
  await note('Long current note '.repeat(100));
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toMatchObject({ note: 'Long current note '.repeat(100) });
  await note(' ');
  await expect(a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [{ itemId: item.itemId, noteRevision: 2, visible: true }] })).rejects.toThrow();
  await note('New private note');
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).not.toHaveProperty('note');
  expect((await a.as.query(api.walls.getMine, {})).items[0]).toMatchObject({ noteVisible: false, noteRevision: 2 });
});

it('makes visibility batches atomic and refuses another owner’s item', async () => {
  const t = harness(), a = await wallFixture(t, 'a'), b = await wallFixture(t, 'b');
  const { items: [first] } = await a.as.mutation(api.walls.setLayout, a.input);
  const { items: [second] } = await b.as.mutation(api.walls.setLayout, b.input);
  await expect(a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [first, second].map((item) =>
    ({ itemId: item.itemId, noteRevision: 0, visible: true })) })).rejects.toMatchObject({ data: { code: 'not_found' } });
  expect((await a.as.query(api.walls.getMine, {})).items[0].noteVisible).toBe(false);
});

it('allowlists public data and keeps snapshot metadata without catalog enrichment', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const { items: [item] } = await a.as.mutation(api.walls.setLayout, a.input);
  const publicWall = await t.query(api.walls.getPublic, { profileId: a.profile.profileId });
  expect(Object.keys(publicWall!).sort()).toEqual(['artworkCount', 'color', 'items', 'profileId']);
  expect(Object.keys(publicWall!.items[0]).sort()).toEqual(['artwork', 'itemId', 'layout']);
  expect(publicWall!.items[0].artwork).toEqual({ title: 'Saved title', artist: 'Saved artist', date: '1900', medium: 'Oil', media: { kind: 'placeholder', width: 1, height: 1 } });
  expect(JSON.stringify(publicWall)).not.toContain(a.saveLocalId);
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toEqual(publicWall!.items[0]);
});

it('counts artworks by save so a second placement of the same work adds a piece, not an artwork', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const second = { ...a.selection, placementId: crypto.randomUUID(), layout: { ...a.layout, x: 0.5, layer: 1 } };
  await a.as.mutation(api.walls.setLayout, { ...a.input, items: [a.selection, second] });
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toMatchObject({ artworkCount: 1, items: [{ layout: a.layout }, { layout: second.layout }] });
});

it.each(['deleted', 'missing', 'inactive', 'wrong-owner', 'wrong-parent'] as const)('checks current parents before direct and wall reads: %s', async (change) => {
  const t = harness(), a = await wallFixture(t, 'a'), b = await wallFixture(t, 'b');
  const { items: [item] } = await a.as.mutation(api.walls.setLayout, a.input);
  await t.run(async (ctx) => {
    if (change === 'deleted') await ctx.db.patch(a.saveId, { deletedAt: 1 });
    if (change === 'missing') await ctx.db.delete(a.saveId);
    if (change === 'inactive') await ctx.db.patch(a.profile.profileId, { active: false });
    if (change === 'wrong-owner') await ctx.db.patch(a.saveId, { owner: { kind: 'account', accountId: b.accountId } });
    if (change === 'wrong-parent') await ctx.db.patch(item.itemId, { profileId: b.profile.profileId });
  });
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).toBeNull();
  expect((await t.query(api.walls.getPublic, { profileId: a.profile.profileId }))?.items ?? []).toEqual([]);
});

it('invalidates deleted selections atomically and removal retries do not advance revisions', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  await a.as.mutation(api.walls.setLayout, a.input);
  await a.as.mutation(api.collections.remove, { scope: a.scope, localId: a.saveLocalId });
  const before = await a.as.query(api.walls.getMine, {});
  expect(before).toMatchObject({ revision: 2, items: [] });
  await a.as.mutation(api.collections.remove, { scope: a.scope, localId: a.saveLocalId });
  expect(await a.as.query(api.walls.getMine, {})).toEqual(before);
  expect(await t.query(api.profiles.getPublic, { profileId: a.profile.profileId })).toMatchObject({ publishedWallCount: 0 });
});

it('removes the wall and its selections when the account is purged', async () => {
  vi.useFakeTimers();
  const t = harness(), a = await wallFixture(t, 'a');
  const { items: [item] } = await a.as.mutation(api.walls.setLayout, a.input);
  await a.as.mutation(api.accounts.deleteAccount, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(a.saveId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(item.itemId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('walls').collect())).toEqual([]);
  expect(await t.query(api.walls.getPublic, { profileId: a.profile.profileId })).toBeNull();
  vi.useRealTimers();
});

it('invalidates a pending opt-in when a private note is emptied and later rewritten', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const { items: [item] } = await a.as.mutation(api.walls.setLayout, a.input);
  await t.run(async (ctx) => {
    const save = (await ctx.db.get(a.saveId))!;
    const fields = { localId: save.localId, snapshot: save.snapshot, savedAt: save.savedAt };
    await upsertJournalSave(ctx, save.owner, a.deviceId, { ...fields, note: '' });
    await clearEmptyNoteVisibility(ctx, save._id);
    await upsertJournalSave(ctx, save.owner, a.deviceId, { ...fields, note: 'Replacement private note' });
  });
  expect((await a.as.query(api.walls.getMine, {})).items[0].noteRevision).toBe(1);
  await expect(a.as.mutation(api.walls.setNoteVisibility, { scope: a.scope, changes: [{ itemId: item.itemId, noteRevision: 0, visible: true }] })).rejects.toMatchObject({ data: { code: 'conflict' } });
  expect(await t.query(api.walls.getArtwork, { itemId: item.itemId })).not.toHaveProperty('note');
});

it('sorts layers and rejects simultaneous replacements based on the same revision', async () => {
  const t = harness(), a = await wallFixture(t, 'a');
  const another = await t.run(async (ctx) => {
    const save = (await ctx.db.get(a.saveId))!;
    const { _id: _id, _creationTime: _creationTime, ...fields } = save;
    const localId = crypto.randomUUID(); await ctx.db.insert('collections', { ...fields, localId }); return localId;
  });
  const items = [{ ...a.selection, layout: { ...a.layout, layer: 2 } }, { placementId: another, saveLocalId: another, layout: { ...a.layout, layer: 1 } }];
  const first = await a.as.mutation(api.walls.setLayout, { ...a.input, items });
  expect(first.items.map((item) => item.layout.layer)).toEqual([1, 2]);
  const results = await Promise.allSettled(['#123456', '#654321'].map((color) => a.as.mutation(api.walls.setLayout, { ...a.input, items, revision: 1, color })));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { data: { code: 'conflict' } } });
  await expect(a.as.mutation(api.walls.setLayout, { ...a.input, note: 'secret' } as never)).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query('sharedVisits').collect())).toEqual([]);
});

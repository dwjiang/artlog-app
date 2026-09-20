import { expect, it } from 'vitest';
import type { FunctionReturnType } from 'convex/server';
import { api, internal } from './_generated/api';
import { harness } from './test.helpers';
import { befriend, socialUser, socialVisit } from './lib/socialTestFixtures';
import { LIMITS, utf8Bytes } from '../shared/journal/limits';
import { compareHistory, PAGE_BYTES } from './lib/sharedPublications';

const notFound = { data: { code: 'not_found' } }, conflict = { data: { code: 'conflict' } };
it('previews without mutations or private fields, preserves order, and uses no fabricated item IDs', async () => {
  const t = harness(), a = await socialUser(t), draft = await socialVisit(t, a);
  const selection = { ...draft.selection, saveLocalIds: draft.selection.saveLocalIds.toReversed(), reflection: 'Shared words' };
  const before = await t.run(async (ctx) => ({ publications: await ctx.db.query('sharedVisits').collect(), items: await ctx.db.query('sharedVisitItems').collect() }));
  const preview = await a.as.query(api.sharedVisits.preview, selection);
  expect(preview.artworks.map((x) => x.artwork.title)).toEqual(['Work 1', 'Work 0']);
  expect(preview.artworks[0]).not.toHaveProperty('itemId');
  expect(JSON.stringify(preview)).not.toMatch(/PRIVATE|accountId|storageId|visitId|scanId/);
  expect(await t.run(async (ctx) => ({ publications: await ctx.db.query('sharedVisits').collect(), items: await ctx.db.query('sharedVisitItems').collect() }))).toEqual(before);
  const state = await a.as.mutation(api.sharedVisits.publish, selection);
  const post = await a.as.query(api.sharedVisits.get, { postId: state.postId! });
  expect(post.artworks.page.map((x) => x.artwork)).toEqual(preview.artworks.map((x) => x.artwork));
  expect(JSON.stringify(post)).not.toMatch(/PRIVATE|saveLocalId|visitLocalId|accountId|storageId/);
  expect(Object.keys(post).sort()).toEqual(['artworkCount', 'artworks', 'audience', 'author', 'postId', 'publishedAt', 'reflection', 'revision', 'venue', 'visitedOn']);
});
it('rejects forged selections, private visits, duplicate UUIDs, and missing shared text', async () => {
  const t = harness(), a = await socialUser(t), b = await socialUser(t), draft = await socialVisit(t, a), other = await socialVisit(t, b);
  for (const input of [
    { ...draft.selection, saveLocalIds: [other.saves[0].localId] },
    { ...draft.selection, visitLocalId: other.visit.localId },
    { ...draft.selection, saveLocalIds: [crypto.randomUUID()] },
  ]) await expect(a.as.mutation(api.sharedVisits.publish, input)).rejects.toMatchObject(notFound);
  const anotherVisit = await socialVisit(t, a);
  await expect(a.as.mutation(api.sharedVisits.publish, { ...draft.selection, saveLocalIds: [anotherVisit.saves[0].localId] })).rejects.toMatchObject(notFound);
  for (const input of [{ ...draft.selection, saveLocalIds: [draft.saves[0].localId, draft.saves[0].localId] }, { ...draft.selection, reflection: 'x'.repeat(1201) }]) {
    await expect(a.as.mutation(api.sharedVisits.publish, input)).rejects.toMatchObject({ data: { code: 'invalid_post' } });
  }
  const { reflection: _reflection, ...missingText } = draft.selection;
  await expect(a.as.mutation(api.sharedVisits.publish, missingText as never)).rejects.toThrow();
  await a.as.mutation(api.collections.remove, { scope: a.scope, localId: draft.saves[0].localId });
  await expect(a.as.query(api.sharedVisits.preview, draft.selection)).rejects.toMatchObject(notFound);
});
it('allows empty posts and preserves identity and first publication time through edit and reshare', async () => {
  const t = harness(), a = await socialUser(t), draft = await socialVisit(t, a, 0);
  const first = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const post = await a.as.query(api.sharedVisits.get, { postId: first.postId! });
  expect(post.artworks.page).toEqual([]); expect(post.reflection).toBe('');
  const edited = await a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 1, reflection: 'Edited' });
  expect(edited.postId).toBe(first.postId);
  await a.as.mutation(api.sharedVisits.unshare, { visitLocalId: draft.visit.localId, revision: 2 });
  await expect(a.as.query(api.sharedVisits.get, { postId: first.postId! })).rejects.toMatchObject(notFound);
  await expect(a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 2 })).rejects.toMatchObject(conflict);
  expect(await a.as.mutation(api.sharedVisits.unshare, { visitLocalId: draft.visit.localId, revision: 2 })).toMatchObject({ revision: 3 });
  await a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 3 });
  expect(await a.as.query(api.sharedVisits.get, { postId: first.postId! })).toMatchObject({ postId: first.postId, publishedAt: post.publishedAt });
});
it('lists only the caller’s active, unremoved shared visits', async () => {
  const t = harness(), a = await socialUser(t), b = await socialUser(t);
  await befriend(a, b);
  const shared = await socialVisit(t, a), unshared = await socialVisit(t, a), removed = await socialVisit(t, a), theirs = await socialVisit(t, b);
  for (const draft of [shared, unshared, removed]) await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const post = await b.as.mutation(api.sharedVisits.publish, theirs.selection);
  await a.as.mutation(api.sharedVisits.unshare, { visitLocalId: unshared.visit.localId, revision: 1 });
  const flagged = await a.as.query(api.sharedVisits.getState, { visitLocalId: removed.visit.localId });
  const reportId = await b.as.mutation(api.reports.submit, { target: { kind: 'sharedVisit', postId: flagged.postId! }, reason: 'Abuse' });
  await t.mutation(internal.review.decideReport, { reportId, operator: 'operator@example.test', decision: 'remove', reason: 'Confirmed' });
  expect(await a.as.query(api.sharedVisits.listShared, {})).toEqual([shared.visit.localId]);
  expect(await b.as.query(api.sharedVisits.listShared, {})).toEqual([theirs.visit.localId]);
  expect(post.postId).not.toBeNull();
  await expect(t.query(api.sharedVisits.listShared, {})).rejects.toThrow();
});
it('retains an initial revocation and serializes concurrent publication writes', async () => {
  const t = harness(), a = await socialUser(t), draft = await socialVisit(t, a, 0);
  await a.as.mutation(api.sharedVisits.unshare, { visitLocalId: draft.visit.localId, revision: 0 });
  await expect(a.as.mutation(api.sharedVisits.publish, draft.selection)).rejects.toMatchObject(conflict);
  const results = await Promise.allSettled([0, 1].map(() => a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 1 })));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rows = await t.run((ctx) => ctx.db.query('sharedVisits').collect());
  expect(rows).toHaveLength(1); expect(rows[0].publishedAt).toBeGreaterThan(0);
});
it('grants historical access only after acceptance and revokes detail, artwork, and feed together', async () => {
  const t = harness(), a = await socialUser(t), b = await socialUser(t), draft = await socialVisit(t, a);
  const state = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const postId = state.postId!, ownerPost = await a.as.query(api.sharedVisits.get, { postId });
  const itemId = ownerPost.artworks.page[0].itemId;
  await expect(b.as.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
  await expect(b.as.query(api.sharedVisits.get, { postId: crypto.randomUUID() })).rejects.toMatchObject(notFound);
  await expect(b.as.query(api.sharedVisits.getState, { visitLocalId: draft.visit.localId })).rejects.toMatchObject(notFound);
  await befriend(a, b);
  expect((await b.as.query(api.sharedVisits.listFeed, {})).page.map((p) => p.postId)).toEqual([postId]);
  expect((await a.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect((await a.as.query(api.sharedVisits.listByProfile, { profileId: a.profileId })).page).toHaveLength(1);
  expect(await b.as.query(api.sharedVisits.getArtwork, { postId, itemId })).toMatchObject({ itemId });
  const other = await socialVisit(t, a);
  const otherPost = await a.as.mutation(api.sharedVisits.publish, other.selection);
  await expect(b.as.query(api.sharedVisits.getArtwork, { postId: otherPost.postId!, itemId })).rejects.toMatchObject(notFound);
  await b.as.mutation(api.friendships.block, { profileId: a.profileId, revision: 2, blockRevision: 0 });
  await expect(b.as.query(api.sharedVisits.getArtwork, { postId, itemId })).rejects.toMatchObject(notFound);
  await expect(b.as.query(api.sharedVisits.get, { postId })).rejects.toMatchObject(notFound);
  expect((await b.as.query(api.sharedVisits.listFeed, {})).page).toEqual([]);
  expect(await a.as.query(api.sharedVisits.get, { postId })).toMatchObject({ postId });
});
it('updates dates atomically, leaves shared text unchanged, and retains a post after its last save is deleted', async () => {
  const t = harness(), a = await socialUser(t), draft = await socialVisit(t, a, 1);
  const state = await a.as.mutation(api.sharedVisits.publish, { ...draft.selection, reflection: 'Shared text' });
  await a.as.mutation(api.visits.upsertJournal, { scope: a.scope, visit: { localId: draft.visit.localId, venueId: draft.visit.venueId,
    timeZone: 'UTC', visitedOn: '2026-08-01', reflection: 'PRIVATE EDIT' } });
  expect(await a.as.query(api.sharedVisits.get, { postId: state.postId! })).toMatchObject({ visitedOn: '2026-08-01', reflection: 'Shared text', revision: 2 });
  await a.as.mutation(api.collections.remove, { scope: a.scope, localId: draft.saves[0].localId });
  const post = await a.as.query(api.sharedVisits.get, { postId: state.postId! });
  expect(post.artworks.page).toEqual([]); expect(post.revision).toBe(3);
  expect(await t.run((ctx) => ctx.db.get(draft.visit._id))).not.toBeNull();
});
it('merges date and post-ID keysets across friends without losing tied records or accepting foreign cursors', async () => {
  const t = harness(), viewer = await socialUser(t), a = await socialUser(t), b = await socialUser(t);
  await befriend(viewer, a); await befriend(viewer, b);
  const expected = [];
  for (const user of [a, b]) for (const date of ['2026-09-01', '2026-08-31', '2026-09-01']) {
    const draft = await socialVisit(t, user, 0, date);
    const result = await user.as.mutation(api.sharedVisits.publish, draft.selection);
    expected.push({ visitedOn: date, postId: result.postId! });
  }
  let cursor: string | null = null;
  const seen = [];
  do {
    const result: FunctionReturnType<typeof api.sharedVisits.listFeed> = await viewer.as.query(api.sharedVisits.listFeed, { limit: 2, cursor });
    seen.push(...result.page.map((p) => ({ visitedOn: p.visitedOn, postId: p.postId }))); cursor = result.cursor;
    if (cursor) await expect(viewer.as.query(api.sharedVisits.listByProfile, { profileId: a.profileId, cursor })).rejects.toMatchObject({ data: { code: 'invalid_pagination' } });
  } while (cursor);
  expect(seen).toEqual(expected.sort((a, b) => -compareHistory(a, b)));
  for (const args of [{ cursor: '{}' }, { cursor: 'bad' }, { cursor: 'x'.repeat(8193) }, { limit: 51 }]) {
    await expect(viewer.as.query(api.sharedVisits.listFeed, args)).rejects.toMatchObject({ data: { code: 'invalid_pagination' } });
  }
});
it('bounds maximum-size artwork responses with continuation pages and revision-bound cursors', async () => {
  const t = harness({ transactionLimits: true }), a = await socialUser(t), draft = await socialVisit(t, a, LIMITS.selectedSaves);
  for (const save of draft.saves) await t.run((ctx) => ctx.db.patch(save.id, {
    snapshot: { title: '界'.repeat(LIMITS.snapshot), artist: '界'.repeat(LIMITS.snapshot), date: '界'.repeat(LIMITS.snapshot), medium: '界'.repeat(LIMITS.snapshot), institution: '界'.repeat(LIMITS.snapshot) },
    note: '界'.repeat(LIMITS.note), venueName: '界'.repeat(LIMITS.snapshot), gallery: '界'.repeat(LIMITS.snapshot),
  }));
  expect((await a.as.query(api.sharedVisits.preview, draft.selection)).artworks).toHaveLength(LIMITS.selectedSaves);
  const state = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const seen = []; let cursor: string | null = null;
  do {
    const post: FunctionReturnType<typeof api.sharedVisits.get> = await a.as.query(api.sharedVisits.get, { postId: state.postId!, limit: 50, cursor });
    expect(utf8Bytes(post.artworks.page)).toBeLessThanOrEqual(PAGE_BYTES);
    expect(post.artworks.page.length).toBeGreaterThan(0);
    seen.push(...post.artworks.page.map((x) => x.itemId)); cursor = post.artworks.cursor;
  } while (cursor);
  expect(new Set(seen).size).toBe(LIMITS.selectedSaves);
  const first = await a.as.query(api.sharedVisits.get, { postId: state.postId!, limit: 1 });
  await a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 1, saveLocalIds: draft.selection.saveLocalIds.toReversed() });
  await expect(a.as.query(api.sharedVisits.get, { postId: state.postId!, cursor: first.artworks.cursor })).rejects.toMatchObject(conflict);
});
it('shares the publication quota across account devices while allowing unsharing after exhaustion', async () => {
  const { seedDevice } = await import('./lib/testFactories');
  const t = harness(), a = await socialUser(t), sibling = await seedDevice(t), draft = await socialVisit(t, a, 0);
  await t.run((ctx) => ctx.db.patch(sibling.deviceId, { accountId: a.accountId }));
  for (let revision = 0; revision < 30; revision++) await a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision });
  await expect(sibling.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: 30 })).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'publishVisit' } });
  expect(await sibling.as.mutation(api.sharedVisits.unshare, { visitLocalId: draft.visit.localId, revision: 30 })).toMatchObject({ status: 'private', revision: 31 });
});
it('merges 200 friend streams under transaction limits and honors short-page cursors', async () => {
  const { canonicalPair } = await import('./lib/friendships');
  const t = harness({ transactionLimits: true }), viewer = await socialUser(t);
  const expected = await t.run(async (ctx) => {
    const venueId = await ctx.db.insert('museums', { key: 'stress', name: 'Museum', lat: 0, lng: 0, seedSource: 'manual', region: 'US', optOut: false });
    const postIds = [];
    for (let i = 0; i < LIMITS.friends; i++) {
      const accountId = await ctx.db.insert('accounts', { appleUserId: `stress-${i}`, deviceIds: [], createdAt: 1 });
      const profileId = await ctx.db.insert('profiles', { accountId, username: `stress-${i}`, name: 'Friend', searchText: 'friend', active: true, leaderboardVisibility: 'global',
        publishedWallCount: 0, createdAt: 1, updatedAt: 1 });
      const owner = { kind: 'account' as const, accountId }, visitLocalId = crypto.randomUUID(), postId = crypto.randomUUID();
      const visitId = await ctx.db.insert('visits', { owner, localId: visitLocalId, venueId, venueName: 'Museum', visitedOn: '2026-09-01',
        timeZone: 'UTC', updatedAt: 1, updatedBy: viewer.deviceId, changeVersion: 1 });
      const publicationId = await ctx.db.insert('sharedVisits', { audience: 'friends', postId, profileId, visitId, visitLocalId, visitedOn: '2026-09-01', status: 'active',
        reflection: '', publishedAt: 1, updatedAt: 1, publicationRevision: 1 });
      for (let position = 0; position < 3; position++) {
        const localId = crypto.randomUUID();
        const saveId = await ctx.db.insert('collections', { owner, localId, visitId, visitLocalId, venueId, snapshot: { title: 'Work', artist: 'Artist' },
          savedAt: 1, updatedAt: 1, updatedBy: viewer.deviceId, changeVersion: 1 });
        await ctx.db.insert('sharedVisitItems', { publicationId, saveId, saveLocalId: localId, position, highlighted: true });
      }
      const [firstProfileId, secondProfileId] = canonicalPair(viewer.profileId, profileId);
      await ctx.db.insert('friendships', { firstProfileId, secondProfileId, requesterId: viewer.profileId, state: 'accepted', revision: 2, updatedAt: 1 });
      postIds.push(postId);
    }
    return postIds;
  });
  let cursor: string | null = null;
  const seen = [];
  do {
    const result: FunctionReturnType<typeof api.sharedVisits.listFeed> = await viewer.as.query(api.sharedVisits.listFeed, { limit: 50, cursor });
    expect(result.page.length).toBeGreaterThan(0); expect(result.page.length).toBeLessThan(50);
    expect(result.page.reduce((sum, p) => sum + p.artworks.page.length, 0)).toBeLessThanOrEqual(50);
    expect(utf8Bytes(result)).toBeLessThan(PAGE_BYTES);
    seen.push(...result.page.map((p) => p.postId)); cursor = result.cursor;
  } while (cursor);
  expect(seen).toEqual(expected.sort().reverse());
}, 30_000);

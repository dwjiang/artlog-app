import { expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import { harness, signIn } from './test.helpers';
import { befriend, socialUser, socialVisit } from './lib/socialTestFixtures';
import { seedDevice } from './lib/testFactories';
import { requirePublicWallItem } from './lib/publicationAccess';

it('accepts public reports from registered devices, deduplicates account reporters, and requires shared-visit access', async () => {
  const t = harness(), author = await socialUser(t), guest = await seedDevice(t), stranger = await socialUser(t);
  const target = { kind: 'profile' as const, profileId: author.profileId };
  await expect(t.mutation(api.reports.submit, { target, reason: 'Spam' })).rejects.toThrow();
  const unregistered = await signIn(t);
  await expect(unregistered.as.mutation(api.reports.submit, { target, reason: 'Spam' })).rejects.toMatchObject({ data: { code: 'device_not_registered' } });
  const id = await guest.as.mutation(api.reports.submit, { target, reason: 'Spam' });
  expect(await guest.as.mutation(api.reports.submit, { target, reason: 'Again' })).toBe(id);
  const first = await stranger.as.mutation(api.reports.submit, { target, reason: 'Spam' });
  const sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch(sibling.deviceId, { accountId: stranger.accountId }));
  expect(await sibling.as.mutation(api.reports.submit, { target, reason: 'Spam' })).toBe(first);
  const draft = await socialVisit(t, author);
  const post = await author.as.mutation(api.sharedVisits.publish, { ...draft.selection, reflection: 'Public evidence' });
  const sharedTarget = { kind: 'sharedVisit' as const, postId: post.postId! };
  await expect(stranger.as.mutation(api.reports.submit, { target: sharedTarget, reason: 'Abuse' })).rejects.toMatchObject({ data: { code: 'not_found' } });
  await befriend(author, stranger);
  const reportId = await stranger.as.mutation(api.reports.submit, { target: sharedTarget, reason: 'Abuse' });
  const report = await t.query(internal.review.getReport, { reportId });
  expect(report?.evidence).toEqual({ kind: 'sharedVisit', profileId: author.profileId, postId: post.postId, reflection: 'Public evidence' });
  expect(JSON.stringify(report?.evidence)).not.toMatch(/PRIVATE|visitId|saveId|accountId|storage/);
  await author.as.mutation(api.sharedVisits.unshare, { visitLocalId: draft.visit.localId, revision: 1 });
  await expect(stranger.as.mutation(api.reports.submit, { target: sharedTarget, reason: 'Abuse' })).rejects.toMatchObject({ data: { code: 'not_found' } });
  expect((await t.query(internal.review.getReport, { reportId }))?.evidence).toEqual(report?.evidence);
});
it('records operator decisions and permanently removes a publication without changing its private journal', async () => {
  const t = harness(), a = await socialUser(t), b = await socialUser(t), draft = await socialVisit(t, a);
  await befriend(a, b);
  const post = await a.as.mutation(api.sharedVisits.publish, draft.selection);
  const reportId = await b.as.mutation(api.reports.submit, { target: { kind: 'sharedVisit', postId: post.postId! }, reason: 'Abuse' });
  expect((await t.query(internal.review.listReports, {})).rows.map((r) => r.reportId)).toEqual([reportId]);
  const decision = { reportId, operator: 'operator@example.test', decision: 'remove' as const, reason: 'Confirmed abuse' };
  await t.mutation(internal.review.decideReport, decision);
  await t.mutation(internal.review.decideReport, decision);
  expect((await t.query(internal.review.getReport, { reportId }))?.review).toEqual({ operator: decision.operator, decision: 'remove', reason: decision.reason, reviewedAt: expect.any(Number) });
  expect((await t.query(internal.review.listReports, {})).rows).toEqual([]);
  await expect(a.as.query(api.sharedVisits.get, { postId: post.postId! })).rejects.toMatchObject({ data: { code: 'not_found' } });
  const state = await a.as.query(api.sharedVisits.getState, { visitLocalId: draft.visit.localId });
  expect(state).toMatchObject({ removed: true, status: 'private', revision: 2 });
  await expect(a.as.mutation(api.sharedVisits.publish, { ...draft.selection, revision: state.revision })).rejects.toMatchObject({ data: { code: 'not_found' } });
  expect((await t.run((ctx) => ctx.db.get(draft.visit._id)))?.reflection).toBe('PRIVATE REFLECTION');
  expect((await t.run((ctx) => ctx.db.get(draft.saves[0].id)))?.note).toBe('PRIVATE NOTE');
  await expect(t.mutation(internal.review.decideReport, { ...decision, decision: 'dismiss' })).rejects.toMatchObject({ data: { code: 'conflict' } });
});
it('captures only published wall text and retains removal even if an active flag is later changed', async () => {
  const t = harness(), a = await socialUser(t), reporter = await seedDevice(t), draft = await socialVisit(t, a);
  const itemId = await t.run(async (ctx) => {
    const wallId = await ctx.db.insert('walls', { profileId: a.profileId, color: '#fff', layoutRevision: 1 });
    await ctx.db.patch(a.profileId, { publishedWallCount: 1 });
    return ctx.db.insert('wallItems', { profileId: a.profileId, wallId, saveId: draft.saves[0].id, placementId: draft.saves[0].localId, saveLocalId: draft.saves[0].localId,
      active: true, noteVisible: false, noteRevision: 0, layout: { x: 0, y: 0, width: 1, layer: 0, frame: 'none' } });
  });
  const reportId = await reporter.as.mutation(api.reports.submit, { target: { kind: 'wallItem', itemId }, reason: 'Abuse' });
  const report = await t.query(internal.review.getReport, { reportId });
  expect(report?.evidence).toEqual({ kind: 'wallItem', profileId: a.profileId, itemId, title: 'Work 0', artist: 'Artist' });
  await t.mutation(internal.review.decideReport, { reportId, operator: 'op', decision: 'remove', reason: 'Confirmed' });
  await t.run((ctx) => ctx.db.patch(itemId, { active: true }));
  await expect(t.run((ctx) => requirePublicWallItem(ctx, itemId))).rejects.toMatchObject({ data: { code: 'not_found' } });
  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item?.noteRevision).toBe(1);
  expect((await t.run((ctx) => ctx.db.get(item!.wallId)))?.layoutRevision).toBe(2);
  expect((await t.run((ctx) => ctx.db.get(a.profileId)))?.publishedWallCount).toBe(0);
});
it('dismisses without removing content and prevents a disabled profile from recreating itself', async () => {
  const t = harness(), a = await socialUser(t), reporter = await seedDevice(t);
  const target = { kind: 'profile' as const, profileId: a.profileId };
  const first = await reporter.as.mutation(api.reports.submit, { target, reason: 'Abuse' });
  await t.mutation(internal.review.decideReport, { reportId: first, operator: 'op', decision: 'dismiss', reason: 'Allowed' });
  expect(await t.query(api.profiles.getPublic, { profileId: a.profileId })).not.toBeNull();
  const reportId = await reporter.as.mutation(api.reports.submit, { target, reason: 'New abuse' });
  expect(reportId).not.toBe(first);
  await t.mutation(internal.review.decideReport, { reportId, operator: 'op', decision: 'remove', reason: 'Confirmed' });
  await expect(a.as.mutation(api.profiles.create, { username: 'another-name', name: 'New' })).rejects.toMatchObject({ data: { code: 'profile_required' } });
  await t.run((ctx) => ctx.db.patch(a.profileId, { active: true }));
  expect(await t.query(api.profiles.getPublic, { profileId: a.profileId })).toBeNull();
  await expect(a.as.mutation(internal.profilePhotoData.save, { profileId: a.profileId, name: 'New' })).rejects.toMatchObject({ data: { code: 'profile_required' } });
});
it('enforces ten daily reports per account across devices without charging duplicate open reports', async () => {
  const t = harness(), reporter = await socialUser(t), sibling = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch(sibling.deviceId, { accountId: reporter.accountId }));
  for (let i = 0; i < 10; i++) {
    const author = await socialUser(t);
    const input = { target: { kind: 'profile' as const, profileId: author.profileId }, reason: 'Spam' };
    const first = await reporter.as.mutation(api.reports.submit, input);
    expect(await sibling.as.mutation(api.reports.submit, input)).toBe(first);
  }
  const author = await socialUser(t);
  await expect(sibling.as.mutation(api.reports.submit, { target: { kind: 'profile', profileId: author.profileId }, reason: 'Spam' })).rejects.toMatchObject({ data: { code: 'rate_limited', name: 'report' } });
});

import { expect, it } from 'vitest';
import { api } from './_generated/api';
import { harness } from './test.helpers';
import { socialUser, socialVisit } from './lib/socialTestFixtures';

async function fixture() {
  const t = harness(), owner = await socialUser(t), outsider = await socialUser(t);
  const visit = await socialVisit(t, owner, 1);
  const savedLocalId = visit.saves[0].localId;
  const photos = ['full', 'detail', 'label'].map((kind) => ({ localId: crypto.randomUUID(), savedLocalId,
    kind: kind as 'full' | 'detail' | 'label', capturedAt: 1, visitLocalId: visit.visit.localId }));
  await owner.as.mutation(api.artworkAlbums.sync, { scope: owner.scope, since: 0, photos, encounters: [] });
  for (const photo of photos) await owner.as.fetch(`/collection-photo?scope=${encodeURIComponent(owner.scope)}&localId=${savedLocalId}&photoId=${photo.localId}&kind=photo`,
    { method: 'POST', body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), headers: { 'Content-Type': 'image/jpeg' } });
  const args = { scope: owner.scope, savedLocalId };
  const items = [photos[0], photos[0], photos[1]].map((photo, layer) => ({ placementId: crypto.randomUUID(), saveLocalId: savedLocalId,
    photoLocalId: photo.localId, layout: { x: 0, y: layer * 0.4, width: 0.3, layer, frame: 'gilt' as const } }));
  return { t, owner, outsider, visit, photos, args, items };
}

it('reports published placements and shared visits for each photo, without treating the rest of an album as shared', async () => {
  const { owner, visit, photos, args, items } = await fixture();
  await owner.as.mutation(api.walls.setLayout, { scope: owner.scope, revision: 0, color: '#45524B', items });
  await owner.as.mutation(api.sharedVisits.publish, { ...visit.selection, photoSelections: [{ saveLocalId: args.savedLocalId, photoLocalIds: [photos[0].localId] }] });
  const result = await owner.as.query(api.photoVisibility.forArtwork, args);
  expect(result).toEqual(photos.map((photo, i) => ({ photoLocalId: photo.localId, wallPlacements: [2, 1, 0][i], sharedVisits: i === 0 ? 1 : 0 })));
});

it('stops counting unpublished visits and removed wall placements', async () => {
  const { owner, visit, photos, args, items } = await fixture();
  const wall = await owner.as.mutation(api.walls.setLayout, { scope: owner.scope, revision: 0, color: '#45524B', items });
  const post = await owner.as.mutation(api.sharedVisits.publish, { ...visit.selection, photoSelections: [{ saveLocalId: args.savedLocalId, photoLocalIds: [photos[0].localId] }] });
  await owner.as.mutation(api.walls.setLayout, { scope: owner.scope, revision: wall.revision, color: '#45524B', items: [] });
  await owner.as.mutation(api.sharedVisits.unshare, { visitLocalId: visit.visit.localId, revision: post.revision });
  expect((await owner.as.query(api.photoVisibility.forArtwork, args)).every((photo) => photo.wallPlacements === 0 && photo.sharedVisits === 0)).toBe(true);
});

it('does not disclose another owner’s photo visibility or accept their scope', async () => {
  const { t, outsider, args } = await fixture();
  await expect(t.query(api.photoVisibility.forArtwork, args)).rejects.toThrow();
  await expect(outsider.as.query(api.photoVisibility.forArtwork, args)).rejects.toThrow('sync_scope_changed');
  expect(await outsider.as.query(api.photoVisibility.forArtwork, { ...args, scope: outsider.scope })).toEqual([]);
});

it('reports any explicitly published photo that the shared-media endpoint can serve', async () => {
  const { t, owner, visit, photos, args } = await fixture();
  const otherVisit = await socialVisit(t, owner, 0);
  await owner.as.mutation(api.artworkAlbums.sync, { scope: owner.scope, since: 0, photos: [],
    encounters: [{ savedLocalId: args.savedLocalId, visitLocalId: otherVisit.visit.localId }] });
  for (const draft of [visit, otherVisit]) await owner.as.mutation(api.sharedVisits.publish, { ...draft.selection,
    saveLocalIds: [args.savedLocalId], photoSelections: [{ saveLocalId: args.savedLocalId, photoLocalIds: [photos[0].localId] }] });
  const result = await owner.as.query(api.photoVisibility.forArtwork, args);
  expect(result.find((row) => row.photoLocalId === photos[0].localId)?.sharedVisits).toBe(2);
});

it.each(['inactive-profile', 'removed-profile', 'removed-post', 'removed-placement'] as const)(
  'does not count inaccessible publications after %s', async (removed) => {
    const { t, owner, visit, photos, args, items } = await fixture();
    const wall = await owner.as.mutation(api.walls.setLayout, { scope: owner.scope, revision: 0, color: '#45524B', items });
    const post = await owner.as.mutation(api.sharedVisits.publish, { ...visit.selection,
      photoSelections: [{ saveLocalId: args.savedLocalId, photoLocalIds: [photos[0].localId] }] });
    await t.run(async (ctx) => {
      const reportId = await ctx.db.insert('reports', { target: { kind: 'profile', profileId: owner.profileId }, reason: 'Removed',
        evidence: { kind: 'profile', profileId: owner.profileId, username: 'owner', name: 'Owner' }, createdAt: 1, status: 'resolved' });
      const removal = { reportId, removedAt: 2 };
      if (removed === 'inactive-profile') await ctx.db.patch(owner.profileId, { active: false });
      if (removed === 'removed-profile') await ctx.db.patch(owner.profileId, { removal });
      if (removed === 'removed-placement') await ctx.db.patch(wall.items[0].itemId, { removal });
      if (removed === 'removed-post') {
        const publication = await ctx.db.query('sharedVisits').withIndex('by_postId', (q) => q.eq('postId', post.postId!)).unique();
        await ctx.db.patch(publication!._id, { removal });
      }
    });
    const result = await owner.as.query(api.photoVisibility.forArtwork, args);
    expect(result.find((row) => row.photoLocalId === photos[0].localId)).toEqual({ photoLocalId: photos[0].localId,
      wallPlacements: removed === 'removed-post' ? 2 : removed === 'removed-placement' ? 1 : 0,
      sharedVisits: removed === 'removed-placement' ? 1 : 0 });
  });

it('omits deleted photos and stops counting a visit after its encounter is unlinked', async () => {
  const { owner, visit, photos, args, items } = await fixture();
  await owner.as.mutation(api.walls.setLayout, { scope: owner.scope, revision: 0, color: '#45524B', items });
  await owner.as.mutation(api.sharedVisits.publish, { ...visit.selection,
    photoSelections: [{ saveLocalId: args.savedLocalId, photoLocalIds: [photos[0].localId, photos[1].localId] }] });
  await owner.as.mutation(api.artworkAlbums.sync, { scope: owner.scope, since: 0,
    photos: [{ ...photos[0], deletedAt: 2 }], encounters: [] });
  expect(await owner.as.query(api.photoVisibility.forArtwork, args)).toEqual([
    { photoLocalId: photos[1].localId, wallPlacements: 1, sharedVisits: 1 },
    { photoLocalId: photos[2].localId, wallPlacements: 0, sharedVisits: 0 },
  ]);
  await owner.as.mutation(api.artworkAlbums.sync, { scope: owner.scope, since: 0, photos: [],
    encounters: [{ savedLocalId: args.savedLocalId, visitLocalId: visit.visit.localId, deletedAt: 3 }] });
  expect((await owner.as.query(api.photoVisibility.forArtwork, args)).map((row) => row.sharedVisits)).toEqual([0, 0]);
  await owner.as.mutation(api.collections.remove, { scope: owner.scope, localId: args.savedLocalId });
  expect(await owner.as.query(api.photoVisibility.forArtwork, args)).toEqual([]);
});

it('rejects the former owner scope after the device switches accounts', async () => {
  const { t, owner, outsider, args } = await fixture();
  await t.run((ctx) => ctx.db.patch(owner.deviceId, { accountId: outsider.accountId, scopeRevision: 1 }));
  await expect(owner.as.query(api.photoVisibility.forArtwork, args)).rejects.toThrow('sync_scope_changed');
  expect(await owner.as.query(api.photoVisibility.forArtwork, { ...args, scope: `account:${outsider.accountId}:1` })).toEqual([]);
});

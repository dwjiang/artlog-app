import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { Harness } from '../test.helpers';
import { seedContribution, seedDevice, seedJournalVisit, seedMuseum, seedScan } from './testFactories';

export type SocialUser = Awaited<ReturnType<typeof seedDevice>> & { accountId: Id<'accounts'>; profileId: Id<'profiles'> };
export async function socialUser(t: Harness, name: string = crypto.randomUUID()): Promise<SocialUser> {
  const device = await seedDevice(t);
  const accountId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('accounts', { appleUserId: name, deviceIds: [device.deviceId], createdAt: 1 });
    await ctx.db.patch(device.deviceId, { accountId: id });
    return id;
  });
  const profile = await device.as.mutation(api.profiles.create, { username: `u-${name.toLowerCase().slice(0,20)}`, name });
  return { ...device, accountId, profileId: profile.profileId, scope: `account:${accountId}:0` };
}
export async function socialVisit(t: Harness, user: Awaited<ReturnType<typeof socialUser>>, count = 2, visitedOn = '2026-09-01') {
  return t.run(async (ctx) => {
    const owner = { kind: 'account' as const, accountId: user.accountId };
    const venueId = await seedMuseum(ctx);
    const visitId = await seedJournalVisit(ctx, user.deviceId, venueId, { owner, visitedOn, reflection: 'PRIVATE REFLECTION' });
    const visit = (await ctx.db.get(visitId))!;
    const saves = [];
    for (let i = 0; i < count; i++) {
      const localId = crypto.randomUUID();
      const id = await ctx.db.insert('collections', { owner, localId, visitId, visitLocalId: visit.localId, venueId,
        savedAt: i, snapshot: { title: `Work ${i}`, artist: 'Artist', institution: 'PRIVATE SOURCE' }, note: 'PRIVATE NOTE',
        updatedAt: 1, updatedBy: user.deviceId, changeVersion: i + 2 });
      saves.push({ id, localId });
    }
    return { visit, saves, selection: { audience: 'friends' as const, visitLocalId: visit.localId, saveLocalIds: saves.map((s) => s.localId), reflection: '', revision: 0 } };
  });
}
export async function befriend(a: SocialUser, b: SocialUser): Promise<void> {
  const state = await a.as.query(api.friendships.getState, { profileId: b.profileId });
  const requested = await a.as.mutation(api.friendships.request, { profileId: b.profileId, revision: state.revision });
  await b.as.mutation(api.friendships.accept, { profileId: a.profileId, revision: requested.revision });
}
export async function socialDerivative(t: Harness, user: SocialUser, saveId: Id<'collections'>) {
  return t.run(async (ctx) => {
    const save = (await ctx.db.get(saveId))!;
    const scanId = await seedScan(ctx, { deviceId: user.deviceId, venueId: save.venueId });
    const sourceStorageId = await ctx.storage.store(new Blob(['source crop'], { type: 'image/jpeg' }));
    const contributionId = await seedContribution(ctx, { deviceId: user.deviceId, scanId, venueId: save.venueId!, cropStorageId: sourceStorageId });
    await ctx.db.patch(saveId, { scanId });
    const storageId = await ctx.storage.store(new Blob(['derivative bytes'], { type: 'image/jpeg' }));
    const provenance = { kind: 'contribution' as const, contributionId, sourceStorageId };
    const id = await ctx.db.insert('mediaAssets', { saveId, storageId, provenance, createdAt: 1,
      source: { kind: 'derivative', rights: 'contributor_consent', width: 128, height: 256 } });
    return { id, storageId, provenance, contributionId, sourceStorageId };
  });
}

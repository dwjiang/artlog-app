import { ConvexError, v } from 'convex/values';

import { stableStringify } from '../shared/stable-stringify';
import { mutation, query } from './_generated/server';
import { requireAttestedWrite } from './devices';
import { requireDevice } from './lib/auth';

const MAX_DEVICES = 20;

export const linkAccount = mutation({
  args: { appleUserId: v.string(), nonce: v.string(), assertionBase64: v.string() },
  returns: v.id('accounts'),
  handler: async (ctx, { appleUserId, ...assertion }) => {
    const device = await requireAttestedWrite(ctx, {
      ...assertion, payload: stableStringify({ action: 'linkAccount', appleUserId }),
    });
    const existing = await ctx.db.query('accounts')
      .withIndex('by_appleUserId', (q) => q.eq('appleUserId', appleUserId)).unique();
    if (device.accountId === existing?._id && existing) return existing._id;
    if (device.accountId) throw new ConvexError({ code: 'already_linked' });
    const proof = device.appleLinkProof;
    if (!proof || proof.sub !== appleUserId || proof.expiresAt <= Date.now()) {
      throw new ConvexError({ code: 'apple_sign_in_required' });
    }
    const deviceIds = [...new Set([...(existing?.deviceIds ?? []), device._id])];
    if (deviceIds.length > MAX_DEVICES) throw new ConvexError({ code: 'account_device_limit' });
    const accountId = existing?._id ?? await ctx.db.insert('accounts', {
      appleUserId, email: proof.email, deviceIds, createdAt: Date.now(),
    });
    if (existing) await ctx.db.patch(existing._id, { deviceIds, ...(proof.email ? { email: proof.email } : {}) });
    const members = await Promise.all(deviceIds.map((id) => ctx.db.get(id)));
    const trustWeight = Math.max(...members.map((member) => member?.trustWeight ?? 0));
    for (const member of members) {
      if (member) await ctx.db.patch(member._id, { trustWeight });
    }
    await ctx.db.patch(device._id, { accountId, appleLinkProof: undefined });
    return accountId;
  },
});

export const unlink = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    if (account) await ctx.db.patch(account._id, { deviceIds: account.deviceIds.filter((id) => id !== device._id) });
    await ctx.db.patch(device._id, { accountId: undefined, appleLinkProof: undefined });
    return null;
  },
});

export const deleteAccount = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    if (!account) return null;
    for (const id of account.deviceIds) {
      const member = await ctx.db.get(id);
      if (member?.accountId === account._id) await ctx.db.patch(id, { accountId: undefined, appleLinkProof: undefined });
    }
    const authAccount = await ctx.db.query('authAccounts')
      .withIndex('providerAndAccountId', (q) => q.eq('provider', 'apple-native').eq('providerAccountId', account.appleUserId)).unique();
    if (authAccount) await ctx.db.delete(authAccount._id);
    await ctx.db.delete(account._id);
    return null;
  },
});

export const me = query({
  args: {},
  returns: v.object({ linked: v.boolean(), deviceCount: v.number(), accountId: v.union(v.id('accounts'), v.null()), email: v.union(v.string(), v.null()), scope: v.string() }),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    return {
      linked: !!account, deviceCount: account?.deviceIds.length ?? 0,
      accountId: account?._id ?? null, email: account?.email ?? null,
      scope: account ? `${account._id}:${account.deviceIds.slice().sort().join(',')}` : device._id,
    };
  },
});

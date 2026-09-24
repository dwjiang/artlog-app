import { ConvexError, v } from "convex/values";

import { stableStringify } from "../shared/attestation/stable-stringify";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAttestedWrite } from "./devices";
import { requireDevice } from "./lib/auth";
import { deleteUnreferencedCollectionPhotos } from "./lib/collectionPhotos";
import { deviceScope, ownerForDevice, requireClaimComplete } from "./lib/ownership";
import { purgeSaveMediaBatch, purgeSocialBatch } from "./lib/socialCleanup";

const MAX_DEVICES = 20;
const PURGE_BATCH = 50;

export const linkAccount = mutation({
  args: {
    appleUserId: v.string(),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: v.id("accounts"),
  handler: async (ctx, { appleUserId, ...assertion }) => {
    const device = await requireAttestedWrite(ctx, {
      ...assertion,
      payload: stableStringify({ action: "linkAccount", appleUserId }),
    });
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_appleUserId", (q) => q.eq("appleUserId", appleUserId))
      .unique();
    if (device.accountId === existing?._id && existing) return existing._id;
    if (device.accountId) throw new ConvexError({ code: "already_linked" });
    const proof = device.appleLinkProof;
    if (!proof || proof.sub !== appleUserId || proof.expiresAt <= Date.now()) {
      throw new ConvexError({ code: "apple_sign_in_required" });
    }
    const deviceIds = [...new Set([...(existing?.deviceIds ?? []), device._id])];
    if (deviceIds.length > MAX_DEVICES) {
      throw new ConvexError({ code: "account_device_limit" });
    }
    const accountId =
      existing?._id
      ?? (await ctx.db.insert("accounts", {
        appleUserId,
        email: proof.email,
        deviceIds,
        createdAt: Date.now(),
      }));
    if (existing) {
      await ctx.db.patch(existing._id, {
        deviceIds,
        ...(proof.email ? { email: proof.email } : {}),
      });
    }
    const members = await Promise.all(deviceIds.map((id) => ctx.db.get(id)));
    const trustWeight = Math.max(...members.map((member) => member?.trustWeight ?? 0));
    for (const member of members) {
      if (member) await ctx.db.patch(member._id, { trustWeight });
    }
    const claim = await ctx.db
      .query("journalClaims")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    if (claim && claim.phase !== "complete" && claim.accountId !== accountId) {
      throw new ConvexError({ code: "claim_required" });
    }
    if (!claim || claim.phase === "complete") {
      const fields = {
        deviceId: device._id,
        accountId,
        phase: "visits" as const,
        createdAt: Date.now(),
      };
      if (claim) await ctx.db.delete(claim._id);
      await ctx.db.insert("journalClaims", fields);
    }
    await ctx.db.patch(device._id, {
      accountId,
      appleLinkProof: undefined,
      scopeRevision: (device.scopeRevision ?? 0) + 1,
    });
    return accountId;
  },
});

export const unlink = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    await requireClaimComplete(ctx, device._id);
    const claim = await ctx.db
      .query("journalClaims")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    if (claim) await ctx.db.delete(claim._id);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    if (account) {
      await ctx.db.patch(account._id, {
        deviceIds: account.deviceIds.filter((id) => id !== device._id),
      });
    }
    await ctx.db.patch(device._id, {
      accountId: undefined,
      appleLinkProof: undefined,
      scopeRevision: (device.scopeRevision ?? 0) + 1,
    });
    return null;
  },
});

export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    if (!account) return null;
    const claims = await ctx.db
      .query("journalClaims")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .collect();
    if (claims.some((claim) => claim.phase !== "complete")) {
      throw new ConvexError({ code: "claim_required" });
    }
    for (const id of account.deviceIds) {
      const member = await ctx.db.get(id);
      if (member?.accountId === account._id) {
        await ctx.db.patch(id, {
          accountId: undefined,
          appleLinkProof: undefined,
          scopeRevision: (member.scopeRevision ?? 0) + 1,
        });
      }
    }
    const authAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "apple-native").eq("providerAccountId", account.appleUserId),
      )
      .unique();
    if (authAccount) await ctx.db.delete(authAccount._id);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, { active: false, publishedWallCount: 0 });
    }
    for (const claim of claims) await ctx.db.delete(claim._id);
    await ctx.db.delete(account._id);
    await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, {
      accountId: account._id,
    });
    return null;
  },
});

// Nothing resolves to a deleted account again, so its private journal and photos are removed in batches.
export const purgeJournal = internalMutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    if (await ctx.db.get(accountId)) return null;
    if (await purgeSocialBatch(ctx, accountId)) {
      await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, {
        accountId,
      });
      return null;
    }
    const owner = { kind: "account" as const, accountId };
    const saves = await ctx.db
      .query("collections")
      .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
      .take(PURGE_BATCH);
    for (const save of saves) {
      if (await purgeSaveMediaBatch(ctx, save._id)) {
        await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, {
          accountId,
        });
        return null;
      }
      await ctx.db.delete(save._id);
      await deleteUnreferencedCollectionPhotos(ctx, save);
    }
    const visits =
      saves.length < PURGE_BATCH
        ? await ctx.db
            .query("visits")
            .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
            .take(PURGE_BATCH - saves.length)
        : [];
    for (const visit of visits) await ctx.db.delete(visit._id);
    if (saves.length + visits.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, {
        accountId,
      });
      return null;
    }
    const state = await ctx.db
      .query("journalSyncState")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .unique();
    if (state) await ctx.db.delete(state._id);
    return null;
  },
});

export const me = query({
  args: {},
  returns: v.object({
    linked: v.boolean(),
    deviceCount: v.number(),
    accountId: v.union(v.id("accounts"), v.null()),
    email: v.union(v.string(), v.null()),
    scope: v.string(),
  }),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get(device.accountId) : null;
    return {
      linked: !!account,
      deviceCount: account?.deviceIds.length ?? 0,
      accountId: account?._id ?? null,
      email: account?.email ?? null,
      scope: deviceScope(device, await ownerForDevice(ctx, device)),
    };
  },
});

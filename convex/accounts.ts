import { ConvexError, v } from "convex/values";

import { stableStringify } from "../shared/attestation/stable-stringify";
import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import { requireAttestedWrite } from "./devices";
import { internalMutation, mutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { deleteUnreferencedCollectionPhotos } from "./lib/collectionPhotos";
import { deviceScope, ownerForDevice, requireClaimComplete } from "./lib/ownership";
import { deleteSavedRecognition } from "./lib/savedRecognition";
import { purgeSaveMediaBatch, purgeSocialBatch } from "./lib/socialCleanup";
import { accountProvider } from "./lib/validators";

const MAX_DEVICES = 20;
const PURGE_BATCH = 50;

export const linkAccount = mutation({
  args: {
    provider: accountProvider,
    providerUserId: v.string(),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: v.id("accounts"),
  handler: async (ctx, { provider, providerUserId, ...assertion }) => {
    const device = await requireAttestedWrite(ctx, {
      ...assertion,
      payload: stableStringify({ action: "linkAccount", provider, providerUserId }),
    });
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_provider_userId", (q) => q.eq("provider", provider).eq("providerUserId", providerUserId))
      .unique();
    if (device.accountId === existing?._id && existing) return existing._id;
    if (device.accountId) throw new ConvexError({ code: "already_linked" });
    const proof = device.accountLinkProof;
    if (!proof || proof.provider !== provider || proof.sub !== providerUserId || proof.expiresAt <= Date.now()) {
      throw new ConvexError({ code: "sign_in_required" });
    }
    const members = existing
      ? await ctx.db
          .query("devices")
          .withIndex("by_accountId", (q) => q.eq("accountId", existing._id))
          .take(MAX_DEVICES)
      : [];
    members.push(device);
    if (members.length > MAX_DEVICES) {
      throw new ConvexError({ code: "account_device_limit" });
    }
    const accountId =
      existing?._id
      ?? (await ctx.db.insert("accounts", {
        provider,
        providerUserId,
        email: proof.email,
      }));
    if (existing && proof.email) await ctx.db.patch("accounts", existing._id, { email: proof.email });
    const trustWeight = Math.max(...members.map((member) => member.trustWeight));
    for (const member of members) {
      await ctx.db.patch("devices", member._id, { trustWeight });
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
      };
      if (claim) await ctx.db.delete("journalClaims", claim._id);
      await ctx.db.insert("journalClaims", fields);
    }
    await ctx.db.patch("devices", device._id, {
      accountId,
      accountLinkProof: undefined,
      scopeRevision: device.scopeRevision + 1,
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
    if (claim) await ctx.db.delete("journalClaims", claim._id);
    await ctx.db.patch("devices", device._id, {
      accountId: undefined,
      accountLinkProof: undefined,
      scopeRevision: device.scopeRevision + 1,
    });
    return null;
  },
});

export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get("accounts", device.accountId) : null;
    if (!account) return null;
    const claims = await ctx.db
      .query("journalClaims")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .collect();
    if (claims.some((claim) => claim.phase !== "complete")) {
      throw new ConvexError({ code: "claim_required" });
    }
    for (const member of await ctx.db
      .query("devices")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(MAX_DEVICES)) {
      const id = member._id;
      if (member?.accountId === account._id) {
        await ctx.db.patch("devices", id, {
          accountId: undefined,
          accountLinkProof: undefined,
          scopeRevision: member.scopeRevision + 1,
        });
      }
    }
    const authAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", `${account.provider}-native`).eq("providerAccountId", account.providerUserId),
      )
      .unique();
    if (authAccount) await ctx.db.delete("authAccounts", authAccount._id);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .unique();
    if (profile) {
      await ctx.db.patch("profiles", profile._id, { active: false, publishedWallCount: 0 });
    }
    for (const claim of claims) await ctx.db.delete("journalClaims", claim._id);
    await ctx.db.delete("accounts", account._id);
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
    if (await ctx.db.get("accounts", accountId)) return null;
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
      await deleteSavedRecognition(ctx, save._id);
      await ctx.db.delete("collections", save._id);
      await deleteUnreferencedCollectionPhotos(ctx, save);
    }
    const visits =
      saves.length < PURGE_BATCH
        ? await ctx.db
            .query("visits")
            .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
            .take(PURGE_BATCH - saves.length)
        : [];
    for (const visit of visits) await ctx.db.delete("visits", visit._id);
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
    if (state) await ctx.db.delete("journalSyncState", state._id);
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
    hasProfile: v.boolean(),
    scope: v.string(),
  }),
  handler: async (ctx) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get("accounts", device.accountId) : null;
    const profile = account
      ? await ctx.db
          .query("profiles")
          .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
          .unique()
      : null;
    return {
      linked: !!account,
      deviceCount: account
        ? (
            await ctx.db
              .query("devices")
              .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
              .take(MAX_DEVICES)
          ).length
        : 0,
      accountId: account?._id ?? null,
      email: account?.email ?? null,
      hasProfile: !!profile,
      scope: deviceScope(device, await ownerForDevice(ctx, device)),
    };
  },
});

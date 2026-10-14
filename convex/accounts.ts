import { ConvexError, v } from "convex/values";

import { stableStringify } from "../shared/attestation/stable-stringify";
import type { JournalOwner } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, query, type MutationCtx } from "./_generated/server";
import { withdrawContributionCrop } from "./contributionRemoval";
import { requireAttestedWrite } from "./devices";
import { internalMutation, mutation } from "./functions";
import { revokeAppleAuthorization } from "./lib/appleRevocation";
import { requireDevice } from "./lib/auth";
import { deleteUnreferencedCollectionPhotos, deleteUnreferencedPhoto } from "./lib/collectionPhotos";
import { deleteAuthAccountBatch, retireDevice } from "./lib/deviceRetirement";
import { withErrorReporting } from "./lib/observability";
import {
  deviceScope,
  isClaimComplete,
  isUsableProfile,
  ownerForDevice,
  requireAccount,
  requireClaimComplete,
} from "./lib/ownership";
import { deleteSavedRecognition } from "./lib/savedRecognition";
import { clearAttributionBatch, purgeSaveMediaBatch, purgeSocialBatch } from "./lib/socialCleanup";
import { accountProvider } from "./lib/validators";

export const MAX_DEVICES = 20;
const PURGE_BATCH = 50;
// Each withdrawal can revoke media and queue an entry rebuild, so these batches stay small.
const CONTRIBUTION_BATCH = 20;

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
  args: { appleAuthorizationCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { appleAuthorizationCode }) => {
    const device = await requireDevice(ctx);
    const account = device.accountId ? await ctx.db.get("accounts", device.accountId) : null;
    // A guest's automatically created identity is its account.
    if (!account) {
      await retireDevice(ctx, device);
      return null;
    }
    const claims = await ctx.db
      .query("journalClaims")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .collect();
    if (claims.some((claim) => claim.phase !== "complete")) {
      throw new ConvexError({ code: "claim_required" });
    }
    for (const claim of claims) await ctx.db.delete("journalClaims", claim._id);
    for (const member of await ctx.db
      .query("devices")
      .withIndex("by_accountId", (q) => q.eq("accountId", account._id))
      .take(MAX_DEVICES)) {
      await retireDevice(ctx, member);
    }
    // The association belongs to the first device that signed in, which may have left the account since.
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
    await ctx.db.delete("accounts", account._id);
    await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, {
      accountId: account._id,
    });
    if (account.provider === "apple" && appleAuthorizationCode) {
      await ctx.scheduler.runAfter(0, internal.accounts.revokeApple, {
        authorizationCode: appleAuthorizationCode,
        appleUserId: account.providerUserId,
      });
    }
    return null;
  },
});

// Deletion has already committed, so a failed revocation only leaves a failed job and, on production, a Sentry event.
export const revokeApple = internalAction({
  args: { authorizationCode: v.string(), appleUserId: v.string() },
  returns: v.null(),
  handler: async (_ctx, { authorizationCode, appleUserId }) => {
    await withErrorReporting("accounts.revoke_apple", () => revokeAppleAuthorization(authorizationCode, appleUserId));
    return null;
  },
});

// Nothing resolves to a deleted account again, so its private journal and photos are removed in batches.
export const purgeJournal = internalMutation({
  args: { accountId: v.id("accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    if (await ctx.db.get("accounts", accountId)) return null;
    if ((await purgeSocialBatch(ctx, accountId)) || (await purgeJournalBatch(ctx, { kind: "account", accountId }))) {
      await ctx.scheduler.runAfter(0, internal.accounts.purgeJournal, { accountId });
    }
    return null;
  },
});

export const purgeRetiredDevice = internalMutation({
  args: {
    deviceId: v.id("devices"),
    userId: v.optional(v.id("users")),
    phase: v.union(v.literal("sessions"), v.literal("contributions"), v.literal("journal"), v.literal("attribution")),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await ctx.db.get("devices", args.deviceId);
    if (device?.retiredAt === undefined) return null;
    const owner = { kind: "device" as const, deviceId: device._id };
    const next = (phase: typeof args.phase, cursor?: string) =>
      ctx.scheduler.runAfter(0, internal.accounts.purgeRetiredDevice, { ...args, phase, cursor });
    switch (args.phase) {
      case "sessions":
        await next(args.userId && (await deleteAuthBatch(ctx, args.userId)) ? "sessions" : "contributions");
        return null;
      // Crops other visitors can see go before the private journal.
      case "contributions": {
        const page = await ctx.db
          .query("contributions")
          .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
          .paginate({ cursor: args.cursor ?? null, numItems: CONTRIBUTION_BATCH });
        for (const row of page.page) await withdrawContributionCrop(ctx, row);
        await (page.isDone ? next("journal") : next("contributions", page.continueCursor));
        return null;
      }
      case "journal":
        await next((await purgeJournalBatch(ctx, owner)) ? "journal" : "attribution");
        return null;
      case "attribution":
        if (await clearAttributionBatch(ctx, owner)) await next("attribution");
        return null;
    }
  },
});

// True while rows remain. A retired user's leftover sessions could otherwise still mint tokens for it.
async function deleteAuthBatch(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  if (await deleteAuthAccountBatch(ctx, userId)) return true;
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .take(PURGE_BATCH);
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .take(PURGE_BATCH);
    for (const token of tokens) await ctx.db.delete("authRefreshTokens", token._id);
    if (tokens.length === PURGE_BATCH) return true;
    await ctx.db.delete("authSessions", session._id);
  }
  return sessions.length === PURGE_BATCH;
}

// True while rows remain. Saves go first so their media and recognition archives leave with them.
async function purgeJournalBatch(ctx: MutationCtx, owner: JournalOwner): Promise<boolean> {
  const saves = await ctx.db
    .query("collections")
    .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
    .take(PURGE_BATCH);
  for (const save of saves) {
    if (await purgeSaveMediaBatch(ctx, save._id)) return true;
    await deleteSavedRecognition(ctx, save._id);
    await ctx.db.delete("collections", save._id);
    await deleteUnreferencedCollectionPhotos(ctx, save);
  }
  if (saves.length === PURGE_BATCH) return true;
  // A journal claim moves only live album rows, so deleted ones stay with the device that made them.
  const photos = await ctx.db
    .query("artworkPhotos")
    .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
    .take(PURGE_BATCH);
  for (const photo of photos) {
    await ctx.db.delete("artworkPhotos", photo._id);
    if (photo.storageId) await deleteUnreferencedPhoto(ctx, photo.storageId);
  }
  const encounters = await ctx.db
    .query("artworkEncounters")
    .withIndex("by_owner_changeVersion", (q) => q.eq("owner", owner))
    .take(PURGE_BATCH);
  for (const encounter of encounters) await ctx.db.delete("artworkEncounters", encounter._id);
  if (photos.length === PURGE_BATCH || encounters.length === PURGE_BATCH) return true;
  const visits = await ctx.db
    .query("visits")
    .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
    .take(PURGE_BATCH);
  for (const visit of visits) await ctx.db.delete("visits", visit._id);
  if (visits.length === PURGE_BATCH) return true;
  const exhibitionSaves = await ctx.db
    .query("exhibitionSaves")
    .withIndex("by_owner_savedAt", (q) => q.eq("owner", owner))
    .take(PURGE_BATCH);
  for (const save of exhibitionSaves) await ctx.db.delete("exhibitionSaves", save._id);
  if (exhibitionSaves.length === PURGE_BATCH) return true;
  const state = await ctx.db
    .query("journalSyncState")
    .withIndex("by_owner", (q) => q.eq("owner", owner))
    .unique();
  if (state) await ctx.db.delete("journalSyncState", state._id);
  return false;
}

export const me = query({
  args: {},
  returns: v.object({
    linked: v.boolean(),
    deviceCount: v.number(),
    accountId: v.union(v.id("accounts"), v.null()),
    provider: v.union(accountProvider, v.null()),
    email: v.union(v.string(), v.null()),
    hasProfile: v.boolean(),
    // Null unless social reads accept the profile, so the app needs no wall read to learn it.
    profileId: v.union(v.id("profiles"), v.null()),
    // False while this device's sign-in is still moving its guest journal into the account.
    claimComplete: v.boolean(),
    safetyChecks: v.union(v.boolean(), v.null()),
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
      provider: account?.provider ?? null,
      email: account?.email ?? null,
      hasProfile: !!profile,
      profileId: isUsableProfile(profile) ? profile._id : null,
      claimComplete: await isClaimComplete(ctx, device._id),
      safetyChecks: account?.safetyChecks ?? null,
      scope: deviceScope(device, await ownerForDevice(ctx, device)),
    };
  },
});

/** `ifUnset` lets an allow given before sign-in fill an unanswered account without overriding the answer it holds. */
export const setSafetyChecks = mutation({
  args: { enabled: v.boolean(), ifUnset: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, { enabled, ifUnset }) => {
    const { accountId } = await requireAccount(ctx);
    const account = await ctx.db.get("accounts", accountId);
    if (!account) throw new ConvexError({ code: "sign_in_required" });
    if (ifUnset && account.safetyChecks !== undefined) return account.safetyChecks;
    await ctx.db.patch("accounts", accountId, { safetyChecks: enabled });
    return enabled;
  },
});

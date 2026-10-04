import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const AUTH_ACCOUNT_BATCH = 10;

export async function deleteAuthAccountBatch(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .take(AUTH_ACCOUNT_BATCH);
  for (const account of accounts) await ctx.db.delete("authAccounts", account._id);
  return accounts.length === AUTH_ACCOUNT_BATCH;
}

/**
 * Deleting data retires the phone's identity: the auth user and its sign-in records go, so the same device secret now
 * signs in as a new user, and nothing on the devices row leads back to a person. `accounts.purgeRetiredDevice` then
 * removes any remaining sign-in records, sessions, journal leftovers and contribution crops.
 */
export async function retireDevice(ctx: MutationCtx, device: Doc<"devices">): Promise<void> {
  const userId = device.authUserId;
  if (userId) {
    await deleteAuthAccountBatch(ctx, userId);
    if (await ctx.db.get("users", userId)) await ctx.db.delete("users", userId);
  }
  await ctx.db.patch("devices", device._id, {
    authUserId: undefined,
    accountId: undefined,
    accountLinkProof: undefined,
    appAttestKeyId: undefined,
    attestPublicKey: undefined,
    attestedAt: undefined,
    retiredAt: Date.now(),
    scopeRevision: device.scopeRevision + 1,
  });
  const push = await ctx.db
    .query("pushTokens")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
    .unique();
  if (push) await ctx.db.delete("pushTokens", push._id);
  const claim = await ctx.db
    .query("journalClaims")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
    .unique();
  if (claim) await ctx.db.delete("journalClaims", claim._id);
  await ctx.scheduler.runAfter(0, internal.accounts.purgeRetiredDevice, {
    deviceId: device._id,
    userId,
    phase: "sessions",
  });
}

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { type JournalOwner, ownerKey, sameOwner } from "../../shared/journal/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { findDeviceForUser, requireDevice } from "./auth";

type ReadCtx = QueryCtx | MutationCtx;
export async function ownerForDevice(ctx: ReadCtx, device: Doc<"devices">): Promise<JournalOwner> {
  if (device.accountId && (await ctx.db.get("accounts", device.accountId))) {
    return { kind: "account", accountId: device.accountId };
  }
  return { kind: "device", deviceId: device._id };
}
export const deviceScope = (device: Doc<"devices">, owner: JournalOwner) =>
  `${ownerKey(owner)}:${device.scopeRevision ?? 0}`;
export async function resolveOwner(ctx: ReadCtx, scope?: string) {
  const device = await requireDevice(ctx);
  const owner = await ownerForDevice(ctx, device);
  if (scope !== undefined && scope !== deviceScope(device, owner)) {
    throw new ConvexError({ code: "sync_scope_changed" });
  }
  return { device, owner, scope: deviceScope(device, owner) };
}
export async function requireClaimComplete(ctx: ReadCtx, deviceId: Id<"devices">): Promise<void> {
  const claim = await ctx.db
    .query("journalClaims")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
    .unique();
  if (claim && claim.phase !== "complete") {
    throw new ConvexError({ code: "claim_required" });
  }
}
export async function requireJournalOwner(ctx: ReadCtx, scope: string) {
  const resolved = await resolveOwner(ctx, scope);
  await requireClaimComplete(ctx, resolved.device._id);
  return resolved;
}
export async function requireAccount(ctx: ReadCtx) {
  const resolved = await resolveOwner(ctx);
  if (resolved.owner.kind !== "account") {
    throw new ConvexError({ code: "apple_sign_in_required" });
  }
  return { ...resolved, accountId: resolved.owner.accountId };
}
export async function requireProfile(ctx: ReadCtx) {
  const account = await requireAccount(ctx);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_accountId", (q) => q.eq("accountId", account.accountId))
    .unique();
  if (!profile?.active || profile.removal) {
    throw new ConvexError({ code: "profile_required" });
  }
  return { ...account, profile };
}
export async function activeProfile(ctx: ReadCtx, profileId: Id<"profiles">) {
  const profile = await ctx.db.get("profiles", profileId);
  return profile?.active && !profile.removal && (await ctx.db.get("accounts", profile.accountId)) ? profile : null;
}
export function findOwnedVisit(ctx: ReadCtx, owner: JournalOwner, localId: string) {
  return ctx.db
    .query("visits")
    .withIndex("by_owner_localId", (q) => q.eq("owner", owner).eq("localId", localId))
    .unique();
}
export function findOwnedSave(ctx: ReadCtx, owner: JournalOwner, localId: string) {
  return ctx.db
    .query("collections")
    .withIndex("by_owner_localId", (q) => q.eq("owner", owner).eq("localId", localId))
    .unique();
}
export async function requireOwnedVisit(ctx: ReadCtx, owner: JournalOwner, id: Id<"visits">) {
  const visit = await ctx.db.get("visits", id);
  if (!visit || !sameOwner(visit.owner, owner)) {
    throw new ConvexError({ code: "not_found" });
  }
  return visit;
}
export async function requireOwnedSave(ctx: ReadCtx, owner: JournalOwner, localId: string) {
  const save = await findOwnedSave(ctx, owner, localId);
  if (!save || save.deletedAt !== undefined) {
    throw new ConvexError({ code: "not_found" });
  }
  return save;
}
export async function requireMembership(ctx: ReadCtx, save: Doc<"collections">, visit: Doc<"visits">): Promise<void> {
  if (!sameOwner(save.owner, visit.owner)) {
    throw new ConvexError({ code: "not_found" });
  }
  const encounter = await ctx.db
    .query("artworkEncounters")
    .withIndex("by_save_visit", (q) => q.eq("saveId", save._id).eq("visitId", visit._id))
    .unique();
  if (
    encounter ? encounter.deletedAt !== undefined : save.visitId !== visit._id || save.visitLocalId !== visit.localId
  ) {
    throw new ConvexError({ code: "not_found" });
  }
}
export async function nextChangeVersion(ctx: MutationCtx, owner: JournalOwner): Promise<number> {
  const state = await ctx.db
    .query("journalSyncState")
    .withIndex("by_owner", (q) => q.eq("owner", owner))
    .unique();
  const version = (state?.version ?? 0) + 1;
  if (state) await ctx.db.patch("journalSyncState", state._id, { version });
  else await ctx.db.insert("journalSyncState", { owner, version });
  return version;
}

export async function optionalProfile(ctx: ReadCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const device = await findDeviceForUser(ctx, userId);
  if (device?.banned) throw new ConvexError({ code: "device_banned" });
  if (!device?.accountId || !(await ctx.db.get("accounts", device.accountId))) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_accountId", (q) => q.eq("accountId", device.accountId!))
    .unique();
  return profile?.active && !profile.removal ? profile : null;
}

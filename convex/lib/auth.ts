// oxlint-disable-next-line no-restricted-imports -- This module is the one reader of Convex Auth user IDs.
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { DEMO_BOT_ISSUER } from "./demoBot";

/** The signed-in Convex Auth user. The demo bot's service token names no user, so it reads as signed out. */
export async function authUserId(ctx: { auth: Auth }): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity && identity.issuer !== DEMO_BOT_ISSUER ? getAuthUserId(ctx) : null;
}

export async function requireAuthUserId(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<Id<"users">> {
  const userId = await authUserId(ctx);
  if (userId === null) throw new ConvexError({ code: "unauthenticated" });
  return userId;
}

export async function findDeviceForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"devices"> | null> {
  return ctx.db
    .query("devices")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
}

function assertUsable(device: Doc<"devices"> | null): Doc<"devices"> {
  if (!device) throw new ConvexError({ code: "device_not_registered" });
  if (device.banned) throw new ConvexError({ code: "device_banned" });
  return device;
}

export async function requireDevice(ctx: QueryCtx | MutationCtx): Promise<Doc<"devices">> {
  const userId = await requireAuthUserId(ctx);
  return assertUsable(await findDeviceForUser(ctx, userId));
}

export async function requireDeviceFromAction(ctx: ActionCtx): Promise<Doc<"devices">> {
  await requireAuthUserId(ctx);
  return assertUsable(await ctx.runQuery(internal.devices.getForCaller, {}));
}

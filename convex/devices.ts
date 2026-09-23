import { withErrorReporting } from "./lib/observability";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { appIdHash, bytesToBase64Url, verifyAssertion } from "./lib/appAttest";
import {
  findDeviceForUser,
  requireAuthUserId,
  requireDevice,
  requireDeviceFromAction,
} from "./lib/auth";
import { limitKey } from "./lib/rateLimits";
import { challengePurpose, devicePlatform } from "./lib/validators";
import schema from "./schema";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const NEW_DEVICE_TRUST_WEIGHT = 0.5;

const deviceDoc = v.object({
  _id: v.id("devices"),
  _creationTime: v.number(),
  ...schema.tables.devices.validator.fields,
});

function attestRequired(): boolean {
  return process.env.APP_ATTEST_REQUIRED === "true";
}

function isAttested(device: Doc<"devices">, keyId?: string): boolean {
  if (device.attestedAt === undefined || device.attestPublicKey === undefined) return false;
  return keyId === undefined || keyId === device.appAttestKeyId;
}

export const registerDevice = mutation({
  args: { platform: devicePlatform, appAttestKeyId: v.optional(v.string()) },
  returns: v.object({
    deviceId: v.id("devices"),
    attested: v.boolean(),
    attestRequired: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    await limitKey(ctx, "registerDevice", userId);
    const existing = await findDeviceForUser(ctx, userId);
    if (existing) {
      if (existing.banned) throw new ConvexError({ code: "device_banned" });
      return {
        deviceId: existing._id,
        attested: isAttested(existing, args.appAttestKeyId),
        attestRequired: attestRequired(),
      };
    }
    const deviceId = await ctx.db.insert("devices", {
      authUserId: userId,
      firstSeenAt: Date.now(),
      trustWeight: NEW_DEVICE_TRUST_WEIGHT,
      banned: false,
      platform: args.platform,
      attestCounter: 0,
    });
    return { deviceId, attested: false, attestRequired: attestRequired() };
  },
});

export const getForCaller = internalQuery({
  args: {},
  returns: v.union(deviceDoc, v.null()),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    return findDeviceForUser(ctx, userId);
  },
});

export const me = query({
  args: {},
  returns: v.union(
    v.object({ deviceId: v.id("devices"), attested: v.boolean(), trustWeight: v.number() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const device = await findDeviceForUser(ctx, userId);
    if (!device) return null;
    if (device.banned) throw new ConvexError({ code: "device_banned" });
    return { deviceId: device._id, attested: isAttested(device), trustWeight: device.trustWeight };
  },
});

export const createChallenge = mutation({
  args: { purpose: challengePurpose },
  returns: v.object({ nonce: v.string() }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    await limitKey(ctx, "attestChallenge", device.authUserId ?? device._id);
    const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    await ctx.db.insert("attestChallenges", {
      deviceId: device._id,
      authUserId: device.authUserId ?? "",
      nonce,
      purpose: args.purpose,
      createdAt: Date.now(),
    });
    return { nonce };
  },
});

export async function consumeChallenge(
  ctx: MutationCtx,
  device: Doc<"devices">,
  nonce: string,
  purpose: "attest" | "assert" | "apple",
): Promise<void> {
  const now = Date.now();
  const challenge = await ctx.db
    .query("attestChallenges")
    .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
    .unique();
  const valid =
    challenge !== null &&
    challenge.deviceId === device._id &&
    challenge.authUserId === device.authUserId &&
    challenge.purpose === purpose &&
    challenge.usedAt === undefined &&
    now >= challenge.createdAt &&
    now - challenge.createdAt < CHALLENGE_TTL_MS;
  if (!valid) throw new ConvexError({ code: "challenge_invalid" });
  await ctx.db.patch(challenge._id, { usedAt: now });
}

export const takeChallenge = internalMutation({
  args: { nonce: v.string(), purpose: challengePurpose },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    await consumeChallenge(ctx, device, args.nonce, args.purpose);
    return null;
  },
});

export const markAttested = internalMutation({
  args: {
    deviceId: v.id("devices"),
    keyId: v.string(),
    publicKeySpkiBase64: v.string(),
    counter: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    if (device._id !== args.deviceId) throw new ConvexError({ code: "device_not_registered" });
    if (isAttested(device)) throw new ConvexError({ code: "device_already_attested" });
    const keyOwner = await ctx.db
      .query("devices")
      .withIndex("by_keyId", (q) => q.eq("appAttestKeyId", args.keyId))
      .unique();
    if (keyOwner) throw new ConvexError({ code: "key_already_registered" });
    await ctx.db.patch(args.deviceId, {
      appAttestKeyId: args.keyId,
      attestPublicKey: args.publicKeySpkiBase64,
      attestCounter: args.counter,
      attestedAt: Date.now(),
    });
    return null;
  },
});

export const attestDevice = action({
  args: { keyId: v.string(), attestationBase64: v.string(), nonce: v.string() },
  returns: v.object({ deviceId: v.id("devices") }),
  handler: async (ctx, args) =>
    withErrorReporting("devices.attestDevice", async () => {
      const device = await requireDeviceFromAction(ctx);
      if (isAttested(device)) throw new ConvexError({ code: "device_already_attested" });
      if (!process.env.APP_ATTEST_APP_ID) throw new ConvexError({ code: "attest_unconfigured" });
      // The challenge is spent before verification so a failed attempt cannot be retried with the same nonce.
      await ctx.runMutation(internal.devices.takeChallenge, {
        nonce: args.nonce,
        purpose: "attest",
      });
      const result = await ctx.runAction(internal.appAttestNode.verifyAttestation, {
        attestationBase64: args.attestationBase64,
        keyId: args.keyId,
        challenge: args.nonce,
      });
      if (!result.ok || result.publicKeySpkiBase64 === undefined) {
        const code =
          result.reason === "keyId does not match" ? "key_mismatch" : "invalid_attestation";
        throw new ConvexError({ code, reason: result.reason });
      }
      await ctx.runMutation(internal.devices.markAttested, {
        deviceId: device._id,
        keyId: args.keyId,
        publicKeySpkiBase64: result.publicKeySpkiBase64,
        counter: result.counter ?? 0,
      });
      return { deviceId: device._id };
    }),
});

export type AttestedWriteArgs = { nonce: string; assertionBase64: string; payload: string };

/**
 * Shared-state mutations call this first. The phone signs `nonce + "." + payload`; a
 * verified assertion consumes the challenge and advances the device counter. Simulator builds skip
 * the signature check while APP_ATTEST_REQUIRED is not "true".
 */
export async function requireAttestedWrite(
  ctx: MutationCtx,
  args: AttestedWriteArgs,
): Promise<Doc<"devices">> {
  const device = await requireDevice(ctx);
  await consumeChallenge(ctx, device, args.nonce, "assert");
  if (!attestRequired() && device.platform === "simulator") return device;
  if (device.attestPublicKey === undefined) throw new ConvexError({ code: "device_not_attested" });
  const appId = process.env.APP_ATTEST_APP_ID;
  if (!appId) throw new ConvexError({ code: "attest_unconfigured" });
  const result = await verifyAssertion({
    publicKeySpkiBase64: device.attestPublicKey,
    clientData: `${args.nonce}.${args.payload}`,
    assertionBase64: args.assertionBase64,
    expectedRpIdHash: await appIdHash(appId),
    previousCounter: device.attestCounter,
  });
  if (!result.ok) throw new ConvexError({ code: "invalid_assertion", reason: result.reason });
  await ctx.db.patch(device._id, { attestCounter: result.counter });
  return { ...device, attestCounter: result.counter };
}

// Verification-only endpoint for the phone smoke check; remove before release.
export const assertSmoke = mutation({
  args: { nonce: v.string(), assertionBase64: v.string(), payloadJson: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const device = await requireDevice(ctx);
    if (device.platform !== "ios" || !isAttested(device)) return { ok: false };
    try {
      await requireAttestedWrite(ctx, { ...args, payload: args.payloadJson });
      return { ok: true };
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data.code === "challenge_invalid" || error.data.code === "invalid_assertion")
      ) {
        return { ok: false };
      }
      throw error;
    }
  },
});

export type DeviceId = Id<"devices">;

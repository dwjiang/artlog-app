"use node";

import { v } from "convex/values";
import { verifyAttestation as verifyAppleAttestation } from "node-app-attest";

import { internalAction, env } from "./_generated/server";
import { base64ToBytes } from "./lib/appAttest";
import { attestationFailureReason } from "./lib/attestationFailure";

function pemToBase64(pem: string): string {
  return pem.replaceAll(/-----[A-Z ]+-----/g, "").replaceAll(/\s+/g, "");
}

// Apple's nine attestation checks (certificate chain, nonce, key id, App ID, counter, aaguid, credential id)
// run in the Node runtime because they need X.509 chain validation; `challenge` is the raw nonce the
// phone hashed with SHA-256 when it called attestKey.
export const verifyAttestation = internalAction({
  args: {
    attestationBase64: v.string(),
    keyId: v.string(),
    challenge: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    publicKeySpkiBase64: v.optional(v.string()),
    counter: v.optional(v.number()),
    reason: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const appId = env.APP_ATTEST_APP_ID;
    if (!appId || !appId.includes(".")) {
      return { ok: false, reason: "unconfigured" };
    }
    const dot = appId.indexOf(".");
    const teamIdentifier = appId.slice(0, dot);
    const bundleIdentifier = appId.slice(dot + 1);
    try {
      const result = verifyAppleAttestation({
        attestation: base64ToBytes(args.attestationBase64),
        challenge: args.challenge,
        keyId: args.keyId,
        bundleIdentifier,
        teamIdentifier,
        allowDevelopmentEnvironment: env.APP_ATTEST_ALLOW_DEV === "true",
      });
      return {
        ok: true,
        publicKeySpkiBase64: pemToBase64(String(result.publicKey)),
        counter: 0,
      };
    } catch (error) {
      return {
        ok: false,
        reason: attestationFailureReason(error instanceof Error ? error.message : String(error)),
      };
    }
  },
});

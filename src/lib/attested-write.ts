import { ConvexError } from "convex/values";
import * as Device from "expo-device";

import { APP_ATTEST_KEY_ID, getAppAttest } from "@/lib/app-attest";
import { convex } from "@/lib/convex-client";
import { installationStorage } from "@/lib/installation-storage";
import { stableStringify } from "@/shared/attestation/stable-stringify";

import { api } from "../../convex/_generated/api";

export type SignedPayload = {
  nonce: string;
  assertionBase64: string;
  payloadJson: string;
};

/** False on Macs, which never support App Attest, including iPhone apps on Apple silicon. */
export function canAttest(): boolean {
  return getAppAttest() !== null || !Device.isDevice;
}

/**
 * Signs an attested write; `null` when this device cannot attest. Simulators get a challenge with an
 * empty assertion, which the server accepts only for simulator devices while attestation is optional.
 * A string is signed as-is so the builders in `shared/attestation/attested-payloads.ts` produce the server's exact bytes.
 */
export async function signPayload(payload: object | string): Promise<SignedPayload | null> {
  if (!canAttest()) return null;
  const appAttest = getAppAttest();

  const payloadJson = typeof payload === "string" ? payload : stableStringify(payload);
  if (!appAttest) {
    const { nonce } = await convex.mutation(api.devices.createChallenge, {
      purpose: "assert",
    });
    return { nonce, assertionBase64: "", payloadJson };
  }
  const keyId = await installationStorage.getItem(APP_ATTEST_KEY_ID);
  if (keyId === null) throw new ConvexError({ code: "device_not_attested" });
  const { nonce } = await convex.mutation(api.devices.createChallenge, {
    purpose: "assert",
  });
  const assertionBase64 = await appAttest.generateAssertion(keyId, `${nonce}.${payloadJson}`);
  return { nonce, assertionBase64, payloadJson };
}

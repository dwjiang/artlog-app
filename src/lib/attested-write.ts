import * as Device from "expo-device";

import { api } from "../../convex/_generated/api";
import { stableStringify } from "../../shared/attestation/stable-stringify";

import { APP_ATTEST_KEY_ID, getAppAttest } from "@/lib/app-attest";
import { convex } from "@/lib/convex-client";
import { installationStorage } from "@/lib/installation-storage";

export type SignedPayload = {
  nonce: string;
  assertionBase64: string;
  payloadJson: string;
};

/**
 * Signs an attested write; `null` when this device cannot attest. Simulators get a challenge with an
 * empty assertion, which the server accepts only for simulator devices while attestation is optional.
 * A string is signed as-is so the builders in `shared/attestation/attested-payloads.ts` produce the server's exact bytes.
 */
export async function signPayload(payload: object | string): Promise<SignedPayload | null> {
  const appAttest = getAppAttest();
  if (!appAttest && Device.isDevice) return null;

  const payloadJson = typeof payload === "string" ? payload : stableStringify(payload);
  if (!appAttest) {
    const { nonce } = await convex.mutation(api.devices.createChallenge, {
      purpose: "assert",
    });
    return { nonce, assertionBase64: "", payloadJson };
  }
  const keyId = await installationStorage.getItem(APP_ATTEST_KEY_ID);
  if (keyId === null) throw new Error("Device attestation is not ready");
  const { nonce } = await convex.mutation(api.devices.createChallenge, {
    purpose: "assert",
  });
  const assertionBase64 = await appAttest.generateAssertion(keyId, `${nonce}.${payloadJson}`);
  return { nonce, assertionBase64, payloadJson };
}

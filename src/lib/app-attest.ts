import * as AppIntegrity from "@expo/app-integrity";

export const APP_ATTEST_KEY_ID = "appAttestKeyId";

export type AppAttest = {
  isSupported(): boolean;
  generateKey(): Promise<string>;
  /** Returns the base64 attestation object for `challenge`, hashed with SHA-256 on the device. */
  attestKey(keyId: string, challenge: string): Promise<string>;
  /** Returns the base64 assertion over `challenge`, hashed with SHA-256 on the device. */
  generateAssertion(keyId: string, challenge: string): Promise<string>;
};

export function getAppAttest(): AppAttest | null {
  if (!AppIntegrity.isSupported) return null;
  return {
    isSupported: () => true,
    generateKey: AppIntegrity.generateKeyAsync,
    attestKey: AppIntegrity.attestKeyAsync,
    generateAssertion: AppIntegrity.generateAssertionAsync,
  };
}

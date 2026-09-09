export type AppAttest = {
  isSupported(): boolean;
  generateKey(): Promise<string>;
  /** Returns the base64 attestation object for `challenge`, hashed with SHA-256 on the device. */
  attestKey(keyId: string, challenge: string): Promise<string>;
  /** Returns the base64 assertion over `challenge`, hashed with SHA-256 on the device. */
  generateAssertion(keyId: string, challenge: string): Promise<string>;
};

// Implemented with @expo/app-integrity in docs/plans/03-on-device/07-app-attest-module.md;
// until then no build can attest and shared-state writes rely on the server's simulator bypass.
export function getAppAttest(): AppAttest | null {
  return null;
}

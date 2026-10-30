// node-app-attest explains a rejection in free text; only this fixed reason leaves the verifier.
const REASONS: [RegExp, string][] = [
  [/^appId does not match$/, "app_id"],
  [/^development environment is not allowed$/, "environment"],
  [/^aaguid is not valid$/, "aaguid"],
  [/certificate|CA /, "cert_chain"],
  [/^nonce does not match$/, "nonce"],
  [/^keyId does not match$/, "key_id"],
  [/^credentialId does not match$/, "credential_id"],
  [/^(invalid attestation|number of decoded attestations is not 1|signCount is not 0)$/, "format"],
  [/ is required$/, "input"],
];

/** Reasons that point at this server's App Attest setup rather than at the phone. */
export const SERVER_ATTESTATION_REASONS: ReadonlySet<string> = new Set([
  "unconfigured",
  "app_id",
  "environment",
  "aaguid",
  "cert_chain",
]);

export function attestationFailureReason(message: string): string {
  return REASONS.find(([pattern]) => pattern.test(message))?.[1] ?? "other";
}

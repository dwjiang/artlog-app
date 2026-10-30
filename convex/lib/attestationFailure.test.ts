import { expect, it } from "vitest";

import { attestationFailureReason, SERVER_ATTESTATION_REASONS } from "./attestationFailure";

it.each([
  ["appId does not match", "app_id", true],
  ["development environment is not allowed", "environment", true],
  ["aaguid is not valid", "aaguid", true],
  ["sub CA certificate is not signed by Apple App Attestation Root CA", "cert_chain", true],
  ["no client CA certificate found", "cert_chain", true],
  ["nonce does not match", "nonce", false],
  ["keyId does not match", "key_id", false],
  ["invalid attestation", "format", false],
  ["challenge is required", "input", false],
  ["Unexpected end of CBOR data at private offset", "other", false],
] as const)("maps %j to %s", (message, reason, server) => {
  expect(attestationFailureReason(message)).toBe(reason);
  expect(SERVER_ATTESTATION_REASONS.has(reason)).toBe(server);
});

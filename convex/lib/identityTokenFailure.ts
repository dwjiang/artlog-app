import { errors } from "jose";

const CLAIMS = new Set(["aud", "iss", "exp", "iat", "nbf", "sub", "nonce"]);

// jose explains a rejected token with a fixed error code and claim name; neither carries the token or the person.
export function identityTokenFailure(error: unknown): { joseCode?: string; claim?: string } {
  if (!(error instanceof errors.JOSEError)) return {};
  const claim =
    error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired ? error.claim : undefined;
  return { joseCode: error.code, ...(claim && CLAIMS.has(claim) ? { claim } : {}) };
}

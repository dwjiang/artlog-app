import { errors } from "jose";
import { expect, it } from "vitest";

import { identityTokenFailure } from "./identityTokenFailure";

it("names the jose failure and the claim it rejected", () => {
  expect(identityTokenFailure(new errors.JWTExpired("expired", { sub: "person" }, "exp", "check_failed"))).toEqual({
    joseCode: "ERR_JWT_EXPIRED",
    claim: "exp",
  });
  expect(
    identityTokenFailure(new errors.JWTClaimValidationFailed("unexpected aud", {}, "aud", "check_failed")),
  ).toEqual({ joseCode: "ERR_JWT_CLAIM_VALIDATION_FAILED", claim: "aud" });
  expect(identityTokenFailure(new errors.JWKSTimeout())).toEqual({ joseCode: "ERR_JWKS_TIMEOUT" });
});

it("ignores errors jose did not raise and claims outside the standard set", () => {
  expect(identityTokenFailure(new Error("network"))).toEqual({});
  expect(
    identityTokenFailure(new errors.JWTClaimValidationFailed("bad", {}, "private@example.com", "check_failed")),
  ).toEqual({ joseCode: "ERR_JWT_CLAIM_VALIDATION_FAILED" });
});

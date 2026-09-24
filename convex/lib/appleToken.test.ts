import { jwtVerify } from "jose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { verifyAppleIdentityToken } from "./appleToken";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn<() => string>(() => "apple-keys"),
  jwtVerify: vi.fn<typeof jwtVerify>(),
}));

beforeEach(() => {
  vi.stubEnv("APPLE_BUNDLE_ID", "app.artlog.ios");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

it("verifies Apple issuer, product audience, expiry, RS256 and nonce before returning identity", async () => {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: "apple-user", email: "me@example.com", nonce: "challenge" },
  } as never);
  await expect(verifyAppleIdentityToken("token", "challenge")).resolves.toEqual({
    sub: "apple-user",
    email: "me@example.com",
  });
  expect(jwtVerify).toHaveBeenCalledWith("token", "apple-keys", {
    issuer: "https://appleid.apple.com",
    audience: "app.artlog.ios",
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "nonce"],
  });
});

it.each(["wrong audience", "expired", "invalid signature"])("rejects %s", async (reason) => {
  vi.mocked(jwtVerify).mockRejectedValue(new Error(reason));
  await expect(verifyAppleIdentityToken("token", "challenge")).rejects.toThrow(reason);
});

it.each([
  { sub: "", nonce: "challenge" },
  { sub: "user", nonce: "other" },
])("rejects invalid claims %j", async (payload) => {
  vi.mocked(jwtVerify).mockResolvedValue({ payload } as never);
  await expect(verifyAppleIdentityToken("token", "challenge")).rejects.toThrow("invalid_apple_identity");
});

it("fails closed when the product audience is not configured", async () => {
  vi.stubEnv("APPLE_BUNDLE_ID", "");
  await expect(verifyAppleIdentityToken("token", "challenge")).rejects.toThrow("apple_unconfigured");
  expect(jwtVerify).not.toHaveBeenCalled();
});

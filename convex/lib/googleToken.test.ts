import { jwtVerify } from "jose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { verifyGoogleIdentityToken } from "./googleToken";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn<() => string>(() => "google-keys"),
  jwtVerify: vi.fn<typeof jwtVerify>(),
}));

beforeEach(() => {
  vi.stubEnv("GOOGLE_WEB_CLIENT_ID", "web-client.apps.googleusercontent.com");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

it("verifies Google's signature, issuer, server audience and expiration before returning identity", async () => {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: "google-user", email: "me@example.com", email_verified: true },
  } as never);
  await expect(verifyGoogleIdentityToken("token")).resolves.toEqual({ sub: "google-user", email: "me@example.com" });
  expect(jwtVerify).toHaveBeenCalledWith("token", "google-keys", {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: "web-client.apps.googleusercontent.com",
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
});

it.each(["wrong audience", "wrong issuer", "expired", "invalid signature"])("rejects %s", async (reason) => {
  vi.mocked(jwtVerify).mockRejectedValue(new Error(reason));
  await expect(verifyGoogleIdentityToken("token")).rejects.toThrow(reason);
});

it.each([undefined, "", "   "])("rejects missing or empty subject %s", async (sub) => {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub } } as never);
  await expect(verifyGoogleIdentityToken("token")).rejects.toThrow("invalid_google_identity");
});

it("does not store an unverified email", async () => {
  vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: "google-user", email: "unverified@example.com" } } as never);
  await expect(verifyGoogleIdentityToken("token")).resolves.toEqual({ sub: "google-user" });
});

it("fails closed when the server audience is missing", async () => {
  vi.stubEnv("GOOGLE_WEB_CLIENT_ID", "");
  await expect(verifyGoogleIdentityToken("token")).rejects.toThrow("google_unconfigured");
  expect(jwtVerify).not.toHaveBeenCalled();
});

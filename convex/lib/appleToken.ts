import { ConvexError } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyAppleIdentityToken(token: string, nonce: string): Promise<{ sub: string; email?: string }> {
  const audience = process.env.APPLE_BUNDLE_ID;
  if (!audience) throw new ConvexError({ code: "apple_unconfigured" });
  const { payload } = await jwtVerify(token, appleKeys, {
    issuer: "https://appleid.apple.com",
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "nonce"],
  });
  if (!payload.sub?.trim() || payload.nonce !== nonce) {
    throw new ConvexError({ code: "invalid_apple_identity" });
  }
  return {
    sub: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
  };
}

import { ConvexError } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "../_generated/server";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleIdentityToken(token: string): Promise<{ sub: string; email?: string }> {
  const audience = env.GOOGLE_WEB_CLIENT_ID;
  if (!audience) throw new ConvexError({ code: "google_unconfigured" });
  const { payload } = await jwtVerify(token, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (!payload.sub?.trim()) throw new ConvexError({ code: "invalid_google_identity" });
  return {
    sub: payload.sub,
    ...(typeof payload.email === "string" && payload.email_verified === true ? { email: payload.email } : {}),
  };
}

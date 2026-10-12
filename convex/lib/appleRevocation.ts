import { ConvexError } from "convex/values";
import { decodeJwt, importPKCS8, SignJWT } from "jose";

import { env } from "../_generated/server";

const APPLE_ID = "https://appleid.apple.com";
const REQUEST_TIMEOUT_MS = 15_000;

// Revoking the refresh token from a fresh authorization code removes Artlog from the person's Sign in with Apple apps.
export async function revokeAppleAuthorization(authorizationCode: string, appleUserId: string): Promise<void> {
  const { APPLE_BUNDLE_ID: clientId, APPLE_TEAM_ID: teamId, APPLE_KEY_ID: keyId, APPLE_PRIVATE_KEY: privateKey } = env;
  if (!clientId || !teamId || !keyId || !privateKey) throw new ConvexError({ code: "apple_unconfigured" });
  const clientSecret = await new SignJWT()
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importPKCS8(privateKey, "ES256"));
  const client = { client_id: clientId, client_secret: clientSecret };
  const response = await post("/auth/token", {
    ...client,
    code: authorizationCode,
    grant_type: "authorization_code",
  });
  const tokens = (await response.json().catch(() => null)) as { refresh_token?: unknown; id_token?: unknown } | null;
  if (typeof tokens?.refresh_token !== "string" || typeof tokens.id_token !== "string") {
    throw new ConvexError({ code: "apple_revoke_failed", reason: "bad_response" });
  }
  // The ID token comes straight from Apple's token endpoint, so its claims need no signature check.
  // The code belongs to whichever Apple Account the phone uses now; another account's authorization stays.
  if (decodeJwt(tokens.id_token).sub !== appleUserId) throw new ConvexError({ code: "apple_account_mismatch" });
  await post("/auth/revoke", { ...client, token: tokens.refresh_token, token_type_hint: "refresh_token" });
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${APPLE_ID}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "network";
    throw new ConvexError({ code: "apple_revoke_failed", reason });
  }
  if (response.ok) return response;
  // Apple's OAuth error name separates a broken key (invalid_client) from an expired or reused code (invalid_grant).
  const { error } = ((await response.json().catch(() => null)) ?? {}) as { error?: unknown };
  const reason = error === "invalid_client" || error === "invalid_grant" ? error : `http_${response.status}`;
  throw new ConvexError({ code: "apple_revoke_failed", reason });
}

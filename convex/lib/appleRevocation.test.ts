import { exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { revokeAppleAuthorization } from "./appleRevocation";

let keys: CryptoKeyPair;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  keys = await generateKeyPair("ES256", { extractable: true });
});
beforeEach(async () => {
  vi.stubEnv("APPLE_BUNDLE_ID", "app.artlog.ios");
  vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
  vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
  vi.stubEnv("APPLE_PRIVATE_KEY", await exportPKCS8(keys.privateKey));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function tokenResponse(sub: string) {
  const idToken = await new SignJWT({ sub }).setProtectedHeader({ alg: "ES256" }).sign(keys.privateKey);
  return Response.json({ access_token: "access", refresh_token: "refresh", id_token: idToken });
}

function sentForm(call: number) {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, form: Object.fromEntries(new URLSearchParams(String(init?.body))) };
}

it("exchanges the fresh code with a signed client secret, then revokes the refresh token", async () => {
  fetchMock.mockResolvedValueOnce(await tokenResponse("apple-user")).mockResolvedValueOnce(new Response(null));
  await revokeAppleAuthorization("fresh-code", "apple-user");

  const exchange = sentForm(0);
  expect(exchange.url).toBe("https://appleid.apple.com/auth/token");
  expect(exchange.form).toMatchObject({
    client_id: "app.artlog.ios",
    code: "fresh-code",
    grant_type: "authorization_code",
  });
  const secret = await jwtVerify(exchange.form.client_secret, keys.publicKey, {
    issuer: "TEAM123456",
    subject: "app.artlog.ios",
    audience: "https://appleid.apple.com",
    algorithms: ["ES256"],
  });
  expect(secret.protectedHeader.kid).toBe("KEY1234567");
  expect(sentForm(1)).toEqual({
    url: "https://appleid.apple.com/auth/revoke",
    form: {
      client_id: "app.artlog.ios",
      client_secret: exchange.form.client_secret,
      token: "refresh",
      token_type_hint: "refresh_token",
    },
  });
});

it("leaves another Apple Account's authorization in place", async () => {
  fetchMock.mockResolvedValueOnce(await tokenResponse("someone-else"));
  await expect(revokeAppleAuthorization("fresh-code", "apple-user")).rejects.toThrow("apple_account_mismatch");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  ["invalid_client", "invalid_client"],
  ["invalid_grant", "invalid_grant"],
  ["invalid_request", "http_400"],
])("reports Apple's %s rejection as %s so key setup and expired codes can be told apart", async (error, reason) => {
  fetchMock.mockResolvedValueOnce(Response.json({ error }, { status: 400 }));
  await expect(revokeAppleAuthorization("used-code", "apple-user")).rejects.toMatchObject({
    data: { code: "apple_revoke_failed", reason },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "APPLE_BUNDLE_ID"])(
  "fails before contacting Apple without %s",
  async (name) => {
    vi.stubEnv(name, "");
    await expect(revokeAppleAuthorization("fresh-code", "apple-user")).rejects.toThrow("apple_unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { harness, type Harness } from "./test.helpers";

const SECRET = "a1".repeat(32);
let privateKey: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
});

beforeEach(() => {
  vi.stubEnv("JWT_PRIVATE_KEY", privateKey);
  vi.stubEnv("CONVEX_SITE_URL", "https://auth-test.convex.site");
});

afterEach(() => vi.unstubAllEnvs());

async function authenticate(t: Harness, secret = SECRET) {
  const result = await t.action(api.auth.signIn, {
    provider: "anonymous",
    params: { secret },
  });
  const tokens = result.tokens!;
  const subject = decodeJwt(tokens.token).sub!;
  const [userId, sessionId] = subject.split("|");
  return {
    tokens,
    userId: userId as Id<"users">,
    sessionId: sessionId as Id<"authSessions">,
    as: t.withIdentity({ subject }),
  };
}

describe("anonymous installation credentials", () => {
  it("issues access tokens that last a day and end well before their session", async () => {
    const t = harness();
    const { tokens, sessionId } = await authenticate(t);
    const { iat, exp } = decodeJwt(tokens.token);
    expect(exp! - iat!).toBe(24 * 60 * 60);
    const session = await t.run((ctx) => ctx.db.get("authSessions", sessionId));
    expect(session!.expirationTime - exp! * 1000).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });

  it.each([false, true])("preserves the entire device after session expiry (banned: %s)", async (banned) => {
    const t = harness();
    const first = await authenticate(t);
    const { deviceId } = await first.as.mutation(api.devices.registerDevice, {
      platform: "ios",
    });
    await first.as.mutation(internal.devices.markAttested, {
      deviceId,
      keyId: "attested-install-key",
      publicKeySpkiBase64: "verified-key",
      counter: 0,
    });
    await t.run((ctx) => ctx.db.patch("devices", deviceId, { attestCounter: 7, trustWeight: 0.8, banned }));
    const original = await t.run((ctx) => ctx.db.get("devices", deviceId));
    await t.run((ctx) => ctx.db.patch("authSessions", first.sessionId, { expirationTime: Date.now() - 1 }));
    const expired = await t.action(api.auth.signIn, {
      refreshToken: first.tokens.refreshToken,
    });
    expect(expired.tokens).toBeNull();

    const renewed = await authenticate(t);
    expect(renewed.userId).toBe(first.userId);
    expect(renewed.sessionId).not.toBe(first.sessionId);
    const [registration] = await Promise.allSettled([
      renewed.as.mutation(api.devices.registerDevice, {
        platform: "ios",
        appAttestKeyId: "attested-install-key",
      }),
    ]);
    expect(registration).toMatchObject(
      banned
        ? { status: "rejected", reason: { data: { code: "device_banned" } } }
        : { status: "fulfilled", value: { deviceId, attested: true } },
    );
    expect(await t.run((ctx) => ctx.db.get("devices", deviceId))).toEqual(original);
    expect(await t.run((ctx) => ctx.db.query("devices").collect())).toHaveLength(1);
  });

  it("signs the same secret in as a new device after its owner deletes their data", async () => {
    vi.useFakeTimers();
    const t = harness();
    const first = await authenticate(t);
    const { deviceId } = await first.as.mutation(api.devices.registerDevice, { platform: "ios" });
    await first.as.mutation(internal.devices.markAttested, {
      deviceId,
      keyId: "install-key",
      publicKeySpkiBase64: "verified-key",
      counter: 0,
    });

    await first.as.mutation(api.accounts.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.action(api.auth.signIn, { refreshToken: first.tokens.refreshToken })).tokens).toBeNull();
    const renewed = await authenticate(t);
    expect(renewed.userId).not.toBe(first.userId);
    const registration = await renewed.as.mutation(api.devices.registerDevice, { platform: "ios" });
    expect(registration.deviceId).not.toBe(deviceId);
    // The retired row gives up its App Attest key, so the new device can attest without a conflict.
    await renewed.as.mutation(internal.devices.markAttested, {
      deviceId: registration.deviceId,
      keyId: "install-key",
      publicKeySpkiBase64: "verified-key",
      counter: 0,
    });
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toEqual([
      expect.objectContaining({ userId: renewed.userId }),
    ]);
    vi.useRealTimers();
  });

  it("deduplicates concurrent sign-ins and stores only a hash of the credential", async () => {
    const t = harness();
    const [first, second] = await Promise.all([authenticate(t), authenticate(t)]);
    expect(first.userId).toBe(second.userId);
    const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts).toHaveLength(1);
    expect(JSON.stringify(accounts)).not.toContain(SECRET);

    const usingStoredHash = await authenticate(t, accounts[0].providerAccountId);
    expect(usingStoredHash.userId).not.toBe(first.userId);
  });

  it("cannot claim another device with a different secret or its public identifiers", async () => {
    const t = harness();
    const first = await authenticate(t);
    const { deviceId } = await first.as.mutation(api.devices.registerDevice, {
      platform: "ios",
    });
    const other = await authenticate(t, "b2".repeat(32));
    expect(other.userId).not.toBe(first.userId);
    expect(await other.as.query(api.devices.me, {})).toBeNull();
    await expect(
      t.action(api.auth.signIn, {
        provider: "anonymous",
        params: { userId: first.userId, deviceId },
      }),
    ).rejects.toMatchObject({ data: { code: "invalid_device_credential" } });
  });

  it.each([undefined, "", "a".repeat(63), "g".repeat(64), "a".repeat(65), 123])(
    "rejects malformed credential %s without creating a user",
    async (secret) => {
      const t = harness();
      await expect(
        t.action(api.auth.signIn, {
          provider: "anonymous",
          params: secret === undefined ? {} : { secret },
        }),
      ).rejects.toMatchObject({ data: { code: "invalid_device_credential" } });
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
    },
  );
});

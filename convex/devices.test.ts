import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { requireAttestedWrite, type AttestedWriteArgs } from "./devices";

import { sha256 } from "./lib/appAttest";
import { authenticatorData, makeSigner, signAssertion } from "./lib/appAttest.fixtures";
import { harness, signIn, type Harness, type SignedIn } from "./test.helpers";

const APP_ID = "TEAMID.app.artlog.ios";

afterEach(() => vi.unstubAllEnvs());

async function registered(t: Harness, platform: "ios" | "simulator" = "simulator") {
  const user = await signIn(t);
  const { deviceId } = await user.as.mutation(api.devices.registerDevice, {
    platform,
  });
  return { ...user, deviceId };
}

async function assertWrite(user: SignedIn, args: AttestedWriteArgs) {
  return user.as.mutation(async (ctx) => {
    const device = await requireAttestedWrite(ctx, args);
    return { ok: true, counter: device.attestCounter };
  });
}

async function challenge(user: SignedIn, purpose: "attest" | "assert" = "assert") {
  return (await user.as.mutation(api.devices.createChallenge, { purpose })).nonce;
}

describe("registerDevice", () => {
  it("creates one device per anonymous user and returns the same id on relaunch", async () => {
    const t = harness();
    const user = await signIn(t);

    const first = await user.as.mutation(api.devices.registerDevice, {
      platform: "simulator",
    });
    const second = await user.as.mutation(api.devices.registerDevice, {
      platform: "simulator",
    });

    expect(first).toEqual({
      deviceId: first.deviceId,
      attested: false,
      attestRequired: false,
    });
    expect(second.deviceId).toBe(first.deviceId);
    const rows = await t.run((ctx) => ctx.db.query("devices").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      authUserId: user.userId,
      platform: "simulator",
      trustWeight: 0.5,
      banned: false,
      attestCounter: 0,
    });
  });

  it("reports whether attestation is required from the deployment flag", async () => {
    vi.stubEnv("APP_ATTEST_REQUIRED", "true");
    const t = harness();
    const user = await signIn(t);
    const result = await user.as.mutation(api.devices.registerDevice, {
      platform: "ios",
    });
    expect(result.attestRequired).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const t = harness();
    await expect(t.mutation(api.devices.registerDevice, { platform: "simulator" })).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
  });

  it("rejects banned devices everywhere a device is required", async () => {
    const t = harness();
    const { as, deviceId } = await registered(t);
    await t.run((ctx) => ctx.db.patch(deviceId, { banned: true }));

    await expect(as.mutation(api.devices.registerDevice, { platform: "simulator" })).rejects.toMatchObject({
      data: { code: "device_banned" },
    });
    await expect(as.mutation(api.devices.createChallenge, { purpose: "assert" })).rejects.toMatchObject({
      data: { code: "device_banned" },
    });
  });

  it("rate-limits registration per auth user", async () => {
    const t = harness();
    const user = await signIn(t);
    for (let i = 0; i < 10; i++) {
      await user.as.mutation(api.devices.registerDevice, {
        platform: "simulator",
      });
    }
    await expect(user.as.mutation(api.devices.registerDevice, { platform: "simulator" })).rejects.toMatchObject({
      data: { code: "rate_limited", name: "registerDevice" },
    });
  });
});

describe("me", () => {
  it("requires sign-in, is null before registration, then describes the device", async () => {
    const t = harness();
    await expect(t.query(api.devices.me, {})).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    const user = await signIn(t);
    expect(await user.as.query(api.devices.me, {})).toBeNull();

    const { deviceId } = await user.as.mutation(api.devices.registerDevice, {
      platform: "simulator",
    });
    expect(await user.as.query(api.devices.me, {})).toEqual({
      deviceId,
      attested: false,
      trustWeight: 0.5,
    });
  });
});

describe("challenges and attested writes", () => {
  it("requires a registered device to mint a challenge", async () => {
    const t = harness();
    const user = await signIn(t);
    await expect(user.as.mutation(api.devices.createChallenge, { purpose: "attest" })).rejects.toMatchObject({
      data: { code: "device_not_registered" },
    });
  });

  it("lets simulator builds through without a signature while attestation is not required, once per nonce", async () => {
    const t = harness();
    const user = await registered(t, "simulator");
    const nonce = await challenge(user);
    const args = { nonce, assertionBase64: "AAAA", payload: "{}" };

    expect(await assertWrite(user, args)).toEqual({ ok: true, counter: 0 });
    await expect(assertWrite(user, args)).rejects.toMatchObject({
      data: { code: "challenge_invalid" },
    });
  });

  it("rejects a challenge minted for another purpose, an expired one, and another device’s", async () => {
    const t = harness();
    const user = await registered(t, "simulator");

    const attestNonce = await challenge(user, "attest");
    await expect(
      assertWrite(user, {
        nonce: attestNonce,
        assertionBase64: "AAAA",
        payload: "{}",
      }),
    ).rejects.toMatchObject({ data: { code: "challenge_invalid" } });

    const staleNonce = await challenge(user);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("attestChallenges")
        .withIndex("by_nonce", (q) => q.eq("nonce", staleNonce))
        .unique();
      await ctx.db.patch(row!._id, { createdAt: Date.now() - 6 * 60 * 1000 });
    });
    await expect(
      assertWrite(user, {
        nonce: staleNonce,
        assertionBase64: "AAAA",
        payload: "{}",
      }),
    ).rejects.toMatchObject({ data: { code: "challenge_invalid" } });

    const other = await registered(t, "simulator");
    const foreignNonce = await challenge(user);
    await expect(
      assertWrite(other, {
        nonce: foreignNonce,
        assertionBase64: "AAAA",
        payload: "{}",
      }),
    ).rejects.toMatchObject({ data: { code: "challenge_invalid" } });
  });

  it("demands a real attestation from simulators once APP_ATTEST_REQUIRED is on, and from phones always", async () => {
    const t = harness();
    const phone = await registered(t, "ios");
    await expect(
      assertWrite(phone, {
        nonce: await challenge(phone),
        assertionBase64: "AAAA",
        payload: "{}",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_attested" } });

    vi.stubEnv("APP_ATTEST_REQUIRED", "true");
    const sim = await registered(t, "simulator");
    await expect(
      assertWrite(sim, {
        nonce: await challenge(sim),
        assertionBase64: "AAAA",
        payload: "{}",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_attested" } });
  });

  it("verifies assertions from an attested phone, advances the counter, and refuses replays", async () => {
    vi.stubEnv("APP_ATTEST_APP_ID", APP_ID);
    const t = harness();
    const phone = await registered(t, "ios");
    const signer = await makeSigner();
    await t.run((ctx) =>
      ctx.db.patch(phone.deviceId, {
        appAttestKeyId: "key-1",
        attestPublicKey: signer.publicKeySpkiBase64,
        attestedAt: Date.now(),
      }),
    );
    const rpIdHash = await sha256(APP_ID);
    const payload = '{"objectId":"abc"}';

    const nonce1 = await challenge(phone);
    const assertion1 = await signAssertion(signer, authenticatorData(rpIdHash, 1), `${nonce1}.${payload}`);
    expect(
      await assertWrite(phone, {
        nonce: nonce1,
        assertionBase64: assertion1,
        payload,
      }),
    ).toEqual({ ok: true, counter: 1 });
    expect((await t.run((ctx) => ctx.db.get(phone.deviceId)))?.attestCounter).toBe(1);
    expect(await phone.as.query(api.devices.me, {})).toMatchObject({
      attested: true,
    });

    await expect(
      assertWrite(phone, {
        nonce: nonce1,
        assertionBase64: assertion1,
        payload,
      }),
    ).rejects.toMatchObject({ data: { code: "challenge_invalid" } });

    const nonce2 = await challenge(phone);
    const stale = await signAssertion(signer, authenticatorData(rpIdHash, 1), `${nonce2}.${payload}`);
    await expect(assertWrite(phone, { nonce: nonce2, assertionBase64: stale, payload })).rejects.toMatchObject({
      data: { code: "invalid_assertion", reason: "counter_not_increasing" },
    });

    const nonce3 = await challenge(phone);
    const forged = await signAssertion(signer, authenticatorData(rpIdHash, 2), `${nonce3}.{"objectId":"xyz"}`);
    await expect(assertWrite(phone, { nonce: nonce3, assertionBase64: forged, payload })).rejects.toMatchObject({
      data: { code: "invalid_assertion", reason: "invalid_signature" },
    });
  });
});

describe("attestDevice", () => {
  it("binds a verified key to only one device and cannot reset an attested device counter", async () => {
    const t = harness();
    const first = await registered(t, "ios");
    const second = await registered(t, "ios");
    const key = {
      keyId: "verified-key",
      publicKeySpkiBase64: "spki",
      counter: 0,
    };
    await first.as.mutation(internal.devices.markAttested, {
      ...key,
      deviceId: first.deviceId,
    });
    await t.run((ctx) => ctx.db.patch(first.deviceId, { attestCounter: 3 }));

    await expect(
      second.as.mutation(internal.devices.markAttested, {
        ...key,
        deviceId: second.deviceId,
      }),
    ).rejects.toMatchObject({ data: { code: "key_already_registered" } });
    await expect(
      first.as.mutation(internal.devices.markAttested, {
        ...key,
        deviceId: first.deviceId,
      }),
    ).rejects.toMatchObject({ data: { code: "device_already_attested" } });
    expect((await t.run((ctx) => ctx.db.get(first.deviceId)))?.attestCounter).toBe(3);
  });

  it("rechecks a device ban when verification finishes", async () => {
    const t = harness();
    const user = await registered(t, "ios");
    await t.run((ctx) => ctx.db.patch(user.deviceId, { banned: true }));
    await expect(
      user.as.mutation(internal.devices.markAttested, {
        deviceId: user.deviceId,
        keyId: "key",
        publicKeySpkiBase64: "spki",
        counter: 0,
      }),
    ).rejects.toMatchObject({ data: { code: "device_banned" } });
    expect((await t.run((ctx) => ctx.db.get(user.deviceId)))?.attestedAt).toBeUndefined();
  });

  it("fails closed when the App ID is not configured", async () => {
    const t = harness();
    const user = await registered(t, "ios");
    await expect(
      user.as.action(api.devices.attestDevice, {
        keyId: "k",
        attestationBase64: "AAAA",
        nonce: "n",
      }),
    ).rejects.toMatchObject({ data: { code: "attest_unconfigured" } });
  });

  it("rejects an invalid attestation through the Node verifier and spends the challenge", async () => {
    vi.stubEnv("APP_ATTEST_APP_ID", APP_ID);
    const t = harness();
    const user = await registered(t, "ios");
    const nonce = await challenge(user, "attest");
    const args = { keyId: "a2V5", attestationBase64: "AAAA", nonce };

    await expect(user.as.action(api.devices.attestDevice, args)).rejects.toMatchObject({
      data: { code: "invalid_attestation" },
    });
    await expect(user.as.action(api.devices.attestDevice, args)).rejects.toMatchObject({
      data: { code: "challenge_invalid" },
    });
    expect((await t.run((ctx) => ctx.db.get(user.deviceId)))?.attestedAt).toBeUndefined();
  });

  it("requires a registered device", async () => {
    const t = harness();
    const user = await signIn(t);
    await expect(
      user.as.action(api.devices.attestDevice, {
        keyId: "k",
        attestationBase64: "AAAA",
        nonce: "n",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_registered" } });
  });
});

describe("assertSmoke", () => {
  it("verifies a signed payload once and advances the stored counter", async () => {
    vi.stubEnv("APP_ATTEST_APP_ID", APP_ID);
    const t = harness();
    const phone = await registered(t, "ios");
    const signer = await makeSigner();
    await phone.as.mutation(internal.devices.markAttested, {
      deviceId: phone.deviceId,
      keyId: "smoke-key",
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      counter: 0,
    });
    const nonce = await challenge(phone);
    const payloadJson = '{"action":"assertSmoke"}';
    const assertionBase64 = await signAssertion(
      signer,
      authenticatorData(await sha256(APP_ID), 1),
      `${nonce}.${payloadJson}`,
    );
    const args = { nonce, assertionBase64, payloadJson };
    expect(await phone.as.mutation(api.devices.assertSmoke, args)).toEqual({
      ok: true,
    });
    expect(await phone.as.mutation(api.devices.assertSmoke, args)).toEqual({
      ok: false,
    });
    expect((await t.run((ctx) => ctx.db.get(phone.deviceId)))?.attestCounter).toBe(1);
  });

  it("rejects altered payloads and another device’s challenge without advancing the counter", async () => {
    vi.stubEnv("APP_ATTEST_APP_ID", APP_ID);
    const t = harness();
    const phone = await registered(t, "ios");
    const other = await registered(t, "ios");
    const signer = await makeSigner();
    await phone.as.mutation(internal.devices.markAttested, {
      deviceId: phone.deviceId,
      keyId: "smoke-key",
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      counter: 0,
    });
    const nonce = await challenge(phone);
    const assertionBase64 = await signAssertion(signer, authenticatorData(await sha256(APP_ID), 1), `${nonce}.{}`);
    expect(
      await phone.as.mutation(api.devices.assertSmoke, {
        nonce,
        assertionBase64,
        payloadJson: '{"changed":true}',
      }),
    ).toEqual({ ok: false });
    expect(
      await phone.as.mutation(api.devices.assertSmoke, {
        nonce: await challenge(other),
        assertionBase64,
        payloadJson: "{}",
      }),
    ).toEqual({ ok: false });
    expect((await t.run((ctx) => ctx.db.get(phone.deviceId)))?.attestCounter).toBe(0);
  });

  it("requires authentication and never reports a simulator bypass as a verified assertion", async () => {
    const t = harness();
    const args = { nonce: "nonce", assertionBase64: "", payloadJson: "{}" };
    await expect(t.mutation(api.devices.assertSmoke, args)).rejects.toMatchObject({
      data: { code: "unauthenticated" },
    });
    for (const platform of ["simulator", "ios"] as const) {
      const user = await registered(t, platform);
      expect(
        await user.as.mutation(api.devices.assertSmoke, {
          ...args,
          nonce: await challenge(user),
        }),
      ).toEqual({ ok: false });
    }
  });
});

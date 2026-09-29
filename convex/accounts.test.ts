import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { verifyAppleIdentityToken } from "./lib/appleToken";
import { fileStorage } from "./lib/fileStorage";
import { verifyGoogleIdentityToken } from "./lib/googleToken";
import { limitDevice } from "./lib/rateLimits";
import { seedDevice } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

vi.mock("./lib/appleToken", () => ({ verifyAppleIdentityToken: vi.fn<typeof verifyAppleIdentityToken>() }));
vi.mock("./lib/googleToken", () => ({ verifyGoogleIdentityToken: vi.fn<typeof verifyGoogleIdentityToken>() }));
let privateKey: string;
beforeAll(async () => {
  privateKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
});
beforeEach(() => {
  vi.stubEnv("JWT_PRIVATE_KEY", privateKey);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("APP_ATTEST_REQUIRED", "false");
  vi.mocked(verifyAppleIdentityToken).mockResolvedValue({
    sub: "apple-user",
    email: "me@example.com",
  });
  vi.mocked(verifyGoogleIdentityToken).mockResolvedValue({ sub: "google-user", email: "me@example.com" });
});
afterEach(() => vi.unstubAllEnvs());

async function appleSignIn(device: Awaited<ReturnType<typeof seedDevice>>) {
  const { nonce } = await device.as.mutation(api.devices.createChallenge, {
    purpose: "apple",
  });
  return device.as.action(api.auth.signIn, {
    provider: "apple-native",
    params: { identityToken: "verified-token", nonce },
  });
}

async function link(
  device: Awaited<ReturnType<typeof seedDevice>>,
  providerUserId = "apple-user",
  provider: "apple" | "google" = "apple",
) {
  const { nonce } = await device.as.mutation(api.devices.createChallenge, {
    purpose: "assert",
  });
  return device.as.mutation(api.accounts.linkAccount, {
    provider,
    providerUserId,
    nonce,
    assertionBase64: "",
  });
}

async function googleSignIn(device: Awaited<ReturnType<typeof seedDevice>>) {
  const { nonce } = await device.as.mutation(api.devices.createChallenge, { purpose: "google" });
  return device.as.action(api.auth.signIn, {
    provider: "google-native",
    params: { identityToken: "google-token", nonce },
  });
}

it("links two Google devices to one journal while preserving their device sessions", async () => {
  const t = harness();
  const devices = [await seedDevice(t), await seedDevice(t)];
  for (const device of [...devices, devices[0]]) {
    const result = await googleSignIn(device);
    expect(decodeJwt(result.tokens!.token).sub?.split("|")[0]).toBe(device.userId);
    await link(device, "google-user", "google");
  }
  const a = await devices[0].as.query(api.accounts.me, {});
  expect(await devices[1].as.query(api.accounts.me, {})).toMatchObject({
    accountId: a.accountId,
    deviceCount: 2,
    linked: true,
    email: "me@example.com",
  });
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(1);
});

it("keeps Apple and Google accounts separate even with matching subjects and emails", async () => {
  const t = harness();
  vi.mocked(verifyGoogleIdentityToken).mockResolvedValueOnce({ sub: "apple-user", email: "me@example.com" });
  const apple = await seedDevice(t);
  const google = await seedDevice(t);
  await appleSignIn(apple);
  await googleSignIn(google);
  const appleId = await link(apple);
  const googleId = await link(google, "apple-user", "google");
  expect(googleId).not.toBe(appleId);
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(2);
});

it("rejects invalid Google tokens, forged subjects and proofs from another provider", async () => {
  const t = harness();
  const device = await seedDevice(t);
  await expect(
    t.action(api.auth.signIn, { provider: "google-native", params: { identityToken: "token", nonce: "nonce" } }),
  ).rejects.toThrow("unauthenticated");
  vi.mocked(verifyGoogleIdentityToken).mockRejectedValueOnce(new Error("wrong audience"));
  await expect(googleSignIn(device)).rejects.toThrow("wrong audience");
  await expect(link(device, "google-user", "google")).rejects.toThrow("sign_in_required");
  await googleSignIn(device);
  await expect(link(device, "forged", "google")).rejects.toThrow("sign_in_required");
  await expect(link(device, "google-user", "apple")).rejects.toThrow("sign_in_required");
  expect((await device.as.query(api.accounts.me, {})).linked).toBe(false);
});

it("rejects Google challenge replay, another device's challenge and a challenge for Apple", async () => {
  const t = harness();
  const a = await seedDevice(t);
  const b = await seedDevice(t);
  const { nonce } = await a.as.mutation(api.devices.createChallenge, { purpose: "google" });
  const args = { provider: "google" as const, sub: "google-user", nonce };
  await expect(b.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args)).rejects.toThrow("challenge_invalid");
  await a.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args);
  await expect(a.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args)).rejects.toThrow("challenge_invalid");
  const apple = await a.as.mutation(api.devices.createChallenge, { purpose: "apple" });
  await expect(
    a.as.mutation(internal.nativeLogin.recordVerifiedIdentity, { ...args, nonce: apple.nonce }),
  ).rejects.toThrow("challenge_invalid");
});

it("deletes Google's auth association and unlinks every device after the journal claims complete", async () => {
  const t = harness();
  const devices = [await seedDevice(t), await seedDevice(t)];
  for (const device of devices) {
    await googleSignIn(device);
    await link(device, "google-user", "google");
    const { scope } = await device.as.query(api.accounts.me, {});
    while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}
  }
  await devices[0].as.mutation(api.accounts.deleteAccount, {});
  for (const device of devices) expect((await device.as.query(api.accounts.me, {})).linked).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(0);
});

async function pair(t: Harness) {
  const a = await seedDevice(t);
  const b = await seedDevice(t);
  await appleSignIn(a);
  await appleSignIn(b);
  await link(a);
  await link(b);
  for (const device of [a, b]) {
    const { scope } = await device.as.query(api.accounts.me, {});
    while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}
  }
  return { a, b };
}

it("keeps distinct device users when both sign into the same Apple account, including repeat sign-in", async () => {
  const t = harness();
  const a = await seedDevice(t);
  const b = await seedDevice(t);
  for (const device of [a, b, a]) {
    const result = await appleSignIn(device);
    expect(decodeJwt(result.tokens!.token).sub?.split("|")[0]).toBe(device.userId);
    expect((await device.as.query(api.devices.me, {}))?.deviceId).toBe(device.deviceId);
  }
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(1);
});

it("requires a device session and a valid Apple token", async () => {
  const t = harness();
  await expect(
    t.action(api.auth.signIn, {
      provider: "apple-native",
      params: { identityToken: "token", nonce: "nonce" },
    }),
  ).rejects.toThrow("unauthenticated");
  const device = await seedDevice(t);
  vi.mocked(verifyAppleIdentityToken).mockRejectedValueOnce(new Error("wrong audience"));
  await expect(appleSignIn(device)).rejects.toThrow("wrong audience");
  await expect(link(device)).rejects.toThrow("sign_in_required");
});

it("rejects a forged Apple subject even with a valid device assertion", async () => {
  const t = harness();
  const device = await seedDevice(t);
  await appleSignIn(device);
  await expect(link(device, "someone-else")).rejects.toThrow("sign_in_required");
  expect((await device.as.query(api.accounts.me, {})).linked).toBe(false);
});

it("consumes Apple challenges and rejects replay, expiration and another device’s challenge", async () => {
  const t = harness();
  const a = await seedDevice(t);
  const b = await seedDevice(t);
  const { nonce } = await a.as.mutation(api.devices.createChallenge, {
    purpose: "apple",
  });
  const args = { provider: "apple" as const, sub: "apple-user", nonce };
  await expect(b.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args)).rejects.toThrow("challenge_invalid");
  await a.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args);
  await expect(a.as.mutation(internal.nativeLogin.recordVerifiedIdentity, args)).rejects.toThrow("challenge_invalid");
  await t.run((ctx) =>
    ctx.db.patch("devices", a.deviceId, {
      accountLinkProof: { provider: "apple", sub: "apple-user", expiresAt: 0 },
    }),
  );
  await expect(link(a)).rejects.toThrow("sign_in_required");
});

it("links idempotently and reports two devices without exposing the Apple subject", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await link(a);
  const me = await b.as.query(api.accounts.me, {});
  expect(me).toMatchObject({
    linked: true,
    deviceCount: 2,
    email: "me@example.com",
  });
  expect(me).not.toHaveProperty("providerUserId");
});

it("aggregates trust on linking while leaving rate limits per device", async () => {
  const t = harness();
  const a = await seedDevice(t);
  const b = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch("devices", a.deviceId, { trustWeight: 0.9 }));
  await appleSignIn(a);
  await link(a);
  await appleSignIn(b);
  await link(b);
  expect(await t.run((ctx) => ctx.db.get("devices", b.deviceId))).toMatchObject({
    trustWeight: 0.9,
  });
  for (let i = 0; i < 10; i++) {
    await t.run((ctx) => limitDevice(ctx, "sync", a.deviceId));
  }
  await expect(t.run((ctx) => limitDevice(ctx, "sync", a.deviceId))).rejects.toThrow("rate_limited");
  await expect(t.run((ctx) => limitDevice(ctx, "sync", b.deviceId))).resolves.toBeNull();
});

it("reports whether the linked account has a profile so first sign-in can offer setup", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  expect(await a.as.query(api.accounts.me, {})).toMatchObject({ linked: true, hasProfile: false });
  await a.as.mutation(api.profiles.create, { username: "first_reader", name: "Reader" });
  expect(await b.as.query(api.accounts.me, {})).toMatchObject({ linked: true, hasProfile: true });
  const guest = await seedDevice(t);
  expect(await guest.as.query(api.accounts.me, {})).toMatchObject({ linked: false, hasProfile: false });
});

it("unlink removes only this device and clears pending proof so it cannot silently relink", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await a.as.mutation(api.accounts.unlink, {});
  expect(await a.as.query(api.accounts.me, {})).toMatchObject({
    linked: false,
    deviceCount: 0,
  });
  expect(await b.as.query(api.accounts.me, {})).toMatchObject({
    linked: true,
    deviceCount: 1,
  });
  await expect(link(a)).rejects.toThrow("sign_in_required");
  expect(await t.run((ctx) => ctx.db.get("devices", a.deviceId))).toMatchObject({
    authUserId: a.userId,
  });
});

it("deleting an account unlinks every device and removes its Apple auth association", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await a.as.mutation(api.accounts.deleteAccount, {});
  for (const device of [a, b]) {
    expect(await device.as.query(api.accounts.me, {})).toMatchObject({
      linked: false,
    });
  }
  expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(0);
});

it("keeps interrupted claims linked until they can finish without stranding parents", async () => {
  const t = harness();
  const device = await seedDevice(t);
  await appleSignIn(device);
  await link(device);
  await expect(device.as.mutation(api.accounts.unlink, {})).rejects.toThrow("claim_required");
  await expect(device.as.mutation(api.accounts.deleteAccount, {})).rejects.toThrow("claim_required");
  expect((await device.as.query(api.accounts.me, {})).linked).toBe(true);
});

it("checks every claim on deletion and forgets a device’s claim once it unlinks", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  const accountId = (await a.as.query(api.accounts.me, {})).accountId!;
  await t.run(async (ctx) => {
    for (let i = 0; i < 25; i++) {
      const deviceId = await ctx.db.insert("devices", {
        firstSeenAt: 1,
        trustWeight: 0,
        banned: false,
        platform: "simulator",
        attestCounter: 0,
        scopeRevision: 0,
      });
      await ctx.db.insert("journalClaims", {
        deviceId,
        accountId,
        phase: "complete",
        completedAt: 1,
      });
    }
  });
  await b.as.mutation(api.accounts.unlink, {});
  await appleSignIn(b);
  await link(b);
  await expect(a.as.mutation(api.accounts.deleteAccount, {})).rejects.toThrow("claim_required");
  const { scope } = await b.as.query(api.accounts.me, {});
  while (!(await b.as.mutation(api.journalClaims.resume, { scope })).complete) {}
  await b.as.mutation(api.accounts.unlink, {});
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("journalClaims")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", b.deviceId))
        .collect(),
    ),
  ).toEqual([]);
  await a.as.mutation(api.accounts.deleteAccount, {});
  expect(await t.run((ctx) => ctx.db.query("journalClaims").collect())).toEqual([]);
});

it("purges the deleted account’s journal, photos and sync state without extra monitoring jobs", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  const t = harness();
  const { a } = await pair(t);
  const accountId = (await a.as.query(api.accounts.me, {})).accountId!;
  const owner = { kind: "account" as const, accountId };
  await t.run(async (ctx) => {
    const venueId = await ctx.db.insert("museums", {
      key: "v",
      name: "Museum",
      lat: 0,
      lng: 0,
      seedSource: "manual",
      region: "US",
      optOut: false,
      contributionRevision: 0,
    });
    const stored = await fileStorage.store(ctx, new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
    await ctx.db.insert("journalSyncState", { owner, version: 70 });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("visits", {
        visibility: "public" as const,
        owner,
        localId: crypto.randomUUID(),
        venueId,
        venueName: "Museum",
        visitedOn: "2026-09-01",
        timeZone: "UTC",
        updatedAt: 1,
        updatedBy: a.deviceId,
        changeVersion: i + 1,
      });
    }
    for (let i = 0; i < 60; i++) {
      await ctx.db.insert("collections", {
        owner,
        localId: crypto.randomUUID(),
        snapshot: { title: "Work", artist: "" },
        savedAt: 1,
        updatedAt: 1,
        updatedBy: a.deviceId,
        changeVersion: i + 6,
        ...(i === 0 ? { cropStorageId: stored } : {}),
      });
    }
  });
  await a.as.mutation(api.accounts.deleteAccount, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(new Set(jobs.map((job) => job.name))).toEqual(
    new Set(["accounts:purgeJournal", "files:discard", "files:deleteRemote"]),
  );
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("collections")
        .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
        .collect(),
    ),
  ).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("visits")
        .withIndex("by_owner_localId", (q) => q.eq("owner", owner))
        .collect(),
    ),
  ).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("journalSyncState").collect())).toEqual([]);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("files")
        .collect()
        .then((files) => files.filter((file) => file.state === "ready")),
    ),
  ).toEqual([]);
  vi.useRealTimers();
});

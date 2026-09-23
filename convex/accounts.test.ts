import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { verifyAppleIdentityToken } from "./lib/appleToken";
import { limitDevice } from "./lib/rateLimits";
import { seedDevice } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

vi.mock("./lib/appleToken", () => ({ verifyAppleIdentityToken: vi.fn() }));
let privateKey: string;
beforeAll(async () => {
  privateKey = await exportPKCS8(
    (await generateKeyPair("RS256", { extractable: true })).privateKey,
  );
});
beforeEach(() => {
  vi.stubEnv("JWT_PRIVATE_KEY", privateKey);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("APP_ATTEST_REQUIRED", "false");
  vi.mocked(verifyAppleIdentityToken).mockResolvedValue({
    sub: "apple-user",
    email: "me@example.com",
  });
});
afterEach(() => vi.unstubAllEnvs());

async function appleSignIn(device: Awaited<ReturnType<typeof seedDevice>>) {
  const { nonce } = await device.as.mutation(api.devices.createChallenge, { purpose: "apple" });
  return device.as.action(api.auth.signIn, {
    provider: "apple-native",
    params: { identityToken: "verified-token", nonce },
  });
}

async function link(device: Awaited<ReturnType<typeof seedDevice>>, appleUserId = "apple-user") {
  const { nonce } = await device.as.mutation(api.devices.createChallenge, { purpose: "assert" });
  return device.as.mutation(api.accounts.linkAccount, { appleUserId, nonce, assertionBase64: "" });
}

async function pair(t: Harness) {
  const a = await seedDevice(t),
    b = await seedDevice(t);
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
  const a = await seedDevice(t),
    b = await seedDevice(t);
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
  ).rejects.toThrow();
  const device = await seedDevice(t);
  vi.mocked(verifyAppleIdentityToken).mockRejectedValueOnce(new Error("wrong audience"));
  await expect(appleSignIn(device)).rejects.toThrow("wrong audience");
  await expect(link(device)).rejects.toThrow("apple_sign_in_required");
});

it("rejects a forged Apple subject even with a valid device assertion", async () => {
  const t = harness();
  const device = await seedDevice(t);
  await appleSignIn(device);
  await expect(link(device, "someone-else")).rejects.toThrow("apple_sign_in_required");
  expect((await device.as.query(api.accounts.me, {})).linked).toBe(false);
});

it("consumes Apple challenges and rejects replay, expiration and another device’s challenge", async () => {
  const t = harness();
  const a = await seedDevice(t),
    b = await seedDevice(t);
  const { nonce } = await a.as.mutation(api.devices.createChallenge, { purpose: "apple" });
  const args = { sub: "apple-user", nonce };
  await expect(b.as.mutation(internal.appleLogin.recordVerifiedIdentity, args)).rejects.toThrow(
    "challenge_invalid",
  );
  await a.as.mutation(internal.appleLogin.recordVerifiedIdentity, args);
  await expect(a.as.mutation(internal.appleLogin.recordVerifiedIdentity, args)).rejects.toThrow(
    "challenge_invalid",
  );
  await t.run((ctx) =>
    ctx.db.patch(a.deviceId, { appleLinkProof: { sub: "apple-user", expiresAt: 0 } }),
  );
  await expect(link(a)).rejects.toThrow("apple_sign_in_required");
});

it("links idempotently and reports two devices without exposing the Apple subject", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await link(a);
  const me = await b.as.query(api.accounts.me, {});
  expect(me).toMatchObject({ linked: true, deviceCount: 2, email: "me@example.com" });
  expect(me).not.toHaveProperty("appleUserId");
});

it("aggregates trust on linking while leaving rate limits per device", async () => {
  const t = harness();
  const a = await seedDevice(t),
    b = await seedDevice(t);
  await t.run((ctx) => ctx.db.patch(a.deviceId, { trustWeight: 0.9 }));
  await appleSignIn(a);
  await link(a);
  await appleSignIn(b);
  await link(b);
  expect(await t.run((ctx) => ctx.db.get(b.deviceId))).toMatchObject({ trustWeight: 0.9 });
  for (let i = 0; i < 10; i++) await t.run((ctx) => limitDevice(ctx, "sync", a.deviceId));
  await expect(t.run((ctx) => limitDevice(ctx, "sync", a.deviceId))).rejects.toThrow(
    "rate_limited",
  );
  await expect(t.run((ctx) => limitDevice(ctx, "sync", b.deviceId))).resolves.toBeNull();
});

it("unlink removes only this device and clears pending proof so it cannot silently relink", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await a.as.mutation(api.accounts.unlink, {});
  expect(await a.as.query(api.accounts.me, {})).toMatchObject({ linked: false, deviceCount: 0 });
  expect(await b.as.query(api.accounts.me, {})).toMatchObject({ linked: true, deviceCount: 1 });
  await expect(link(a)).rejects.toThrow("apple_sign_in_required");
  expect(await t.run((ctx) => ctx.db.get(a.deviceId))).toMatchObject({ authUserId: a.userId });
});

it("deleting an account unlinks every device and removes its Apple auth association", async () => {
  const t = harness();
  const { a, b } = await pair(t);
  await a.as.mutation(api.accounts.deleteAccount, {});
  for (const device of [a, b])
    expect(await device.as.query(api.accounts.me, {})).toMatchObject({ linked: false });
  expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toHaveLength(0);
});

it("keeps interrupted claims linked until they can finish without stranding parents", async () => {
  const t = harness();
  const device = await seedDevice(t);
  await appleSignIn(device);
  await link(device);
  await expect(device.as.mutation(api.accounts.unlink, {})).rejects.toThrow("claim_required");
  await expect(device.as.mutation(api.accounts.deleteAccount, {})).rejects.toThrow(
    "claim_required",
  );
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
      });
      await ctx.db.insert("journalClaims", {
        deviceId,
        accountId,
        phase: "complete",
        createdAt: 1,
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
    });
    const stored = await ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
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
  expect(new Set(jobs.map((job) => job.name))).toEqual(new Set(["accounts:purgeJournal"]));
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
  expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
  vi.useRealTimers();
});

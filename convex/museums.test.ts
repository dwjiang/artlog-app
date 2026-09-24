import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { stableStringify } from "../shared/attestation/stable-stringify";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sha256 } from "./lib/appAttest";
import { authenticatorData, makeSigner, signAssertion } from "./lib/appAttest.fixtures";
import { seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type SignedIn } from "./test.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("APP_ATTEST_REQUIRED", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function proof(user: SignedIn, payload: object) {
  const { nonce } = await user.as.mutation(api.devices.createChallenge, {
    purpose: "assert",
  });
  return { nonce, assertionBase64: "", payloadJson: stableStringify(payload) };
}

async function fixture(overrides: Partial<Doc<"museums">> = {}) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, { website: "https://museum.example", ...overrides }));
  return { t, user, venueId };
}

const poi = {
  name: "New Museum",
  website: "https://new.example",
  lat: 10,
  lng: 20,
};
async function confirm(
  user: SignedIn,
  fields: Omit<FunctionArgs<typeof api.museums.confirmPoiVenue>, "nonce" | "assertionBase64" | "payloadJson"> = poi,
) {
  return user.as.mutation(api.museums.confirmPoiVenue, {
    ...fields,
    ...(await proof(user, { action: "museums.confirmPoiVenue", ...fields })),
  });
}

it("confirms a POI, inherits the nearest seeded region, and records its collection site", async () => {
  const { t, user } = await fixture({ lat: 10.1, lng: 20, region: "nearby" });
  await t.run((ctx) => seedMuseum(ctx, { lat: 10, lng: 20.5, region: "farther" }));
  await t.run((ctx) => seedMuseum(ctx, { lat: 10, lng: 20, seedSource: "poi", region: "ignore" }));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response('<a href="/objects/1">Work</a>'))),
  );
  const { venueId } = await confirm(user);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get("museums", venueId))).toMatchObject({
    key: expect.stringMatching(/^poi:/),
    seedSource: "poi",
    region: "nearby",
    platform: "emuseum",
    collectionSiteUrl: expect.any(String),
  });
  expect((await t.query(internal.ingest.counts, {})).museums).toBe(1);
});

it("deduplicates names within 100 m without replacing the existing website or probing again", async () => {
  const { t, user, venueId } = await fixture({
    name: "New Museum",
    lat: 10,
    lng: 20,
    website: undefined,
  });
  expect(await confirm(user, { ...poi, name: "  NEW   MUSEUM ", lat: 10.0005 })).toMatchObject({
    venueId,
  });
  expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.website).toBeUndefined();
});

it("does not deduplicate distant names and uses unknown region beyond 60 km", async () => {
  const { t, user, venueId } = await fixture({
    name: poi.name,
    lat: 11,
    lng: 20,
  });
  const result = await confirm(user, { ...poi, website: undefined });
  expect(result.venueId).not.toBe(venueId);
  expect((await t.run((ctx) => ctx.db.get("museums", result.venueId)))?.region).toBe("country:unknown");
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await t.run((ctx) => ctx.db.get("museums", result.venueId)))?.collectionSiteUrl).toBeUndefined();
});

it("deduplicates across the date line", async () => {
  const { user, venueId } = await fixture({
    name: poi.name,
    lat: 0,
    lng: 179.9998,
  });
  expect(await confirm(user, { ...poi, lat: 0, lng: -179.9998 })).toMatchObject({ venueId });
});

it("rate limits the sixth POI confirmation and validates coordinates and website", async () => {
  const { user } = await fixture();
  await expect(confirm(user, { ...poi, lat: 91 })).rejects.toThrow("invalid_venue");
  await expect(confirm(user, { ...poi, website: "http://127.0.0.1" })).rejects.toThrow("invalid_venue");
  for (let i = 0; i < 5; i++) await confirm(user);
  await expect(confirm(user)).rejects.toMatchObject({
    data: { code: "rate_limited", name: "venueConfirm" },
  });
});

it("requires a device and a fresh challenge even in simulator mode", async () => {
  const { t, user } = await fixture();
  const args = {
    ...poi,
    ...(await proof(user, { action: "museums.confirmPoiVenue", ...poi })),
  };
  await expect(t.mutation(api.museums.confirmPoiVenue, args)).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  await user.as.mutation(api.museums.confirmPoiVenue, args);
  await expect(user.as.mutation(api.museums.confirmPoiVenue, args)).rejects.toMatchObject({
    data: { code: "challenge_invalid" },
  });
});

it("verifies real signatures and binds the signature to the operation and its fields", async () => {
  const { t, user } = await fixture();
  vi.stubEnv("APP_ATTEST_REQUIRED", "true");
  await expect(confirm(user)).rejects.toMatchObject({
    data: { code: "device_not_attested" },
  });
  const appId = "TEAM.app.artlog.ios";
  vi.stubEnv("APP_ATTEST_APP_ID", appId);
  const signer = await makeSigner();
  await t.run((ctx) =>
    ctx.db.patch("devices", user.deviceId, {
      platform: "ios",
      attestPublicKey: signer.publicKeySpkiBase64,
    }),
  );
  const signed = await proof(user, {
    action: "museums.confirmPoiVenue",
    ...poi,
  });
  signed.assertionBase64 = await signAssertion(
    signer,
    authenticatorData(await sha256(appId), 1),
    `${signed.nonce}.${signed.payloadJson}`,
  );
  const elsewhere = { ...poi, lat: 11 };
  await expect(user.as.mutation(api.museums.confirmPoiVenue, { ...elsewhere, ...signed })).rejects.toMatchObject({
    data: { code: "invalid_payload" },
  });
  await expect(
    user.as.mutation(api.museums.confirmPoiVenue, {
      ...elsewhere,
      ...signed,
      payloadJson: stableStringify({
        action: "museums.confirmPoiVenue",
        ...elsewhere,
      }),
    }),
  ).rejects.toMatchObject({ data: { code: "invalid_assertion" } });
  expect(await user.as.mutation(api.museums.confirmPoiVenue, { ...poi, ...signed })).toMatchObject({
    venueId: expect.any(String),
  });
});

it("a probe with no collection leaves the site unset, and a late result cannot override an opt-out", async () => {
  const { t, venueId } = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response("About us"))),
  );
  await t.action(internal.museums.probeCollectionSite, { venueId });
  expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.collectionSiteUrl).toBeUndefined();
  await t.run((ctx) => ctx.db.patch("museums", venueId, { optOut: true }));
  await t.mutation(internal.museums.applyProbe, {
    venueId,
    website: "https://museum.example",
    result: {
      collectionSiteUrl: "https://museum.example/collection",
      platform: "generic",
    },
  });
  expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.collectionSiteUrl).toBeUndefined();
});

it("honors registry-only opt-outs: the probe never fetches", async () => {
  const { t, venueId } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("optOuts", {
      venueId,
      requester: "museum",
      receivedAt: Date.now(),
    }),
  );
  const fetchMock = vi.fn<typeof fetch>(async () => new Response("eMuseum"));
  vi.stubGlobal("fetch", fetchMock);
  await t.action(internal.museums.probeCollectionSite, { venueId });
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.collectionSiteUrl).toBeUndefined();
});

it("ignores a successful probe if an opt-out is recorded while it is fetching", async () => {
  const { t, venueId } = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await t.run((ctx) =>
        ctx.db.insert("optOuts", {
          venueId,
          requester: "museum",
          receivedAt: Date.now(),
        }),
      );
      return new Response("eMuseum");
    }),
  );
  await t.action(internal.museums.probeCollectionSite, { venueId });
  expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.collectionSiteUrl).toBeUndefined();
});

it.each([429, 503, "network"] as const)(
  "leaves the collection site unset after a temporary %s failure",
  async (failure) => {
    const { t, venueId } = await fixture();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (failure === "network") throw new TypeError("Network unavailable");
      return new Response("Try later", { status: failure });
    });
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.museums.probeCollectionSite, { venueId });
    expect((await t.run((ctx) => ctx.db.get("museums", venueId)))?.collectionSiteUrl).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  },
);

it("returns the canonical geography when MapKit confirms an existing museum", async () => {
  const { t, user, venueId } = await fixture({
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
  });
  await t.run((ctx) =>
    ctx.db.patch("museums", venueId, {
      city: "Paris",
      country: "FR",
      cityKey: "wikidata:Q90",
    }),
  );
  expect(await confirm(user, { ...poi, city: "Unverified city", country: "US" })).toMatchObject({
    venueId,
    venue: {
      id: venueId,
      city: "Paris",
      country: "FR",
      cityKey: "wikidata:Q90",
    },
  });
});

import { afterEach, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "./_generated/api";
import { seedDevice, seedMuseum } from "./lib/testFactories";
import { harness } from "./test.helpers";
import { LIMITS, utf8Bytes } from "../shared/journal/limits";

afterEach(() => vi.restoreAllMocks());
const save = () => ({
  localId: crypto.randomUUID(),
  snapshot: { title: "Water Lilies", artist: "Monet" },
  savedAt: 1,
  note: "private",
});
async function fixture() {
  const t = harness(),
    user = await seedDevice(t),
    other = await seedDevice(t);
  const venueId = await t.run(seedMuseum);
  const visit = {
    visibility: "public" as const,
    localId: crypto.randomUUID(),
    venueId,
    visitedOn: "2026-09-01",
    timeZone: "UTC",
  };
  const sync = async (device = user, input: Partial<FunctionArgs<typeof api.sync.syncJournal>> = {}) => {
    const { scope } = await device.as.query(api.accounts.me, {});
    return device.as.mutation(api.sync.syncJournal, {
      scope,
      since: 0,
      visits: [],
      saves: [],
      ...input,
    });
  };
  async function link(device = user, sub = "apple-owner") {
    await t.run((ctx) =>
      ctx.db.patch(device.deviceId, {
        appleLinkProof: { sub, expiresAt: Date.now() + 10000 },
      }),
    );
    return device.as.mutation(api.accounts.linkAccount, {
      appleUserId: sub,
      nonce: (
        await device.as.mutation(api.devices.createChallenge, {
          purpose: "assert",
        })
      ).nonce,
      assertionBase64: "",
    });
  }
  async function claim(device = user) {
    const { scope } = await device.as.query(api.accounts.me, {});
    let result;
    do {
      result = await device.as.mutation(api.journalClaims.resume, { scope });
    } while (!result.complete);
    return result;
  }
  return { t, user, other, visit, sync, link, claim };
}
it("syncs empty visits and later edits to artwork details without duplicating the artwork", async () => {
  const { t, user, visit, sync } = await fixture();
  const work = {
    ...save(),
    visitLocalId: visit.localId,
    venueId: visit.venueId,
  };
  const first = await sync(user, { visits: [visit], saves: [work] });
  expect(first.saves[0]).toMatchObject({
    visitLocalId: visit.localId,
    visitId: first.visits[0]._id,
  });
  const repeat = await sync(user, {
    visits: [visit],
    saves: [{ ...work, snapshot: { title: "Changed", artist: "" } }],
    since: first.checkpoint,
  });
  expect(repeat.saves).toMatchObject([{ snapshot: { title: "Changed", artist: "" } }]);
  expect(repeat.visits).toMatchObject([{ localId: visit.localId }]);
  expect(await t.run((ctx) => ctx.db.query("collections").collect())).toHaveLength(1);
});
it("uses auth ownership, never the caller scope, and hides missing or foreign parents", async () => {
  const { user, other, visit, sync } = await fixture();
  await sync(user, { visits: [visit], saves: [save()] });
  expect((await sync(other)).saves).toEqual([]);
  await expect(sync(other, { scope: user.scope, saves: [save()] })).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  await expect(
    sync(other, {
      saves: [{ ...save(), visitLocalId: visit.localId, venueId: visit.venueId }],
    }),
  ).rejects.toMatchObject({ data: { code: "not_found" } });
});
it("requires verified Apple proof and resumes bounded claiming after interruption", async () => {
  const { t, user, visit, sync, link, claim } = await fixture();
  await expect(
    user.as.mutation(api.accounts.linkAccount, {
      appleUserId: "forged",
      nonce: (
        await user.as.mutation(api.devices.createChallenge, {
          purpose: "assert",
        })
      ).nonce,
      assertionBase64: "",
    }),
  ).rejects.toMatchObject({ data: { code: "apple_sign_in_required" } });
  const work = {
    ...save(),
    visitLocalId: visit.localId,
    venueId: visit.venueId,
    deletedAt: 2,
  };
  const before = await sync(user, { visits: [visit], saves: [work] });
  for (let i = 0; i < 2; i++) {
    await sync(user, {
      visits: Array.from({ length: 50 }, () => ({
        ...visit,
        localId: crypto.randomUUID(),
      })),
    });
  }
  const accountId = await link();
  await expect(sync()).rejects.toMatchObject({
    data: { code: "claim_required" },
  });
  const { scope } = await user.as.query(api.accounts.me, {});
  const partial = await user.as.mutation(api.journalClaims.resume, { scope });
  expect(partial).toMatchObject({ complete: false, moved: 50 });
  await claim();
  await claim();
  const rows = await t.run((ctx) => ctx.db.query("collections").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    _id: before.saves[0]._id,
    owner: { kind: "account", accountId },
    deletedAt: 2,
    note: work.note,
    visitId: before.visits[0]._id,
  });
});
it("converges two devices to one canonical journal and survives sign-out and restoration", async () => {
  const { t, user, other, visit, sync, link, claim } = await fixture();
  const work = {
    ...save(),
    visitLocalId: visit.localId,
    venueId: visit.venueId,
  };
  await sync(user, { visits: [visit], saves: [work] });
  await link();
  await claim();
  await link(other);
  await claim(other);
  const imported = await sync(other);
  expect(imported.saves).toHaveLength(1);
  expect(imported.visits).toHaveLength(1);
  await sync(other, { saves: [{ ...work, note: "second device" }] });
  expect((await sync(user)).saves[0].note).toBe("second device");
  const stale = (await user.as.query(api.accounts.me, {})).scope;
  await user.as.mutation(api.accounts.unlink, {});
  expect((await sync(user)).saves).toEqual([]);
  await expect(sync(user, { scope: stale, saves: [work] })).rejects.toMatchObject({
    data: { code: "sync_scope_changed" },
  });
  await link();
  await claim();
  expect((await sync(user)).saves[0].note).toBe("second device");
  expect(await t.run((ctx) => ctx.db.query("collections").collect())).toHaveLength(1);
});
it("rejects UUID collisions without overwriting either owner and never claims another account", async () => {
  const { t, user, other, sync, link, claim } = await fixture();
  const work = save();
  await sync(user, { saves: [work] });
  await link();
  await claim();
  await sync(other, { saves: [{ ...work, note: "other original" }] });
  await link(other);
  await expect(claim(other)).rejects.toMatchObject({
    data: { code: "ownership_collision" },
  });
  const rows = await t.run((ctx) => ctx.db.query("collections").collect());
  expect(rows.map((row) => row.note).sort()).toEqual(["other original", "private"]);
  await user.as.mutation(api.accounts.unlink, {});
  await link(user, "new-account");
  await claim(user);
  expect((await sync(user)).saves).toEqual([]);
});
it("keeps deletion terminal through stale pushes and preserves its empty visit", async () => {
  const { user, visit, sync } = await fixture();
  const work = {
    ...save(),
    visitLocalId: visit.localId,
    venueId: visit.venueId,
  };
  await sync(user, { visits: [visit], saves: [work] });
  await sync(user, { saves: [{ ...work, deletedAt: 2 }] });
  expect((await sync(user, { saves: [{ ...work, note: "stale" }] })).saves[0]).toMatchObject({
    deletedAt: 2,
    note: "private",
  });
  expect((await sync()).visits).toHaveLength(1);
});
it("pages by monotonic versions even when all timestamps are equal, with parents before saves", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-14T12:00:00Z"));
  const { user, visit, sync } = await fixture();
  await sync(user, { visits: [visit] });
  const works = Array.from({ length: 70 }, () => ({
    ...save(),
    visitLocalId: visit.localId,
    venueId: visit.venueId,
  }));
  await sync(user, { saves: works.slice(0, 50) });
  await sync(user, { saves: works.slice(50) });
  let checkpoint = 0,
    more = true;
  const seen: string[] = [];
  while (more) {
    const result = await sync(user, { since: checkpoint });
    expect(result.visits.length + result.saves.length).toBeLessThanOrEqual(50);
    expect(utf8Bytes(result)).toBeLessThanOrEqual(LIMITS.batchBytes);
    for (const row of result.saves) {
      expect(result.visits.some((v) => v.localId === row.visitLocalId)).toBe(true);
    }
    seen.push(...result.saves.map((s) => s.localId));
    checkpoint = result.checkpoint;
    more = result.hasMore;
  }
  expect(new Set(seen).size).toBe(70);
  expect((await sync(user, { since: checkpoint })).saves).toEqual([]);
});
it("always delivers the first pending change so an oversized row cannot stall the pull", async () => {
  const { t, user, sync } = await fixture();
  const pushed = await sync(user, { saves: [save()] });
  await t.run((ctx) => ctx.db.patch(pushed.saves[0]._id, { note: "x".repeat(LIMITS.batchBytes) }));
  const page = await sync(user);
  expect(page.saves.map((row) => row._id)).toEqual([pushed.saves[0]._id]);
  expect(page).toMatchObject({ checkpoint: pushed.checkpoint, hasMore: false });
});
it("enforces record, byte, note, timestamp and authentication bounds", async () => {
  const { t, user, sync } = await fixture();
  await expect(
    t.mutation(api.sync.syncJournal, {
      visits: [],
      saves: [],
      since: 0,
      scope: user.scope,
    }),
  ).rejects.toMatchObject({ data: { code: "unauthenticated" } });
  for (const input of [
    { saves: Array.from({ length: 51 }, save) },
    { since: -1 },
    {
      saves: Array.from({ length: 30 }, () => ({
        ...save(),
        note: "x".repeat(20_000),
      })),
    },
  ]) {
    await expect(sync(user, input)).rejects.toMatchObject({
      data: { code: "invalid_sync" },
    });
  }
  for (const input of [{ savedAt: Infinity }, { note: "x".repeat(20_001) }, { localId: "not-uuid" }]) {
    await expect(sync(user, { saves: [{ ...save(), ...input }] })).rejects.toMatchObject({
      data: { code: "invalid_save" },
    });
  }
});
it("carries canonical venue geography to another device through the combined journal sync", async () => {
  const { t, user, other, visit, sync, link, claim } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch(visit.venueId, {
      city: "Paris",
      country: "FR",
      cityKey: "wikidata:Q90",
    }),
  );
  await sync(user, { visits: [visit] });
  await link();
  await claim();
  await link(other);
  await claim(other);
  expect((await sync(other)).venues).toEqual([
    expect.objectContaining({
      id: visit.venueId,
      city: "Paris",
      country: "FR",
      cityKey: "wikidata:Q90",
    }),
  ]);
});

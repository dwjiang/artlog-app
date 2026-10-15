import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "../shared/journal/limits";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { befriend, socialUser } from "./lib/socialTestFixtures";
import { seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

afterEach(() => vi.useRealTimers());

async function seedShows(t: Harness, count: number): Promise<Id<"exhibitions">[]> {
  return await t.run(async (ctx) => {
    const museumId = await seedMuseum(ctx);
    const ids = [];
    for (let index = 0; index < count; index++) {
      ids.push(
        await ctx.db.insert("exhibitions", {
          museumId,
          region: "sf-bay-area",
          titleKey: `show ${index}`,
          finalEndAt: Date.UTC(2027, 0, 1),
          title: `Show ${index}`,
          sourceUrl: `https://museum.example/shows/${index}`,
          sourceSha256: "a".repeat(64),
          checkedAt: 0,
          timeZone: "America/Los_Angeles",
          viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-12-31" }],
        }),
      );
    }
    return ids;
  });
}

const savedRows = (t: Harness) => t.run((ctx) => ctx.db.query("exhibitionSaves").collect());

describe("saving", () => {
  it("keeps a guest's saves on their device, newest first, and ignores repeated taps", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 12) });
    const t = harness();
    const guest = await seedDevice(t);
    const [first, second] = await seedShows(t, 2);

    await guest.as.mutation(api.wantToSee.set, { exhibitionId: first, saved: true });
    vi.advanceTimersByTime(1000);
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: second, saved: true });
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: first, saved: true });
    expect(await guest.as.query(api.wantToSee.mine, {})).toEqual([second, first]);

    await guest.as.mutation(api.wantToSee.set, { exhibitionId: first, saved: false });
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: first, saved: false });
    expect(await guest.as.query(api.wantToSee.mine, {})).toEqual([second]);
    expect(await savedRows(t)).toHaveLength(1);
  });

  it("refuses a show that is not listed", async () => {
    const t = harness();
    const guest = await seedDevice(t);
    const [gone] = await seedShows(t, 1);
    await t.run((ctx) => ctx.db.delete("exhibitions", gone));
    await expect(guest.as.mutation(api.wantToSee.set, { exhibitionId: gone, saved: true })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
  });

  it("never deletes saves, listing the newest within the limit and the newest 50 per friend", async () => {
    const t = harness();
    const ada = await socialUser(t, "Ada");
    const ben = await socialUser(t, "Ben");
    await befriend(ada, ben);
    const shows = await seedShows(t, LIMITS.wantToSee + 1);
    const owner = { kind: "account" as const, accountId: ada.accountId };
    await t.run(async (ctx) => {
      for (const [index, exhibitionId] of shows.entries()) {
        await ctx.db.insert("exhibitionSaves", { owner, exhibitionId, savedAt: index });
      }
    });

    const mine = await ada.as.query(api.wantToSee.mine, {});
    expect(mine).toHaveLength(LIMITS.wantToSee);
    expect(mine[0]).toBe(shows.at(-1));
    expect(await ben.as.query(api.wantToSee.friends, {})).toHaveLength(50);
    expect(await savedRows(t)).toHaveLength(LIMITS.wantToSee + 1);
  });
});

describe("friends", () => {
  it("shows a person's saves to accepted friends only, never across a block", async () => {
    const t = harness();
    const ada = await socialUser(t, "Ada");
    const ben = await socialUser(t, "Ben");
    const stranger = await socialUser(t, "Cy");
    const guest = await seedDevice(t);
    await befriend(ada, ben);
    const [show] = await seedShows(t, 1);
    await ada.as.mutation(api.wantToSee.set, { exhibitionId: show, saved: true });

    expect(await ben.as.query(api.wantToSee.friends, {})).toEqual([
      {
        exhibitionId: show,
        friend: { profileId: ada.profileId, name: "Ada", avatar: expect.any(String) },
        savedAt: expect.any(Number),
      },
    ]);
    expect(await stranger.as.query(api.wantToSee.friends, {})).toEqual([]);
    expect(await guest.as.query(api.wantToSee.friends, {})).toEqual([]);
    expect(await t.query(api.wantToSee.friends, {})).toEqual([]);

    await ada.as.mutation(api.friendships.block, { scope: ada.scope, profileId: ben.profileId });
    expect(await ben.as.query(api.wantToSee.friends, {})).toEqual([]);
  });
});

describe("accounts", () => {
  it("waits for a guest claim before changing saves, so the merge cannot restore a removal", async () => {
    const t = harness();
    const user = await socialUser(t, "Ada");
    const guest = await seedDevice(t);
    const [shared, another] = await seedShows(t, 2);
    await user.as.mutation(api.wantToSee.set, { exhibitionId: shared, saved: true });
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: shared, saved: true });
    await t.run(async (ctx) => {
      await ctx.db.patch("devices", guest.deviceId, { accountId: user.accountId });
      await ctx.db.insert("journalClaims", { deviceId: guest.deviceId, accountId: user.accountId, phase: "saves" });
    });

    await expect(guest.as.mutation(api.wantToSee.set, { exhibitionId: shared, saved: false })).rejects.toMatchObject({
      data: { code: "claim_required" },
    });
    await expect(guest.as.mutation(api.wantToSee.set, { exhibitionId: another, saved: true })).rejects.toMatchObject({
      data: { code: "claim_required" },
    });

    const scope = `account:${user.accountId}:0`;
    expect((await guest.as.mutation(api.journalClaims.resume, { scope })).complete).toBe(true);
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: shared, saved: false });
    await guest.as.mutation(api.wantToSee.set, { exhibitionId: another, saved: true });
    await guest.as.mutation(api.journalClaims.resume, { scope });
    expect(await guest.as.query(api.wantToSee.mine, {})).toEqual([another]);
  });

  it("finishes claiming saves beyond the display limit before sign-out can leave any behind", async () => {
    const t = harness();
    const user = await socialUser(t, "Ada");
    const guest = await seedDevice(t);
    const shows = await seedShows(t, LIMITS.wantToSee + 1);
    await t.run(async (ctx) => {
      for (const [index, exhibitionId] of shows.entries()) {
        await ctx.db.insert("exhibitionSaves", {
          owner: { kind: "device", deviceId: guest.deviceId },
          exhibitionId,
          savedAt: index,
        });
      }
      await ctx.db.patch("devices", guest.deviceId, { accountId: user.accountId });
      await ctx.db.insert("journalClaims", { deviceId: guest.deviceId, accountId: user.accountId, phase: "saves" });
    });

    const scope = `account:${user.accountId}:0`;
    let claim = await guest.as.mutation(api.journalClaims.resume, { scope });
    expect(claim.complete).toBe(false);
    await expect(guest.as.mutation(api.accounts.unlink, {})).rejects.toMatchObject({
      data: { code: "claim_required" },
    });
    for (let remaining = shows.length; !claim.complete && remaining > 0; remaining--) {
      claim = await guest.as.mutation(api.journalClaims.resume, { scope });
    }
    expect(claim.complete).toBe(true);
    const rows = await savedRows(t);
    expect(rows).toHaveLength(shows.length);
    expect(rows.every((row) => row.owner.kind === "account" && row.owner.accountId === user.accountId)).toBe(true);

    await guest.as.mutation(api.accounts.unlink, {});
    expect(await guest.as.query(api.wantToSee.mine, {})).toEqual([]);
  });

  it("moves a guest's saves to the account on sign-in, keeping one row per show", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 12) });
    const t = harness();
    const user = await socialUser(t, "Ada");
    const device = await seedDevice(t);
    const [both, guestOnly] = await seedShows(t, 2);
    await user.as.mutation(api.wantToSee.set, { exhibitionId: both, saved: true });
    vi.advanceTimersByTime(1000);
    await device.as.mutation(api.wantToSee.set, { exhibitionId: both, saved: true });
    await device.as.mutation(api.wantToSee.set, { exhibitionId: guestOnly, saved: true });
    await t.run(async (ctx) => {
      await ctx.db.patch("devices", device.deviceId, { accountId: user.accountId });
      await ctx.db.insert("journalClaims", { deviceId: device.deviceId, accountId: user.accountId, phase: "saves" });
    });

    const scope = `account:${user.accountId}:0`;
    while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}

    expect(new Set(await device.as.query(api.wantToSee.mine, {}))).toEqual(new Set([both, guestOnly]));
    expect(await savedRows(t)).toHaveLength(2);
  });

  it("deletes saves with the account", async () => {
    vi.useFakeTimers();
    const t = harness();
    const user = await socialUser(t, "Ada");
    const [show] = await seedShows(t, 1);
    await user.as.mutation(api.wantToSee.set, { exhibitionId: show, saved: true });

    await user.as.mutation(api.accounts.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await savedRows(t)).toEqual([]);
  });
});

describe("museums", () => {
  const seedMuseums = (t: Harness, count: number) =>
    t.run(async (ctx) => {
      const ids = [];
      for (let index = 0; index < count; index++) ids.push(await seedMuseum(ctx, { name: `Museum ${index}` }));
      return ids;
    });
  const museumRows = (t: Harness) => t.run((ctx) => ctx.db.query("museumSaves").collect());

  it("keeps a guest's saved museums, newest first, and ignores repeated taps", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 14) });
    const t = harness();
    const guest = await seedDevice(t);
    const [first, second] = await seedMuseums(t, 2);

    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: first, saved: true });
    vi.advanceTimersByTime(1000);
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: second, saved: true });
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: first, saved: true });
    expect(await guest.as.query(api.wantToSee.museums, {})).toEqual([second, first]);

    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: first, saved: false });
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: first, saved: false });
    expect(await guest.as.query(api.wantToSee.museums, {})).toEqual([second]);
    expect(await museumRows(t)).toHaveLength(1);
  });

  it("refuses a museum that is not listed", async () => {
    const t = harness();
    const guest = await seedDevice(t);
    const [gone] = await seedMuseums(t, 1);
    await t.run((ctx) => ctx.db.delete("museums", gone));
    await expect(guest.as.mutation(api.wantToSee.setMuseum, { museumId: gone, saved: true })).rejects.toMatchObject({
      data: { code: "not_found" },
    });
  });

  it("counts a save of a merged duplicate for the museum it merged into, and removes both together", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 14) });
    const t = harness();
    const guest = await seedDevice(t);
    const [survivor, duplicate] = await seedMuseums(t, 2);
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: duplicate, saved: true });
    vi.advanceTimersByTime(1000);
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: survivor, saved: true });
    await t.run((ctx) => ctx.db.patch("museums", duplicate, { excludedFromDiscovery: true, mergedInto: survivor }));

    expect(await guest.as.query(api.wantToSee.museums, {})).toEqual([survivor]);
    await guest.as.mutation(api.wantToSee.setMuseum, { museumId: survivor, saved: false });
    expect(await guest.as.query(api.wantToSee.museums, {})).toEqual([]);
    expect(await museumRows(t)).toEqual([]);
  });

  it("keeps saved museums private from friends", async () => {
    const t = harness();
    const ada = await socialUser(t, "Ada");
    const ben = await socialUser(t, "Ben");
    await befriend(ada, ben);
    const [museum] = await seedMuseums(t, 1);
    await ada.as.mutation(api.wantToSee.setMuseum, { museumId: museum, saved: true });

    expect(await ben.as.query(api.wantToSee.friends, {})).toEqual([]);
    expect(await ben.as.query(api.wantToSee.museums, {})).toEqual([]);
  });

  it("moves a guest's saved museums to the account on sign-in, keeping one row per museum", async () => {
    const t = harness();
    const user = await socialUser(t, "Ada");
    const device = await seedDevice(t);
    const [both, guestOnly] = await seedMuseums(t, 2);
    const [show] = await seedShows(t, 1);
    await user.as.mutation(api.wantToSee.setMuseum, { museumId: both, saved: true });
    await device.as.mutation(api.wantToSee.setMuseum, { museumId: both, saved: true });
    await device.as.mutation(api.wantToSee.setMuseum, { museumId: guestOnly, saved: true });
    await device.as.mutation(api.wantToSee.set, { exhibitionId: show, saved: true });
    await t.run(async (ctx) => {
      await ctx.db.patch("devices", device.deviceId, { accountId: user.accountId });
      await ctx.db.insert("journalClaims", { deviceId: device.deviceId, accountId: user.accountId, phase: "saves" });
    });

    await expect(
      device.as.mutation(api.wantToSee.setMuseum, { museumId: guestOnly, saved: false }),
    ).rejects.toMatchObject({ data: { code: "claim_required" } });
    const scope = `account:${user.accountId}:0`;
    while (!(await device.as.mutation(api.journalClaims.resume, { scope })).complete) {}

    expect(new Set(await device.as.query(api.wantToSee.museums, {}))).toEqual(new Set([both, guestOnly]));
    expect(await device.as.query(api.wantToSee.mine, {})).toEqual([show]);
    expect(await museumRows(t)).toHaveLength(2);
  });

  it("deletes saved museums with the account", async () => {
    vi.useFakeTimers();
    const t = harness();
    const user = await socialUser(t, "Ada");
    const [museum] = await seedMuseums(t, 1);
    await user.as.mutation(api.wantToSee.setMuseum, { museumId: museum, saved: true });

    await user.as.mutation(api.accounts.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await museumRows(t)).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import { harness } from "../test.helpers";
import { addSpend, assertUnderCap, dailyCap, reconcileSpend, recordSpend, spentToday, utcDay } from "./spend";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("daily spend", () => {
  it("formats the UTC day and reads caps from the environment with defaults", () => {
    expect(utcDay(Date.UTC(2026, 8, 9, 23, 59))).toBe("2026-09-09");
    expect(dailyCap("tokenFactory")).toBe(2000);
    expect(dailyCap("tavily")).toBe(2000);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "5");
    expect(dailyCap("tavily")).toBe(5);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "lots");
    expect(dailyCap("tavily")).toBe(2000);
  });

  it("accumulates the day's spend across its shards", async () => {
    const t = harness();
    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 2, tavilyCredits: 1 }));
    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 3 }));

    const rows = await t.run((ctx) => ctx.db.query("dailySpend").collect());
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.day === utcDay())).toBe(true);
    expect(await t.run((ctx) => spentToday(ctx, "tokenFactory"))).toBe(5);
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(1);
  });

  it("trips the cap at the configured value", async () => {
    vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "3");
    const t = harness();
    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 2 }));
    await expect(t.run((ctx) => assertUnderCap(ctx, "tokenFactory"))).resolves.toBeNull();

    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 1 }));
    await expect(t.run((ctx) => assertUnderCap(ctx, "tokenFactory"))).rejects.toMatchObject({
      data: { code: "spend_cap", kind: "tokenFactory", spent: 3, cap: 3 },
    });
  });

  it("admits a reservation that fits under the cap and refuses one that would exceed it", async () => {
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "20");
    const t = harness();
    await t.query(internal.spend.assertCap, { kind: "tavily", amount: 15 });
    await t.mutation(internal.spend.add, { kind: "tavily", amount: 15 });
    await expect(t.query(internal.spend.assertCap, { kind: "tavily", amount: 10 })).rejects.toMatchObject({
      data: { code: "spend_cap", kind: "tavily", spent: 15, cap: 20 },
    });
    await t.query(internal.spend.assertCap, { kind: "tavily", amount: 5 });
    await t.mutation(internal.spend.add, { kind: "tavily", amount: 5 });
    expect(await t.query(internal.spend.status, { kind: "tavily" })).toEqual({ spent: 20, cap: 20, underCap: false });
  });

  it("reconciles a reservation to reported usage without double-charging", async () => {
    const t = harness();
    const day = await t.run((ctx) => addSpend(ctx, "tavily", 10));
    await t.run((ctx) => reconcileSpend(ctx, "tavily", { day, reserved: 10, actual: 4 }));
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(4);
  });

  it("settles a call that crosses midnight against its reservation day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T23:59:59Z"));
    const t = harness();
    const day = await t.run((ctx) => addSpend(ctx, "tavily", 10));
    vi.setSystemTime(new Date("2026-09-10T00:00:01Z"));
    await t.run((ctx) => addSpend(ctx, "tavily", 15));
    await t.run((ctx) => reconcileSpend(ctx, "tavily", { day, reserved: 10, actual: 4 }));
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(15);
    const previous = await t.run((ctx) =>
      ctx.db
        .query("dailySpend")
        .withIndex("by_day", (q) => q.eq("day", "2026-09-09"))
        .collect(),
    );
    expect(previous.reduce((sum, row) => sum + row.tavilyCredits, 0)).toBe(4);
  });

  it.each([-1, NaN, Infinity])("refuses an invalid reservation amount %s", async (amount) => {
    const t = harness();
    await expect(t.run((ctx) => addSpend(ctx, "tavily", amount))).rejects.toMatchObject({
      data: { code: "invalid_spend" },
    });
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(0);
  });
});

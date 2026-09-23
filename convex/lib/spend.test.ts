import { afterEach, describe, expect, it, vi } from "vitest";

import { harness } from "../test.helpers";
import { internal } from "../_generated/api";
import {
  assertUnderCap,
  dailyCap,
  reconcileSpend,
  recordSpend,
  reserveSpend,
  spentToday,
  utcDay,
} from "./spend";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("daily spend", () => {
  it("formats the UTC day and reads caps from the environment with defaults", () => {
    expect(utcDay(Date.UTC(2026, 8, 9, 23, 59))).toBe("2026-09-09");
    expect(dailyCap("tokenFactory")).toBe(2000);
    expect(dailyCap("tavily")).toBe(20);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "5");
    expect(dailyCap("tavily")).toBe(5);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "lots");
    expect(dailyCap("tavily")).toBe(20);
  });

  it("accumulates spend in one row per day", async () => {
    const t = harness();
    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 2, tavilyCredits: 1 }));
    await t.run((ctx) => recordSpend(ctx, { tokenFactoryCalls: 3 }));

    const rows = await t.run((ctx) => ctx.db.query("dailySpend").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: utcDay(), tokenFactoryCalls: 5, tavilyCredits: 1 });
    expect(await t.run((ctx) => spentToday(ctx, "tokenFactory"))).toBe(5);
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

  it("reserves credit bounds atomically so reservations cannot exceed the cap", async () => {
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "20");
    const t = harness();
    await t.run((ctx) => reserveSpend(ctx, "tavily", 15));
    await expect(t.run((ctx) => reserveSpend(ctx, "tavily", 10))).rejects.toMatchObject({
      data: { code: "spend_cap", kind: "tavily", spent: 15, cap: 20 },
    });
    await t.run((ctx) => reserveSpend(ctx, "tavily", 5));
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(20);
  });

  it("reconciles a reservation to reported usage without double-charging", async () => {
    const t = harness();
    const day = await t.run((ctx) => reserveSpend(ctx, "tavily", 10));
    await t.run((ctx) => reconcileSpend(ctx, "tavily", { day, reserved: 10, actual: 4 }));
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(4);
  });

  it("settles a call that crosses midnight against its reservation day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T23:59:59Z"));
    const t = harness();
    const day = await t.run((ctx) => reserveSpend(ctx, "tavily", 10));
    vi.setSystemTime(new Date("2026-09-10T00:00:01Z"));
    await t.run((ctx) => reserveSpend(ctx, "tavily", 15));
    await t.run((ctx) => reconcileSpend(ctx, "tavily", { day, reserved: 10, actual: 4 }));
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(15);
    const previous = await t.run((ctx) =>
      ctx.db
        .query("dailySpend")
        .withIndex("by_day", (q) => q.eq("day", "2026-09-09"))
        .unique(),
    );
    expect(previous?.tavilyCredits).toBe(4);
  });

  it("admits only reservations that fit when callers arrive concurrently", async () => {
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "20");
    const t = harness();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        t.mutation(internal.spend.reserve, { kind: "tavily", amount: 6 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(18);
  });

  it.each([-1, NaN, Infinity])("refuses an invalid reservation amount %s", async (amount) => {
    const t = harness();
    await expect(t.run((ctx) => reserveSpend(ctx, "tavily", amount))).rejects.toMatchObject({
      data: { code: "invalid_spend" },
    });
    expect(await t.run((ctx) => spentToday(ctx, "tavily"))).toBe(0);
  });
});

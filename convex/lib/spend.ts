import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { env, type MutationCtx, type QueryCtx } from "../_generated/server";

export type SpendKind = "tokenFactory" | "tavily";

type SpendField = "tokenFactoryCalls" | "tavilyCredits";

const kinds: Record<SpendKind, { field: SpendField; variable: keyof typeof env; defaultCap: number }> = {
  tokenFactory: {
    field: "tokenFactoryCalls",
    variable: "DAILY_TOKEN_FACTORY_CALL_CAP",
    defaultCap: 2000,
  },
  tavily: {
    field: "tavilyCredits",
    variable: "DAILY_TAVILY_CREDIT_CAP",
    defaultCap: 2000,
  },
};

export function dailyCap(kind: SpendKind): number {
  const raw = env[kinds[kind].variable];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : kinds[kind].defaultCap;
}

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function getDay(ctx: QueryCtx | MutationCtx, day: string): Promise<Doc<"dailySpend"> | null> {
  return ctx.db
    .query("dailySpend")
    .withIndex("by_day", (q) => q.eq("day", day))
    .unique();
}

export async function spentToday(ctx: QueryCtx | MutationCtx, kind: SpendKind): Promise<number> {
  const row = await getDay(ctx, utcDay());
  return row ? row[kinds[kind].field] : 0;
}

export async function assertUnderCap(ctx: QueryCtx | MutationCtx, kind: SpendKind): Promise<void> {
  const spent = await spentToday(ctx, kind);
  const cap = dailyCap(kind);
  if (spent >= cap) {
    throw new ConvexError({ code: "spend_cap", kind, spent, cap });
  }
}

export type SpendDelta = { tokenFactoryCalls?: number; tavilyCredits?: number };

function requireAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ConvexError({ code: "invalid_spend" });
  }
}

async function adjustSpend(ctx: MutationCtx, day: string, delta: SpendDelta): Promise<void> {
  const now = Date.now();
  const row = await getDay(ctx, day);
  const next = {
    tokenFactoryCalls: (row?.tokenFactoryCalls ?? 0) + (delta.tokenFactoryCalls ?? 0),
    tavilyCredits: (row?.tavilyCredits ?? 0) + (delta.tavilyCredits ?? 0),
    updatedAt: now,
  };
  requireAmount(next.tokenFactoryCalls);
  requireAmount(next.tavilyCredits);
  if (row) await ctx.db.patch("dailySpend", row._id, next);
  else await ctx.db.insert("dailySpend", { day, ...next });
}

export async function recordSpend(ctx: MutationCtx, delta: SpendDelta): Promise<void> {
  requireAmount(delta.tokenFactoryCalls ?? 0);
  requireAmount(delta.tavilyCredits ?? 0);
  await adjustSpend(ctx, utcDay(), delta);
}

/**
 * Atomically counts `amount` against today's cap before a provider call is made, so concurrent
 * callers cannot collectively overshoot. Returns the UTC day to pass to `reconcileSpend` exactly
 * once when usage is known; retain the reservation after an ambiguous timeout.
 */
export async function reserveSpend(ctx: MutationCtx, kind: SpendKind, amount: number): Promise<string> {
  requireAmount(amount);
  const day = utcDay();
  const spent = await spentToday(ctx, kind);
  const cap = dailyCap(kind);
  if (spent + amount > cap) {
    throw new ConvexError({ code: "spend_cap", kind, spent, cap });
  }
  await adjustSpend(ctx, day, { [kinds[kind].field]: amount });
  return day;
}

export async function reconcileSpend(
  ctx: MutationCtx,
  kind: SpendKind,
  usage: { day: string; reserved: number; actual: number },
): Promise<void> {
  requireAmount(usage.reserved);
  requireAmount(usage.actual);
  const row = await getDay(ctx, usage.day);
  if (!row || row[kinds[kind].field] < usage.reserved) {
    throw new ConvexError({ code: "invalid_spend" });
  }
  await adjustSpend(ctx, usage.day, {
    [kinds[kind].field]: usage.actual - usage.reserved,
  });
}

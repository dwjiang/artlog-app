import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { type ActionCtx, env, type MutationCtx, type QueryCtx } from "../_generated/server";

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

// Concurrent paid calls write different rows; a mutation that read the day's total would serialise them all.
const SHARDS = 16;

export function dailyCap(kind: SpendKind): number {
  const raw = env[kinds[kind].variable];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : kinds[kind].defaultCap;
}

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function dayRows(ctx: QueryCtx | MutationCtx, day: string): Promise<Doc<"dailySpend">[]> {
  return ctx.db
    .query("dailySpend")
    .withIndex("by_day", (q) => q.eq("day", day))
    .take(SHARDS);
}

export async function spentToday(ctx: QueryCtx | MutationCtx, kind: SpendKind): Promise<number> {
  const rows = await dayRows(ctx, utcDay());
  return rows.reduce((sum, row) => sum + row[kinds[kind].field], 0);
}

export async function assertUnderCap(ctx: QueryCtx | MutationCtx, kind: SpendKind, amount = 0): Promise<void> {
  const spent = await spentToday(ctx, kind);
  const cap = dailyCap(kind);
  if (spent >= cap || spent + amount > cap) {
    throw new ConvexError({ code: "spend_cap", kind, spent, cap });
  }
}

export type SpendDelta = { tokenFactoryCalls?: number; tavilyCredits?: number };

function requireAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ConvexError({ code: "invalid_spend" });
  }
}

// A random shard takes the write. A shard can go negative after a reconciliation; the day's sum cannot.
async function adjustSpend(ctx: MutationCtx, day: string, delta: SpendDelta): Promise<void> {
  const shard = Math.floor(Math.random() * SHARDS);
  const row = await ctx.db
    .query("dailySpend")
    .withIndex("by_day", (q) => q.eq("day", day).eq("shard", shard))
    .unique();
  const next = {
    tokenFactoryCalls: (row?.tokenFactoryCalls ?? 0) + (delta.tokenFactoryCalls ?? 0),
    tavilyCredits: (row?.tavilyCredits ?? 0) + (delta.tavilyCredits ?? 0),
    updatedAt: Date.now(),
  };
  if (row) await ctx.db.patch("dailySpend", row._id, next);
  else await ctx.db.insert("dailySpend", { day, shard, ...next });
}

export async function recordSpend(ctx: MutationCtx, delta: SpendDelta): Promise<void> {
  requireAmount(delta.tokenFactoryCalls ?? 0);
  requireAmount(delta.tavilyCredits ?? 0);
  await adjustSpend(ctx, utcDay(), delta);
}

export async function addSpend(ctx: MutationCtx, kind: SpendKind, amount: number): Promise<string> {
  requireAmount(amount);
  const day = utcDay();
  await adjustSpend(ctx, day, { [kinds[kind].field]: amount });
  return day;
}

/**
 * Counts `amount` against today's cap before a provider call is made. The check is a query and the
 * write lands on a random shard, so callers never serialise on one document; a burst can overshoot
 * the cap by at most the calls in flight. Returns the UTC day to pass to `reconcileSpend` exactly once
 * when usage is known; retain the reservation after an ambiguous timeout.
 */
export async function reserveSpend(ctx: ActionCtx, kind: SpendKind, amount: number): Promise<string> {
  requireAmount(amount);
  await ctx.runQuery(internal.spend.assertCap, { kind, amount });
  return ctx.runMutation(internal.spend.add, { kind, amount });
}

export async function reconcileSpend(
  ctx: MutationCtx,
  kind: SpendKind,
  usage: { day: string; reserved: number; actual: number },
): Promise<void> {
  requireAmount(usage.reserved);
  requireAmount(usage.actual);
  if (usage.actual === usage.reserved) return;
  await adjustSpend(ctx, usage.day, { [kinds[kind].field]: usage.actual - usage.reserved });
}

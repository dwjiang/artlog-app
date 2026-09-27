import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { addSpend, assertUnderCap, dailyCap, reconcileSpend, recordSpend, spentToday } from "./lib/spend";

const spendKind = v.union(v.literal("tokenFactory"), v.literal("tavily"));

export const record = internalMutation({
  args: {
    tokenFactoryCalls: v.optional(v.number()),
    tavilyCredits: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordSpend(ctx, args);
    return null;
  },
});

// Callers check the cap through `assertCap` first; see `reserveSpend`.
export const add = internalMutation({
  args: { kind: spendKind, amount: v.number() },
  returns: v.string(),
  handler: (ctx, args) => addSpend(ctx, args.kind, args.amount),
});

export const reconcile = internalMutation({
  args: {
    kind: spendKind,
    day: v.string(),
    reserved: v.number(),
    actual: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await reconcileSpend(ctx, args.kind, args);
    return null;
  },
});

export const status = internalQuery({
  args: { kind: spendKind },
  returns: v.object({
    spent: v.number(),
    cap: v.number(),
    underCap: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const spent = await spentToday(ctx, args.kind);
    const cap = dailyCap(args.kind);
    return { spent, cap, underCap: spent < cap };
  },
});

export const assertCap = internalQuery({
  args: { kind: spendKind, amount: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertUnderCap(ctx, args.kind, args.amount);
    return null;
  },
});

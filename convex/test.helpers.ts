/// <reference types="vite/client" />
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";
import { v } from "convex/values";
import { vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { databaseTriggers } from "./lib/databaseTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

export type Harness = TestConvex<typeof schema>;

export type SignedIn = {
  userId: Id<"users">;
  as: ReturnType<Harness["withIdentity"]>;
};

export function harness(
  options: { transactionLimits?: Parameters<typeof convexTest>[0]["transactionLimits"]; vectorSync?: boolean } = {},
): Harness {
  const { vectorSync, ...limits } = options;
  const testModules = vectorSync
    ? modules
    : {
        ...modules,
        "./vectorSync.ts": async () => ({
          ...(await import("./vectorSync")),
          drain: internalAction({ args: {}, returns: v.number(), handler: async () => 0 }),
        }),
      };
  const t = convexTest({ schema, modules: testModules, ...limits });
  register(t);
  const { run } = t;
  t.run = (handler) => run((ctx) => handler(databaseTriggers.wrapDB(ctx)));
  return t;
}

// Convex Auth encodes the subject as `${userId}|${sessionId}`; getAuthUserId splits on the bar.
export async function signIn(t: Harness): Promise<SignedIn> {
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60 * 60 * 1000,
    }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

// Runs the promotion pass a runner-up resolution queues for its work and venue. Needs fake timers.
export async function promoteGroup(t: Harness, objectId: Id<"objects">, venueId: Id<"museums">): Promise<void> {
  await t.mutation(internal.promotion.findGroupAgreement, { objectId, venueId, cursor: null, witnesses: [] });
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
}

const realSetTimeout = globalThis.setTimeout;

/**
 * Runs scheduled functions due by `through` under fake timers, pumping the clock so actions that wait between requests
 * to a host can finish.
 */
export async function runScheduled(t: Harness, through = Date.now() + 10 * 60_000): Promise<void> {
  for (let step = 0; step < 1000; step++) {
    await vi.advanceTimersByTimeAsync(0);
    let finished = false;
    const finishing = t.finishInProgressScheduledFunctions().then(() => {
      finished = true;
    });
    for (let pump = 0; !finished && pump < 1000; pump++) {
      await new Promise((resolve) => realSetTimeout(resolve, 0));
      if (!finished) await vi.advanceTimersByTimeAsync(1000);
    }
    if (!finished) throw new Error("Scheduled worker did not finish");
    await finishing;
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    // A job finishing can start another, which is already under way rather than pending.
    if (jobs.some((job) => job.state.kind === "inProgress")) continue;
    const next = Math.min(...jobs.filter((job) => job.state.kind === "pending").map((job) => job.scheduledTime));
    if (!Number.isFinite(next) || next > through) return;
    if (next <= Date.now()) await vi.advanceTimersToNextTimerAsync();
    else await vi.advanceTimersByTimeAsync(next - Date.now());
  }
  throw new Error("Scheduled functions did not settle");
}

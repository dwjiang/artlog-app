/// <reference types="vite/client" />
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";
import { vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

export type Harness = TestConvex<typeof schema>;

export type SignedIn = {
  userId: Id<"users">;
  as: ReturnType<Harness["withIdentity"]>;
};

export function harness(options: { transactionLimits?: boolean } = {}): Harness {
  const t = convexTest({ schema, modules, ...options });
  register(t);
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
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

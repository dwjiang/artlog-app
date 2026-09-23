/// <reference types="vite/client" />
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvex } from "convex-test";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

export type Harness = TestConvex<typeof schema>;

export type SignedIn = { userId: Id<"users">; as: ReturnType<Harness["withIdentity"]> };

export function harness(options: { transactionLimits?: boolean } = {}): Harness {
  const t = convexTest({ schema, modules, ...options });
  register(t);
  return t;
}

// Convex Auth encodes the subject as `${userId}|${sessionId}`; getAuthUserId splits on the bar.
export async function signIn(t: Harness): Promise<SignedIn> {
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60 * 60 * 1000 }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

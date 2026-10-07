import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";

import { isEnabled } from "./flags";

// artlog-bot's docs/artlog-integration.md owns these claims; the bot signs them with the key in DEMO_BOT_JWKS.
export const DEMO_BOT_ISSUER = "https://artlog-bot.invalid/bot";
export const DEMO_BOT_AUDIENCE = "artlog-demo-activity";
const DEMO_BOT_SUBJECT = "artlog-bot";

/** Admits only the demo bot's service token, and only while the kill switch is on. */
export async function requireDemoBot(ctx: { auth: Auth }): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.issuer !== DEMO_BOT_ISSUER || identity.subject !== DEMO_BOT_SUBJECT) {
    throw new ConvexError({ code: "unauthenticated" });
  }
  if (!isEnabled("demoActivity")) throw new ConvexError({ code: "feature_off" });
}

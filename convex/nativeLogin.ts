import { v } from "convex/values";

import { consumeChallenge } from "./devices";
import { internalMutation } from "./functions";
import { requireDevice } from "./lib/auth";
import { accountProvider } from "./lib/validators";

export const recordVerifiedIdentity = internalMutation({
  args: { provider: accountProvider, sub: v.string(), email: v.optional(v.string()), nonce: v.string() },
  returns: v.null(),
  handler: async (ctx, { provider, sub, email, nonce }) => {
    const device = await requireDevice(ctx);
    await consumeChallenge(ctx, device, nonce, provider);
    await ctx.db.patch("devices", device._id, {
      accountLinkProof: { provider, sub, email, expiresAt: Date.now() + 5 * 60_000 },
    });
    return null;
  },
});

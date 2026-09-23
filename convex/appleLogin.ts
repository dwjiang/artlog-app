import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { consumeChallenge } from "./devices";
import { requireDevice } from "./lib/auth";

export const recordVerifiedIdentity = internalMutation({
  args: { sub: v.string(), email: v.optional(v.string()), nonce: v.string() },
  returns: v.null(),
  handler: async (ctx, { sub, email, nonce }) => {
    const device = await requireDevice(ctx);
    await consumeChallenge(ctx, device, nonce, "apple");
    await ctx.db.patch(device._id, {
      appleLinkProof: { sub, email, expiresAt: Date.now() + 5 * 60_000 },
    });
    return null;
  },
});

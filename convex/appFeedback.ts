import { ConvexError, v } from "convex/values";

import { ownerKey } from "../shared/journal/contracts";
import { LIMITS } from "../shared/journal/limits";
import { mutation } from "./functions";
import { resolveOwner } from "./lib/ownership";
import { limitKey } from "./lib/rateLimits";

const MAX_VERSION_CHARS = 40;

export const submit = mutation({
  args: {
    message: v.string(),
    appVersion: v.string(),
    osVersion: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { appVersion, osVersion, ...args }) => {
    const { owner } = await resolveOwner(ctx);
    const message = args.message.trim();
    if (
      !message
      || message.length > LIMITS.feedbackMessage
      || appVersion.length > MAX_VERSION_CHARS
      || osVersion.length > MAX_VERSION_CHARS
    ) {
      throw new ConvexError({ code: "invalid_feedback" });
    }
    await limitKey(ctx, "appFeedback", ownerKey(owner));
    await ctx.db.insert("appFeedback", { owner, message, appVersion, osVersion, createdAt: Date.now() });
    return null;
  },
});

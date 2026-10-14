import { v } from "convex/values";

import { internalMutation } from "./functions";
import { demoPersonArgs, insertDemoPerson } from "./lib/demoAccounts";
import { reviewProviderUserId } from "./lib/reviewFriend";

export const seed = internalMutation({
  args: demoPersonArgs,
  returns: v.id("profiles"),
  handler: (ctx, input) =>
    insertDemoPerson(ctx, reviewProviderUserId(input.username), {
      ...input,
      leaderboardVisibility: "off",
      joinedAt: Date.now(),
    }),
});

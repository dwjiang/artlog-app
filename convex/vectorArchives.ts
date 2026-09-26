import { ConvexError, v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { expireVectorArchiveIfUnreferenced } from "./lib/vectorStore";

export const discard = internalMutation({
  args: { ids: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    if (ids.length > 500) throw new ConvexError({ code: "batch_too_large", max: 500 });
    for (const id of ids) await expireVectorArchiveIfUnreferenced(ctx, id);
    return null;
  },
});

import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { deleteOrbIfUnreferenced } from "./lib/orbStorage";

// A lost action response can follow a successful commit; only unreferenced files may be discarded.
export const discard = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { storageIds }) => {
    for (const id of storageIds) await deleteOrbIfUnreferenced(ctx, id);
    return null;
  },
});

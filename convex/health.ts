import { v } from "convex/values";

import model from "../shared/model/model-version.json";
import { query } from "./_generated/server";

export const ping = query({
  args: {},
  returns: v.object({
    ok: v.literal(true),
    time: v.number(),
    modelVersion: v.string(),
  }),
  handler: async () => ({
    ok: true as const,
    time: Date.now(),
    modelVersion: model.modelVersion,
  }),
});

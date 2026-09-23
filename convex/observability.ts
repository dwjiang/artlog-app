import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { reportBackendError } from "./lib/observability";

export const verify = internalAction({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (): Promise<string | null> =>
    reportBackendError(new Error("Backend Sentry delivery check"), "observability.verify"),
});

import { v } from "convex/values";

import { parseIosBuild } from "../shared/app-compatibility";
import { env, query } from "./_generated/server";

// Keep this startup contract available independently of authentication and app data schemas.
export const get = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: () => {
    const minimum = env.MINIMUM_IOS_BUILD;
    if (minimum === undefined) return null;
    if (!parseIosBuild(minimum)) throw new Error("Invalid MINIMUM_IOS_BUILD");
    return minimum;
  },
});

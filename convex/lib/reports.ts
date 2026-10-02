import type { Infer } from "convex/values";

import type { JournalOwner } from "../../shared/journal/contracts";
import type { reportTarget } from "../../shared/social/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function findOpenReport(ctx: QueryCtx, reporter: JournalOwner, target: Infer<typeof reportTarget>) {
  return ctx.db
    .query("reports")
    .withIndex("by_reporter_target_status", (q) => q.eq("reporter", reporter).eq("target", target).eq("status", "open"))
    .unique();
}

export const profileEvidence = (profile: Doc<"profiles">) => ({
  kind: "profile" as const,
  profileId: profile._id,
  username: profile.username,
  name: profile.name,
  bio: profile.bio,
});

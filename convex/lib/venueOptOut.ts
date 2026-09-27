import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export async function isVenueOptedOut(ctx: QueryCtx, venue: Doc<"museums">): Promise<boolean> {
  return (
    venue.optOut
    || (await ctx.db
      .query("optOuts")
      .withIndex("by_venueId", (q) => q.eq("target.venueId", venue._id))
      .first()) !== null
  );
}

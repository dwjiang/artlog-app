import { v } from "convex/values";

import { journalVenue } from "../shared/journal/venue";
import type { Id } from "./_generated/dataModel";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { projectJournalVenue } from "./lib/journalVenue";

export const CHANGES_PAGE_SIZE = 500;

async function latestChangeVersion(ctx: QueryCtx): Promise<number> {
  const latest = await ctx.db.query("venueChanges").withIndex("by_changeVersion").order("desc").first();
  return latest?.changeVersion ?? 0;
}

/**
 * Moves each venue to a new change version so phones holding an older table fetch it. Every writer
 * reads the latest version, so concurrent writers serialize and a phone's checkpoint cannot pass a
 * change that commits later, as it could with timestamps.
 */
export async function recordVenueChanges(ctx: MutationCtx, venueIds: Id<"museums">[]): Promise<void> {
  let changeVersion = await latestChangeVersion(ctx);
  for (const venueId of venueIds) {
    changeVersion += 1;
    const existing = await ctx.db
      .query("venueChanges")
      .withIndex("by_venueId", (q) => q.eq("venueId", venueId))
      .unique();
    if (existing) await ctx.db.patch("venueChanges", existing._id, { changeVersion });
    else await ctx.db.insert("venueChanges", { venueId, changeVersion });
  }
}

/** The version an exported table starts from; read before paging so changes made during the export are fetched again. */
export const latestVersion = internalQuery({
  args: {},
  returns: v.number(),
  handler: latestChangeVersion,
});

export const list = query({
  args: { since: v.number() },
  returns: v.object({ venues: v.array(journalVenue), checkpoint: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, { since }) => {
    const changes = await ctx.db
      .query("venueChanges")
      .withIndex("by_changeVersion", (q) => q.gt("changeVersion", since))
      .take(CHANGES_PAGE_SIZE);
    const venues = await Promise.all(changes.map((change) => ctx.db.get("museums", change.venueId)));
    return {
      venues: venues.flatMap((venue) => (venue ? [projectJournalVenue(venue)] : [])),
      checkpoint: changes.at(-1)?.changeVersion ?? since,
      hasMore: changes.length === CHANGES_PAGE_SIZE,
    };
  },
});

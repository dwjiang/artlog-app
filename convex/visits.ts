import { ConvexError, v } from "convex/values";

import { journalVisit, pageArgs, pagination } from "../shared/journal/contracts";
import { mutation, query } from "./_generated/server";
import { upsertJournalVisit } from "./lib/journal";
import { findOwnedVisit, requireJournalOwner, requireMembership } from "./lib/ownership";
import { limitDevice } from "./lib/rateLimits";
import schema from "./schema";

export const detail = query({
  args: { scope: v.string(), localId: v.string() },
  returns: schema.doc("visits"),
  handler: async (ctx, { scope, localId }) => {
    const { owner } = await requireJournalOwner(ctx, scope);
    const visit = await findOwnedVisit(ctx, owner, localId);
    if (!visit) throw new ConvexError({ code: "not_found" });
    return visit;
  },
});

export const history = query({
  args: {
    scope: v.string(),
    venueId: v.optional(v.id("museums")),
    ...pageArgs,
  },
  returns: v.object({
    page: v.array(schema.doc("visits")),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { owner } = await requireJournalOwner(ctx, args.scope);
    const rows = args.venueId
      ? ctx.db
          .query("visits")
          .withIndex("by_owner_venue_history", (q) => q.eq("owner", owner).eq("venueId", args.venueId!))
      : ctx.db.query("visits").withIndex("by_owner_history", (q) => q.eq("owner", owner));
    const result = await rows.order("desc").paginate(pagination(args));
    return {
      page: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const savedWorks = query({
  args: { scope: v.string(), localId: v.string(), ...pageArgs },
  returns: v.object({
    page: v.array(schema.doc("collections")),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { owner } = await requireJournalOwner(ctx, args.scope);
    const visit = await findOwnedVisit(ctx, owner, args.localId);
    if (!visit) throw new ConvexError({ code: "not_found" });
    const result = await ctx.db
      .query("artworkEncounters")
      .withIndex("by_visitId", (q) => q.eq("visitId", visit._id))
      .order("desc")
      .paginate(pagination(args));
    const page = [];
    for (const encounter of result.page) {
      if (encounter.deletedAt === undefined) {
        const save = await ctx.db.get("collections", encounter.saveId);
        if (!save || save.deletedAt !== undefined) continue;
        await requireMembership(ctx, save, visit);
        page.push(save);
      }
    }
    return {
      page,
      cursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const upsertJournal = mutation({
  args: { scope: v.string(), visit: journalVisit },
  returns: schema.doc("visits"),
  handler: async (ctx, { scope, visit }) => {
    const { owner, device } = await requireJournalOwner(ctx, scope);
    await limitDevice(ctx, "sync", device._id);
    return upsertJournalVisit(ctx, owner, device._id, visit);
  },
});

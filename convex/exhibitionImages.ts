import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { backgroundClient, eachConcurrently } from "./exhibitionRefresh";
import { internalMutation } from "./functions";
import { isEnabled } from "./lib/flags";
import { withErrorReporting } from "./lib/observability";
import { findShowImages } from "./lib/showImages";
import { isVenueOptedOut } from "./lib/venueOptOut";

// Shows per batch; at about two per museum, a batch's museums finish well inside its budget.
const PAGE_SIZE = 30;
const MUSEUM_READERS = 6;
// Actions stop after ten minutes, and a site may ask for ten seconds between requests; shows left are looked up next run.
const BATCH_BUDGET_MS = 5 * 60 * 1000;

const dueShow = v.object({ exhibitionId: v.id("exhibitions"), title: v.string(), sourceUrl: v.string() });

/**
 * Looks up pictures for current shows never looked up, one batch of museums after another. Runs daily after the
 * listing refresh; shows whose pages were unavailable stay due for the next run.
 */
export const lookUpDue = internalMutation({
  args: { asOf: v.optional(v.number()), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { asOf = Date.now(), cursor }) => {
    if (!isEnabled("exhibitionRefresh")) return null;
    const { page, isDone, continueCursor } = await ctx.db
      .query("exhibitions")
      .withIndex("by_imageCheckedAt_finalEndAt", (q) => q.eq("imageCheckedAt", undefined).gte("finalEndAt", asOf))
      .paginate({ cursor: cursor ?? null, numItems: PAGE_SIZE });
    if (page.length === 0) return null;
    await ctx.scheduler.runAfter(0, internal.exhibitionImages.lookUpBatch, {
      museumIds: [...new Set(page.map((row) => row.museumId))],
      asOf,
      ...(isDone ? {} : { cursor: continueCursor }),
    });
    return null;
  },
});

export const loadMuseum = internalQuery({
  args: { museumId: v.id("museums"), asOf: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      website: v.string(),
      listingUrls: v.array(v.string()),
      checked: v.array(v.object({ sourceUrl: v.string(), imageUrl: v.optional(v.string()) })),
      due: v.array(dueShow),
    }),
  ),
  handler: async (ctx, { museumId, asOf }) => {
    if (!isEnabled("exhibitionRefresh")) return null;
    const museum = await ctx.db.get("museums", museumId);
    if (!museum?.website || (await isVenueOptedOut(ctx, museum))) return null;
    const current = await ctx.db
      .query("exhibitions")
      .withIndex("by_museum_finalEndAt", (q) => q.eq("museumId", museumId).gte("finalEndAt", asOf))
      .collect();
    const due = current.filter((show) => show.imageCheckedAt === undefined);
    if (due.length === 0) return null;
    const source = await ctx.db
      .query("exhibitionSources")
      .withIndex("by_museumId", (q) => q.eq("museumId", museumId))
      .unique();
    return {
      website: museum.website,
      listingUrls: source?.urls.map(({ url }) => url) ?? [],
      checked: current.flatMap((show) =>
        show.imageCheckedAt === undefined
          ? []
          : [{ sourceUrl: show.sourceUrl, ...(show.imageUrl === undefined ? {} : { imageUrl: show.imageUrl }) }],
      ),
      due: due.map((show) => ({ exhibitionId: show._id, title: show.title, sourceUrl: show.sourceUrl })),
    };
  },
});

async function lookUpMuseum(
  ctx: ActionCtx,
  follow: ReturnType<typeof backgroundClient>["follow"],
  museumId: Id<"museums">,
  deadline: number,
) {
  const checkedAt = Date.now();
  const museum = await ctx.runQuery(internal.exhibitionImages.loadMuseum, { museumId, asOf: checkedAt });
  if (!museum) return;
  const images = await findShowImages(follow, museum, deadline);
  const results = museum.due.flatMap(({ exhibitionId, sourceUrl }, index) => {
    const image = images[index];
    if (image === "unavailable") return [];
    return [{ exhibitionId, sourceUrl, ...(image === "none" ? {} : { imageUrl: image.imageUrl }) }];
  });
  if (results.length > 0) await ctx.runMutation(internal.exhibitionImages.recordImages, { checkedAt, results });
}

/**
 * Looks up a batch of museums, then starts the next. One batch at a time holds a single one of the deployment's few
 * scheduled-job slots, so other background work is not kept waiting.
 */
export const lookUpBatch = internalAction({
  args: { museumIds: v.array(v.id("museums")), asOf: v.number(), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, { museumIds, asOf, cursor }) =>
    withErrorReporting("exhibitionImages.lookUpBatch", async () => {
      const deadline = Date.now() + BATCH_BUDGET_MS;
      const { follow } = backgroundClient(ctx);
      await eachConcurrently(museumIds, MUSEUM_READERS, (museumId) => lookUpMuseum(ctx, follow, museumId, deadline));
      if (cursor !== undefined) await ctx.scheduler.runAfter(0, internal.exhibitionImages.lookUpDue, { asOf, cursor });
      return null;
    }),
});

/** Marks each show looked up, keeping a picture it already has unless the lookup found its own. */
export const recordImages = internalMutation({
  args: {
    checkedAt: v.number(),
    results: v.array(
      v.object({ exhibitionId: v.id("exhibitions"), sourceUrl: v.string(), imageUrl: v.optional(v.string()) }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { checkedAt, results }) => {
    for (const { exhibitionId, sourceUrl, imageUrl } of results) {
      const show = await ctx.db.get("exhibitions", exhibitionId);
      // A show the refresh cites from another page since, or checked by a later lookup, stays as it is.
      if (!show || show.sourceUrl !== sourceUrl || (show.imageCheckedAt ?? -1) >= checkedAt) continue;
      await ctx.db.patch("exhibitions", exhibitionId, {
        imageCheckedAt: checkedAt,
        imagePending: undefined,
        ...(imageUrl ? { imageUrl } : {}),
      });
    }
    return null;
  },
});

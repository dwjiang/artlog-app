import { type Infer, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { readArtworkContent } from "./lib/artworkContent";
import { currentPlacement } from "./lib/placements";
import schema from "./schema";

const STALE_CLAIM_MS = 60 * 60 * 1000;
const MAX_LIMIT = 100;
const batchCursor = v.object({
  phase: v.union(v.literal("contributions"), v.literal("artworks")),
  cursor: v.union(v.string(), v.null()),
});
export type BatchCursor = Infer<typeof batchCursor>;

async function claimable(ctx: QueryCtx, artwork: Doc<"artworks">, now: number): Promise<boolean> {
  return (
    artwork.identityStatus === "established"
    && artwork.retiredAt === undefined
    && !artwork.factSheetNeedsReview
    && (artwork.enrichClaimedAt === undefined || artwork.enrichClaimedAt < now - STALE_CLAIM_MS)
    && !(await readArtworkContent(ctx, artwork))?.docent?.en?.length
  );
}

async function onView(ctx: QueryCtx, artworkId: Id<"artworks">, now: number): Promise<boolean> {
  for await (const object of ctx.db.query("objects").withIndex("by_artworkId", (q) => q.eq("artworkId", artworkId))) {
    if (object.reverted || object.mergedInto) continue;
    let current: Doc<"placements"> | null = null;
    for await (const placement of ctx.db
      .query("placements")
      .withIndex("by_objectId", (q) => q.eq("objectId", object._id))) {
      current = currentPlacement(current ? [current, placement] : [placement], now);
    }
    if (current?.onView) return true;
  }
  return false;
}

const pageArgs = { limit: v.number(), after: v.optional(batchCursor) };
const pageResult = v.object({
  artworks: v.array(schema.doc("artworks")),
  after: v.union(batchCursor, v.null()),
});

async function pendingPage(
  ctx: QueryCtx,
  args: { limit: number; after?: BatchCursor },
): Promise<{ artworks: Doc<"artworks">[]; after: BatchCursor | null }> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit)));
  const after = args.after ?? { phase: "contributions", cursor: null };
  const now = Date.now();
  const artworks: Doc<"artworks">[] = [];
  if (after.phase === "contributions") {
    const page = await ctx.db
      .query("objectContributionState")
      .withIndex("by_userCreated", (q) => q.eq("userCreated", true))
      .paginate({
        cursor: after.cursor,
        numItems: limit,
        maximumBytesRead: 1024 * 1024,
      });
    const seen = new Set<Id<"artworks">>();
    for (const state of page.page) {
      const object = await ctx.db.get("objects", state.objectId);
      if (!object) continue;
      if (object.reverted || object.mergedInto || seen.has(object.artworkId)) {
        continue;
      }
      seen.add(object.artworkId);
      const artwork = await ctx.db.get("artworks", object.artworkId);
      if (artwork && (await claimable(ctx, artwork, now))) artworks.push(artwork);
    }
    return {
      artworks,
      after: page.isDone
        ? { phase: "artworks", cursor: null }
        : { phase: "contributions", cursor: page.continueCursor },
    };
  }
  const page = await ctx.db
    .query("artworks")
    .withIndex("by_creation_time")
    .paginate({
      cursor: after.cursor,
      numItems: limit,
      maximumBytesRead: 1024 * 1024,
    });
  for (const artwork of page.page) {
    if ((await claimable(ctx, artwork, now)) && (await onView(ctx, artwork._id, now))) {
      artworks.push(artwork);
    }
  }
  return {
    artworks,
    after: page.isDone ? null : { phase: "artworks", cursor: page.continueCursor },
  };
}

// Empty pages still advance `after`; null completes the sweep. Contributions precede on-view works.
export const claimBatch = internalMutation({
  args: pageArgs,
  returns: pageResult,
  handler: async (ctx, args) => {
    const page = await pendingPage(ctx, args);
    const artworks: Doc<"artworks">[] = [];
    for (const artwork of page.artworks) {
      const fields = {
        enrichClaimedAt: Date.now(),
        enrichGeneration: artwork.enrichGeneration + 1,
      };
      await ctx.db.patch("artworks", artwork._id, fields);
      // The batch reclaims its own stale claims after an hour; readers stop showing a dead run as writing then too.
      await ctx.scheduler.runAfter(STALE_CLAIM_MS, internal.docent.expireClaim, {
        artworkId: artwork._id,
        generation: fields.enrichGeneration,
      });
      artworks.push({ ...artwork, ...fields });
    }
    return { artworks, after: page.after };
  },
});

export const previewBatch = internalQuery({
  args: pageArgs,
  returns: pageResult,
  handler: pendingPage,
});

// Corpus keys can identify either a canonical artwork or one of its physical objects.
export const lookup = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("artworks"), v.null()),
  handler: async (ctx, { key }) => {
    const artwork = await ctx.db
      .query("artworks")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (artwork) {
      return artwork.identityStatus === "established" && artwork.retiredAt === undefined ? artwork : null;
    }
    const object = await ctx.db
      .query("objects")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return object?.identityStatus === "established" && !object.reverted && !object.mergedInto
      ? ctx.db.get("artworks", object.artworkId)
      : null;
  },
});

export const releaseClaim = internalMutation({
  args: { artworkId: v.id("artworks"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { artworkId, generation }) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (artwork?.enrichGeneration === generation) {
      await ctx.db.patch("artworks", artworkId, { enrichClaimedAt: undefined });
    }
    return null;
  },
});

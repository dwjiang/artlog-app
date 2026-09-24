import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { isEnabled } from "./lib/flags";
import { limitDevice } from "./lib/rateLimits";
import { regionDomains } from "./lib/regions";
import { acceptRightNow, firstSentence } from "./lib/rightNowAccept";
import { searchWithCredit } from "./lib/tavilySpend";
import { normalizeText } from "./lib/textMatch";
import { rightNowCard, type RightNowCard } from "./lib/validators";

// Cache accepted cards and empty outcomes for seven days per (artist, region) and
// coalesce simultaneous misses. A pending row older than this is treated as abandoned.
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_MS = 60 * 1000;

export function artistKey(
  artistId: string | undefined,
  artist: string,
): string {
  return artistId ?? `name:${normalizeText(artist)}`;
}

export const load = internalQuery({
  args: {
    scanId: v.id("scans"),
    deviceId: v.id("devices"),
    venueId: v.optional(v.id("museums")),
  },
  returns: v.object({ region: v.union(v.string(), v.null()) }),
  handler: async (ctx, { scanId, deviceId, venueId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.deviceId !== deviceId) {
      throw new ConvexError({ code: "scan_not_found" });
    }
    const venue = venueId ? await ctx.db.get(venueId) : null;
    return { region: venue?.region ?? null };
  },
});

type Waiting = { scanId: Id<"scans">; generation: number };

async function applyCard(
  ctx: MutationCtx,
  target: Waiting,
  card: RightNowCard,
): Promise<void> {
  const scan = await ctx.db.get(target.scanId);
  if (
    scan
    && scan.generation === target.generation
    && scan.status === "identified"
  ) {
    await ctx.db.patch(scan._id, { rightNow: card, updatedAt: Date.now() });
  }
}

// Atomic cache lookup: a fresh hit is written to the scan here; a miss either joins an in-flight
// fetch ('pending') or receives a unique token for its own fetch.
export const claim = internalMutation({
  args: {
    artistKey: v.string(),
    region: v.string(),
    scanId: v.id("scans"),
    generation: v.number(),
  },
  returns: v.union(
    v.literal("hit"),
    v.literal("empty"),
    v.literal("pending"),
    v.object({ claimId: v.string() }),
  ),
  handler: async (ctx, { artistKey: artistId, region, scanId, generation }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("artistContext")
      .withIndex("by_artist_region", (q) =>
        q.eq("artistId", artistId).eq("region", region),
      )
      .unique();
    if (row && row.fetchedAt > now - CACHE_MS) {
      if (row.empty) return "empty";
      await applyCard(
        ctx,
        { scanId, generation },
        {
          text: row.text,
          sourceUrl: row.sourceUrl,
          sourceLabel: row.sourceLabel,
        },
      );
      return "hit";
    }
    if (row?.pendingAt !== undefined && row.pendingAt > now - PENDING_MS) {
      const queue = row.waiting ?? [];
      if (!queue.some((entry) => entry.scanId === scanId)) {
        await ctx.db.patch(row._id, {
          waiting: [...queue, { scanId, generation }],
        });
      }
      return "pending";
    }
    const claimId = crypto.randomUUID();
    if (row) {
      await ctx.db.patch(row._id, {
        pendingAt: now,
        claimId,
        waiting: [{ scanId, generation }],
      });
    } else {
      await ctx.db.insert("artistContext", {
        artistId,
        region,
        text: "",
        sourceUrl: "",
        sourceLabel: "",
        empty: true,
        fetchedAt: 0,
        pendingAt: now,
        claimId,
        waiting: [{ scanId, generation }],
      });
    }
    return { claimId };
  },
});

export const write = internalMutation({
  args: {
    artistKey: v.string(),
    region: v.string(),
    claimId: v.string(),
    card: v.union(rightNowCard, v.null()),
  },
  returns: v.boolean(),
  handler: async (ctx, { artistKey: artistId, region, claimId, card }) => {
    const row = await ctx.db
      .query("artistContext")
      .withIndex("by_artist_region", (q) =>
        q.eq("artistId", artistId).eq("region", region),
      )
      .unique();
    if (!row || row.claimId !== claimId) return false;
    await ctx.db.patch(row._id, {
      text: card?.text ?? "",
      sourceUrl: card?.sourceUrl ?? "",
      sourceLabel: card?.sourceLabel ?? "",
      empty: card === null,
      fetchedAt: Date.now(),
      pendingAt: undefined,
      claimId: undefined,
      waiting: undefined,
    });
    if (card) {
      for (const target of row.waiting ?? []) {
        await applyCard(ctx, target, card);
      }
    }
    return true;
  },
});

export const release = internalMutation({
  args: { artistKey: v.string(), region: v.string(), claimId: v.string() },
  returns: v.null(),
  handler: async (ctx, { artistKey: artistId, region, claimId }) => {
    const row = await ctx.db
      .query("artistContext")
      .withIndex("by_artist_region", (q) =>
        q.eq("artistId", artistId).eq("region", region),
      )
      .unique();
    if (!row || row.claimId !== claimId) return null;
    if (row.fetchedAt === 0) await ctx.db.delete(row._id);
    else {
      await ctx.db.patch(row._id, {
        pendingAt: undefined,
        claimId: undefined,
        waiting: undefined,
      });
    }
    return null;
  },
});

// Scheduled after a confident identification (identify.ts). Off by default (FLAG_RIGHT_NOW).
export const fetch = internalAction({
  args: {
    scanId: v.id("scans"),
    generation: v.number(),
    artistId: v.optional(v.string()),
    artist: v.string(),
    venueId: v.optional(v.id("museums")),
    deviceId: v.id("devices"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isEnabled("rightNow")) return null;
    const { region } = await ctx.runQuery(internal.rightNow.load, {
      scanId: args.scanId,
      deviceId: args.deviceId,
      venueId: args.venueId,
    });
    const domains = region ? regionDomains(region) : null;
    if (!region || !domains) return null;
    const key = artistKey(args.artistId, args.artist);
    const state = await ctx.runMutation(internal.rightNow.claim, {
      artistKey: key,
      region,
      scanId: args.scanId,
      generation: args.generation,
    });
    if (typeof state === "string") return null;
    const { claimId } = state;
    let written = false;
    try {
      await limitDevice(ctx, "rightNow", args.deviceId);
      const response = await searchWithCredit(ctx, {
        query: `${args.artist} exhibition OR news`,
        includeDomains: domains,
        topic: "news",
        timeRange: "month",
        includeAnswer: "basic",
        maxResults: 5,
      });
      if (!response) return null;
      const card = acceptRightNow(response, {
        artist: args.artist,
        domains,
        now: Date.now(),
      });
      // Review trail for the acceptance boundary: what was offered and whether it passed.
      const top = response.results[0];
      console.log("Right now", {
        artist: args.artist,
        region,
        accepted: card !== null,
        claim: firstSentence(response.answer ?? ""),
        top: top
          ? { url: top.url, score: top.score, publishedDate: top.publishedDate }
          : null,
      });
      written = await ctx.runMutation(internal.rightNow.write, {
        artistKey: key,
        region,
        claimId,
        card,
      });
    } catch (error) {
      if (error instanceof ConvexError && error.data.code === "rate_limited") {
        console.warn("Right now skipped", error.data);
        return null;
      }
      throw error;
    } finally {
      if (!written) {
        await ctx.runMutation(internal.rightNow.release, {
          artistKey: key,
          region,
          claimId,
        });
      }
    }
    return null;
  },
});

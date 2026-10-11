import { v, type Infer } from "convex/values";

import { ownerKey } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { requireDevice } from "./lib/auth";
import {
  DAILY_JITTER,
  dailyJitter,
  pickPrior,
  PICKS_PER_MUSEUM,
  PICKS_RETURNED,
  SAVER_WEIGHT,
  stableTiebreak,
} from "./lib/museumPicks";
import { readObjectDetails } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { eligibleObjectRecord } from "./lib/recognitionEligibility";

// Live eligibility includes takedowns and up to seven proposal witnesses within the 4,096-read limit.
const PAGE_SIZE = 200;
const VENUES_PER_WRITE = 15;
const POPULAR_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const RECENT_SAVES_READ = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const storedPick = v.object({ artworkId: v.id("artworks"), objectId: v.id("objects"), score: v.number() });
type StoredPick = Infer<typeof storedPick>;
const venuePicks = v.object({ venueId: v.id("museums"), picks: v.array(storedPick) });
type VenuePicks = Infer<typeof venuePicks>;

const pickView = v.object({
  artworkId: v.id("artworks"),
  title: v.string(),
  artist: v.string(),
  date: v.optional(v.string()),
  medium: v.optional(v.string()),
  thumbnailUrl: v.string(),
  savers: v.number(),
});

type Showable = { artwork: Doc<"artworks">; details: Doc<"objectDetails"> & { thumbnailUrl: string } };

/** An artwork Home can show: a live catalogue entry whose public-domain thumbnail we may display. */
async function showable(ctx: QueryCtx, objectId: Id<"objects">): Promise<Showable | null> {
  const object = await ctx.db.get("objects", objectId);
  if (!object || !(await eligibleObjectRecord(ctx, object))) return null;
  const artwork = await ctx.db.get("artworks", object.artworkId);
  if (
    !artwork
    || artwork.retiredAt !== undefined
    || artwork.identityStatus !== "established"
    || artwork.rightsStatus !== "public_domain"
  ) {
    return null;
  }
  const details = await readObjectDetails(ctx, object);
  const thumbnailUrl = details?.thumbnailUrl;
  return details && thumbnailUrl ? { artwork, details: { ...details, thumbnailUrl } } : null;
}

/** One page of placements in museum order, as each museum's best picks within the page. */
export const scorePage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ venues: v.array(venuePicks), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("placements").withIndex("by_venueId").paginate({ cursor, numItems: PAGE_SIZE });
    const byVenue = new Map<Id<"museums">, StoredPick[]>();
    for (const placement of page.page) {
      // Listing every museum seen, even without picks, clears one whose placements have all closed.
      const picks = byVenue.get(placement.venueId) ?? [];
      byVenue.set(placement.venueId, picks);
      if (placement.closedAt !== undefined || placement.identityStatus !== "established") continue;
      const shown = await showable(ctx, placement.objectId);
      if (!shown) continue;
      const score = pickPrior({
        title: shown.artwork.title,
        artist: shown.artwork.artist,
        wikidataId: shown.artwork.wikidataId,
        medium: shown.details.medium,
        multiplicity: shown.artwork.multiplicity,
        onView: placement.onView,
        // Wikidata paintings carry no medium; its other flat works, such as prints, name their kind there.
        fromPaintingsSource: placement.source === "wikidata" && shown.details.medium === undefined,
      });
      if (score !== null) picks.push({ artworkId: shown.artwork._id, objectId: placement.objectId, score });
    }
    return {
      venues: [...byVenue].map(([venueId, picks]) => ({ venueId, picks: best(picks) })),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/** Museums with stored picks but no placements left, which the placement pages never reach. */
export const emptiedVenuesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ venueIds: v.array(v.id("museums")), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("museumPicks")
      .withIndex("by_venue_score")
      .paginate({ cursor, numItems: PAGE_SIZE });
    const venueIds: Id<"museums">[] = [];
    for (const venueId of new Set(page.page.map((pick) => pick.venueId))) {
      const placement = await ctx.db
        .query("placements")
        .withIndex("by_venueId", (q) => q.eq("venueId", venueId))
        .first();
      if (!placement) venueIds.push(venueId);
    }
    return { venueIds, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const replaceVenues = internalMutation({
  args: { venues: v.array(venuePicks) },
  returns: v.null(),
  handler: async (ctx, { venues }) => {
    for (const { venueId, picks } of venues) {
      const previous = await ctx.db
        .query("museumPicks")
        .withIndex("by_venue_score", (q) => q.eq("venueId", venueId))
        .take(PICKS_PER_MUSEUM * 2);
      for (const row of previous) await ctx.db.delete("museumPicks", row._id);
      for (const pick of picks) await ctx.db.insert("museumPicks", { venueId, ...pick });
    }
    return null;
  },
});

/** Each artwork once, at its better score, then the top few. Trimming page by page keeps the same top picks. */
function best(picks: StoredPick[]): StoredPick[] {
  const byArtwork = new Map<Id<"artworks">, StoredPick>();
  for (const pick of picks) {
    if ((byArtwork.get(pick.artworkId)?.score ?? -Infinity) < pick.score) byArtwork.set(pick.artworkId, pick);
  }
  return [...byArtwork.values()]
    .sort((a, b) => b.score - a.score || stableTiebreak(a.artworkId) - stableTiebreak(b.artworkId))
    .slice(0, PICKS_PER_MUSEUM);
}

async function replace(ctx: ActionCtx, venues: VenuePicks[]) {
  for (let start = 0; start < venues.length; start += VENUES_PER_WRITE) {
    await ctx.runMutation(internal.museumPicks.replaceVenues, {
      venues: venues.slice(start, start + VENUES_PER_WRITE),
    });
  }
}

/**
 * Re-scores every placement and replaces each museum's stored picks, one page per scheduled step so the full
 * corpus fits the action time limit. Run after a corpus import: `npx convex run museumPicks:rebuild`; it logs
 * "Museum picks rebuilt" when the last step finishes.
 */
export const rebuild = internalAction({
  args: {
    phase: v.optional(v.union(v.literal("emptied"), v.literal("score"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    // The museum the previous page ended inside, with its best picks so far.
    open: v.optional(venuePicks),
  },
  returns: v.null(),
  handler: (ctx, { phase = "emptied", cursor = null, open }) =>
    withErrorReporting("museumPicks.rebuild", async () => {
      if (phase === "emptied") {
        const page = await ctx.runQuery(internal.museumPicks.emptiedVenuesPage, { cursor });
        await replace(
          ctx,
          page.venueIds.map((venueId) => ({ venueId, picks: [] })),
        );
        await ctx.scheduler.runAfter(
          0,
          internal.museumPicks.rebuild,
          page.isDone ? { phase: "score" } : { phase, cursor: page.cursor },
        );
        return null;
      }
      const page = await ctx.runQuery(internal.museumPicks.scorePage, { cursor });
      const { venues } = page;
      if (open && venues[0]?.venueId === open.venueId) {
        venues[0] = { venueId: open.venueId, picks: best([...open.picks, ...venues[0].picks]) };
      } else if (open) {
        venues.unshift(open);
      }
      const next = page.isDone ? undefined : venues.pop();
      await replace(ctx, venues);
      if (page.isDone) {
        console.log("Museum picks rebuilt");
      } else {
        await ctx.scheduler.runAfter(0, internal.museumPicks.rebuild, { phase, cursor: page.cursor, open: next });
      }
      return null;
    }),
});

/** How many different people saved each artwork at the museum recently. Demo accounts are left out. */
async function recentSavers(ctx: QueryCtx, venueId: Id<"museums">, since: number) {
  const saves = await ctx.db
    .query("collections")
    .withIndex("by_venue_savedAt", (q) => q.eq("venueId", venueId).gte("savedAt", since))
    .order("desc")
    .take(RECENT_SAVES_READ);
  const demo = new Map<Id<"accounts">, boolean>();
  const people = new Map<Id<"artworks">, { objectId: Id<"objects">; owners: Set<string> }>();
  for (const save of saves) {
    if (save.deletedAt !== undefined || !save.artworkId || !save.objectId) continue;
    if (save.owner.kind === "account") {
      const { accountId } = save.owner;
      if (!demo.has(accountId)) {
        const account = await ctx.db.get("accounts", accountId);
        demo.set(accountId, account?.providerUserId.startsWith("demo:") ?? false);
      }
      if (demo.get(accountId)) continue;
    }
    const entry = people.get(save.artworkId) ?? { objectId: save.objectId, owners: new Set<string>() };
    entry.owners.add(ownerKey(save.owner));
    people.set(save.artworkId, entry);
  }
  return people;
}

/**
 * Home's "Don't miss" for one museum: works people saved there recently first, then the catalogue's best guesses,
 * reordered daily among peers. The client sends its own calendar day so the result stays cacheable.
 */
export const forVenue = query({
  args: { venueId: v.string(), day: v.string(), artworkId: v.optional(v.id("artworks")) },
  returns: v.array(pickView),
  handler: async (ctx, { venueId: rawVenueId, day, artworkId: selectedArtworkId }) => {
    await requireDevice(ctx);
    const venueId = ctx.db.normalizeId("museums", rawVenueId);
    if (!venueId || !DAY.test(day)) return [];
    const stored = await ctx.db
      .query("museumPicks")
      .withIndex("by_venue_score", (q) => q.eq("venueId", venueId))
      .order("desc")
      .take(PICKS_PER_MUSEUM);
    const savers = await recentSavers(ctx, venueId, Date.parse(`${day}T00:00:00Z`) - POPULAR_WINDOW_MS);
    const candidates = new Map<Id<"artworks">, { objectId: Id<"objects">; score: number; savers: number }>();
    for (const row of stored) candidates.set(row.artworkId, { objectId: row.objectId, score: row.score, savers: 0 });
    for (const [artworkId, { objectId, owners }] of savers) {
      const candidate = candidates.get(artworkId) ?? { objectId, score: 0, savers: 0 };
      candidates.set(artworkId, {
        ...candidate,
        savers: owners.size,
        score: candidate.score + SAVER_WEIGHT * owners.size,
      });
    }
    const seed = `${venueId}:${day}`;
    const rank = ([artworkId, { score }]: [Id<"artworks">, { score: number }]) =>
      score + DAILY_JITTER * dailyJitter(seed, artworkId);
    const ordered = [...candidates].sort((a, b) => rank(b) - rank(a));
    const views = [];
    for (const [artworkId, candidate] of ordered) {
      if (selectedArtworkId && artworkId !== selectedArtworkId) continue;
      if (views.length === PICKS_RETURNED) break;
      const shown = await showable(ctx, candidate.objectId);
      if (!shown || shown.artwork._id !== artworkId) continue;
      views.push({
        artworkId,
        title: shown.artwork.title,
        artist: shown.artwork.artist,
        date: shown.artwork.date,
        medium: shown.details.medium,
        thumbnailUrl: shown.details.thumbnailUrl,
        savers: candidate.savers,
      });
    }
    return views;
  },
});

import tzLookup from "@photostructure/tz-lookup";
import { ConvexError, v, type Infer } from "convex/values";

import { politeClient, sameSite } from "../shared/exhibitions/polite-client";
import { calendarDate } from "../shared/journal/limits";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { saveExhibition } from "./exhibitions";
import { internalMutation, mutation } from "./functions";
import { requireDevice } from "./lib/auth";
import {
  EXHIBITION_MODEL,
  EXTRACTION_SYSTEM,
  MAX_CHECK_GAP_MS,
  MAX_MUSEUM_CHARS,
  MIN_LISTING_CHARS,
  THIN_LISTING_CHARS,
  capturePages,
  documentTitle,
  extractionPrompt,
  extractionSchema,
  listingHash,
  listingText,
  nextDueAt,
  parseExtraction,
  retryAt,
  siteName,
  verifiedShows,
  type ListingPage,
} from "./lib/exhibitionListings";
import type { exhibitionSource } from "./lib/exhibitionSourceValidators";
import { verifiedExhibition } from "./lib/exhibitionValidators";
import { isEnabled } from "./lib/flags";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { userAgent } from "./lib/politeFetch";
import { limiter } from "./lib/rateLimits";
import { regionCountry } from "./lib/regions";
import { dailyCap, reserveSpend, spentToday } from "./lib/spend";
import { MAX_EXTRACT_URLS } from "./lib/tavily";
import { extractWithCredit } from "./lib/tavilySpend";
import { chatJson } from "./lib/tokenFactory";
import { isVenueOptedOut } from "./lib/venueOptOut";

const DAY_MS = 24 * 60 * 60 * 1000;
// Regions Explore showed within this window are read on schedule; the rest when someone opens them.
const VIEW_WINDOW_MS = 30 * DAY_MS;
const VIEW_WRITE_GAP_MS = 60 * 60 * 1000;
// A read still leased after this long is taken to have died, so its museum can be picked again.
const LEASE_MS = 15 * 60 * 1000;
const BATCH_SIZE = 20;
const DISPATCH_LIMIT = 60;
const REGION_LIMIT = 40;
// Background reads stop at this share of each daily cap, leaving the rest to people's own scans.
const BACKGROUND_SHARE = 0.5;
const MAX_LISTINGS = 4;
const MAX_LISTING_BYTES = 3 * 1024 * 1024;
// Sites asking for longer pauses between requests count as refusing rather than being waited on.
const MAX_CRAWL_DELAY_S = 10;
const PAGE_READERS = 8;
const MODEL_READERS = 4;
// chatJson retries once, so a read can send two requests.
const MODEL_CALLS_RESERVED = 2;
const MAX_OUTPUT_TOKENS = 12_000;
const MODEL_TIMEOUT_MS = 120_000;
const MAX_REGION_CHARS = 100;

const checkOutcome = v.union(
  v.object({
    kind: v.literal("changed"),
    checkedAt: v.number(),
    pageHash: v.string(),
    shows: v.array(verifiedExhibition),
  }),
  v.object({ kind: v.literal("unchanged"), checkedAt: v.number() }),
  v.object({ kind: v.literal("blocked"), checkedAt: v.number() }),
  v.object({ kind: v.literal("unavailable") }),
  v.object({ kind: v.literal("deferred") }),
);
type CheckOutcome = Infer<typeof checkOutcome>;

const listingMuseum = v.object({
  refreshId: v.id("exhibitionRefreshes"),
  museumId: v.id("museums"),
  name: v.string(),
  website: v.union(v.string(), v.null()),
  timeZone: v.string(),
  country: v.optional(v.string()),
  pageHash: v.optional(v.string()),
  listings: v.array(v.object({ url: v.string(), venueSpecific: v.boolean() })),
});
type ListingMuseum = Infer<typeof listingMuseum>;

async function refreshRow(ctx: QueryCtx, museumId: Id<"museums">) {
  return ctx.db
    .query("exhibitionRefreshes")
    .withIndex("by_museumId", (q) => q.eq("museumId", museumId))
    .unique();
}

/** Keeps a museum's refresh schedule in step with its listing discovery; a new or changed listing is read as new. */
export async function syncRefresh(
  ctx: MutationCtx,
  museum: Doc<"museums">,
  source: Infer<typeof exhibitionSource>,
): Promise<void> {
  const row = await refreshRow(ctx, museum._id);
  if (source.status !== "validated") {
    if (row) await ctx.db.delete("exhibitionRefreshes", row._id);
    return;
  }
  const now = Date.now();
  if (row) {
    await ctx.db.patch("exhibitionRefreshes", row._id, {
      region: museum.region,
      dueAt: now,
      checkedAt: undefined,
      pageHash: undefined,
      failures: 0,
    });
  } else {
    await ctx.db.insert("exhibitionRefreshes", {
      museumId: museum._id,
      region: museum.region,
      dueAt: now,
      failures: 0,
    });
  }
}

async function budgetLeft(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  for (const kind of ["tokenFactory", "tavily"] as const) {
    if ((await spentToday(ctx, kind)) >= dailyCap(kind) * BACKGROUND_SHARE) return false;
  }
  return true;
}

function websiteHost(website: string | undefined): string {
  try {
    return website ? new URL(website).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

async function takeDue(
  rows: AsyncIterable<Doc<"exhibitionRefreshes">>,
  picked: Map<Id<"exhibitionRefreshes">, Doc<"exhibitionRefreshes">>,
  limit: number,
  now: number,
) {
  for await (const row of rows) {
    if (picked.size >= limit) return;
    if ((row.leasedUntil ?? 0) <= now) picked.set(row._id, row);
  }
}

/** Leases the rows and reads them in batches; a site's museums share a batch so its one-second spacing holds. */
async function leaseAndRead(ctx: MutationCtx, rows: Doc<"exhibitionRefreshes">[], now: number) {
  if (rows.length === 0) return;
  const leasedUntil = now + LEASE_MS;
  const hosts = new Map<Id<"exhibitionRefreshes">, string>();
  for (const row of rows) {
    await ctx.db.patch("exhibitionRefreshes", row._id, { leasedUntil });
    hosts.set(row._id, websiteHost((await ctx.db.get("museums", row.museumId))?.website));
  }
  const ordered = rows.map((row) => row._id).sort((a, b) => hosts.get(a)!.localeCompare(hosts.get(b)!));
  for (let index = 0; index < ordered.length; index += BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.exhibitionRefresh.readBatch, {
      refreshIds: ordered.slice(index, index + BATCH_SIZE),
      leasedUntil,
    });
  }
}

/** Reads museums never read before, then those due in regions Explore showed recently. */
export const dispatch = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!isEnabled("exhibitionRefresh") || !(await budgetLeft(ctx))) return null;
    const now = Date.now();
    const picked = new Map<Id<"exhibitionRefreshes">, Doc<"exhibitionRefreshes">>();
    await takeDue(
      ctx.db
        .query("exhibitionRefreshes")
        .withIndex("by_checkedAt_dueAt", (q) => q.eq("checkedAt", undefined).lte("dueAt", now)),
      picked,
      DISPATCH_LIMIT,
      now,
    );
    const views = ctx.db
      .query("exploreRegionViews")
      .withIndex("by_viewedAt", (q) => q.gte("viewedAt", now - VIEW_WINDOW_MS));
    for await (const view of views) {
      if (picked.size >= DISPATCH_LIMIT) break;
      await takeDue(
        ctx.db
          .query("exhibitionRefreshes")
          .withIndex("by_region_dueAt", (q) => q.eq("region", view.region).lte("dueAt", now)),
        picked,
        DISPATCH_LIMIT,
        now,
      );
    }
    await leaseAndRead(ctx, [...picked.values()], now);
    return null;
  },
});

/** Explore showed this region: keep its listings on schedule and read the ones already due. */
export const requestRegion = mutation({
  args: { region: v.string() },
  returns: v.null(),
  handler: async (ctx, { region }) => {
    const device = await requireDevice(ctx);
    if (!region.trim() || region.length > MAX_REGION_CHARS) throw new ConvexError({ code: "invalid_venue" });
    if (!isEnabled("exhibitionRefresh")) return null;
    if (!(await limiter.limit(ctx, "exploreRefresh", { key: device._id })).ok) return null;
    const now = Date.now();
    const view = await ctx.db
      .query("exploreRegionViews")
      .withIndex("by_region", (q) => q.eq("region", region))
      .unique();
    if (!view) {
      await ctx.db.insert("exploreRegionViews", { region, viewedAt: now });
    } else if (now - view.viewedAt >= VIEW_WRITE_GAP_MS) {
      await ctx.db.patch("exploreRegionViews", view._id, { viewedAt: now });
    }
    if (!(await budgetLeft(ctx))) return null;
    const picked = new Map<Id<"exhibitionRefreshes">, Doc<"exhibitionRefreshes">>();
    await takeDue(
      ctx.db.query("exhibitionRefreshes").withIndex("by_region_dueAt", (q) => q.eq("region", region).lte("dueAt", now)),
      picked,
      REGION_LIMIT,
      now,
    );
    await leaseAndRead(ctx, [...picked.values()], now);
    return null;
  },
});

export const remainingBudget = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: (ctx) => budgetLeft(ctx),
});

export const loadBatch = internalQuery({
  args: { refreshIds: v.array(v.id("exhibitionRefreshes")), leasedUntil: v.number() },
  returns: v.array(listingMuseum),
  handler: async (ctx, { refreshIds, leasedUntil }) => {
    const museums: ListingMuseum[] = [];
    for (const refreshId of refreshIds) {
      const row = await ctx.db.get("exhibitionRefreshes", refreshId);
      const museum = row && (await ctx.db.get("museums", row.museumId));
      if (!row || row.leasedUntil !== leasedUntil || !museum) continue;
      const source = await ctx.db
        .query("exhibitionSources")
        .withIndex("by_museumId", (q) => q.eq("museumId", museum._id))
        .unique();
      const readable = source?.status === "validated" && !(await isVenueOptedOut(ctx, museum));
      museums.push({
        refreshId,
        museumId: museum._id,
        name: museum.name,
        website: museum.website ?? null,
        timeZone: tzLookup(museum.lat, museum.lng),
        country: museum.country ?? regionCountry(museum.region),
        pageHash: row.pageHash,
        listings: readable
          ? source.urls.map((listing) => ({
              url: listing.url,
              venueSpecific: listing.venueAssociation === "venue_specific",
            }))
          : [],
      });
    }
    return museums;
  },
});

type ListingRead = {
  pages: ListingPage[];
  /** Listings our fetch could not read or found little text on, for Tavily to read as well. */
  fallback: { url: string; title?: string; text?: string }[];
  /** Names the museum's own listing pages give the site, accepted as venue evidence. */
  siteNames: string[];
  /** Listings that failed in a way a later read may not: a missing page, a redirect off the site, a rate limit. */
  failed: number;
};

type PoliteClient = ReturnType<typeof politeClient>;

/** HTTPS listings on the museum's own site, the only pages a show may cite. */
function listingUrls(museum: ListingMuseum, home: URL) {
  const urls = new Map<string, { url: URL; venueSpecific: boolean }>();
  for (const listing of museum.listings) {
    try {
      const url = new URL(listing.url);
      if (url.protocol === "http:") url.protocol = "https:";
      if (url.protocol === "https:" && !url.username && !url.password && sameSite(url, home)) {
        urls.set(url.href, { url, venueSpecific: listing.venueSpecific || !!urls.get(url.href)?.venueSpecific });
      }
    } catch {
      // A malformed listing URL is skipped; discovery owns fixing it.
    }
  }
  return [...urls.values()].slice(0, MAX_LISTINGS);
}

async function readListings(client: PoliteClient, museum: ListingMuseum): Promise<ListingRead> {
  const read: ListingRead = { pages: [], fallback: [], siteNames: [], failed: 0 };
  let home: URL;
  try {
    home = new URL(museum.website ?? "");
  } catch {
    return read;
  }
  for (const { url, venueSpecific } of listingUrls(museum, home)) {
    let followed: Awaited<ReturnType<PoliteClient["follow"]>>;
    try {
      followed = await client.follow(url, "text/html, application/xhtml+xml;q=0.9", MAX_LISTING_BYTES, (next) =>
        sameSite(next, home),
      );
    } catch {
      read.fallback.push({ url: url.href });
      continue;
    }
    // robots.txt and refusals (401, 403, 451) are answers, so those listings are neither retried soon nor sent to Tavily.
    if ("reason" in followed) {
      if (followed.reason !== "robots") read.failed += 1;
      continue;
    }
    const { status, headers, body } = followed.response;
    if (status >= 500) {
      read.fallback.push({ url: url.href });
    } else if (status === 200 && headers.get("content-type")?.includes("html")) {
      const html = new TextDecoder().decode(body);
      const name = venueSpecific ? siteName(html) : undefined;
      if (name) read.siteNames.push(name);
      const text = listingText(html);
      if (text.length >= THIN_LISTING_CHARS) read.pages.push({ url: followed.url.href, text });
      else read.fallback.push({ url: url.href, title: documentTitle(html), text });
    } else if (![401, 403, 451].includes(status)) {
      read.failed += 1;
    }
  }
  return read;
}

type TavilyRead = {
  texts: Map<string, string>;
  /** Listings left unread because the day's budget ran out. */
  skipped: Set<string>;
};

/** Tavily's text for the listings our fetch could not read, in as few extract calls as the batch allows. */
async function readWithTavily(ctx: ActionCtx, urls: string[]): Promise<TavilyRead> {
  const read: TavilyRead = { texts: new Map(), skipped: new Set() };
  for (let index = 0; index < urls.length; index += MAX_EXTRACT_URLS) {
    const chunk = urls.slice(index, index + MAX_EXTRACT_URLS);
    if (!(await ctx.runQuery(internal.exhibitionRefresh.remainingBudget, {}))) {
      for (const url of urls.slice(index)) read.skipped.add(url);
      break;
    }
    const response = await extractWithCredit(ctx, chunk, "basic");
    for (const result of response?.results ?? []) {
      read.texts.set(result.url, result.text.trim());
    }
  }
  return read;
}

/** Our text or Tavily's, whichever says more; Tavily's leads with the title our fetch saw so it can name the museum. */
function longerText(tavily: TavilyRead) {
  return ({ url, title, text }: ListingRead["fallback"][number]): ListingPage[] => {
    const read = tavily.texts.get(url);
    const tavilyText = read && title ? `${title}\n${read}` : read;
    const best = [text, tavilyText].reduce<string>(
      (longest, next) => (next && next.length > longest.length ? next : longest),
      "",
    );
    return best.length >= MIN_LISTING_CHARS ? [{ url, text: best }] : [];
  };
}

function withinBudget(pages: ListingPage[]): ListingPage[] {
  let left = MAX_MUSEUM_CHARS;
  return pages.flatMap((page) => {
    const text = page.text.slice(0, left);
    left -= text.length;
    return text ? [{ url: page.url, text }] : [];
  });
}

async function extractShows(
  ctx: ActionCtx,
  museum: ListingMuseum,
  read: ListingRead,
  tavily: TavilyRead,
): Promise<CheckOutcome> {
  const pages = withinBudget([...read.pages, ...read.fallback.flatMap(longerText(tavily))]);
  const checkedAt = Date.now();
  if (read.fallback.some(({ url }) => tavily.skipped.has(url))) return { kind: "deferred" };
  if (pages.length === 0) {
    return read.failed === 0 && read.fallback.length === 0 ? { kind: "blocked", checkedAt } : { kind: "unavailable" };
  }
  const captured = await capturePages(pages, checkedAt);
  const pageHash = await listingHash(captured);
  if (pageHash === museum.pageHash) return { kind: "unchanged", checkedAt };
  if (!(await ctx.runQuery(internal.exhibitionRefresh.remainingBudget, {}))) return { kind: "deferred" };
  let day: string;
  try {
    day = await reserveSpend(ctx, "tokenFactory", MODEL_CALLS_RESERVED);
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "spend_cap") return { kind: "deferred" };
    throw error;
  }
  const venueNames = [...new Set(read.siteNames)];
  let calls = MODEL_CALLS_RESERVED;
  try {
    const response = await chatJson({
      model: EXHIBITION_MODEL,
      system: EXTRACTION_SYSTEM,
      user: extractionPrompt({ name: museum.name, venueNames }, pages, calendarDate(checkedAt, museum.timeZone)),
      schemaName: "exhibitions",
      schema: extractionSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      parse: parseExtraction,
      timeoutMs: MODEL_TIMEOUT_MS,
    });
    calls = response.calls;
    const shows = verifiedShows({
      museum: {
        museumId: museum.museumId,
        name: museum.name,
        timeZone: museum.timeZone,
        country: museum.country,
        sourceUrls: pages.map((page) => page.url),
        venueNames,
      },
      pages: captured,
      candidates: response.value,
      asOfDate: calendarDate(checkedAt, museum.timeZone),
    });
    return { kind: "changed", checkedAt, pageHash, shows };
  } catch (error) {
    const sent = error instanceof ConvexError ? (error.data as { calls?: unknown }).calls : undefined;
    if (typeof sent === "number") calls = sent;
    await reportBackendError(error, "exhibitionRefresh.extract");
    return { kind: "unavailable" };
  } finally {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tokenFactory",
      day,
      reserved: MODEL_CALLS_RESERVED,
      actual: calls,
    });
  }
}

async function eachConcurrently<T>(items: T[], limit: number, run: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await run(items[index], index);
      }
    }),
  );
}

export const readBatch = internalAction({
  args: { refreshIds: v.array(v.id("exhibitionRefreshes")), leasedUntil: v.number() },
  returns: v.null(),
  handler: (ctx, { refreshIds, leasedUntil }) =>
    withErrorReporting("exhibitionRefresh.readBatch", async () => {
      const museums = await ctx.runQuery(internal.exhibitionRefresh.loadBatch, { refreshIds, leasedUntil });
      const client = politeClient({ userAgent: userAgent(), maxCrawlDelayS: MAX_CRAWL_DELAY_S });
      const reads: ListingRead[] = Array(museums.length);
      await eachConcurrently(museums, PAGE_READERS, async (museum, index) => {
        reads[index] = await readListings(client, museum);
      });
      const tavily = await readWithTavily(
        ctx,
        reads.flatMap((read) => read.fallback.map(({ url }) => url)),
      );
      await eachConcurrently(museums, MODEL_READERS, async (museum, index) => {
        const outcome = await extractShows(ctx, museum, reads[index], tavily);
        await ctx.runMutation(internal.exhibitionRefresh.recordCheck, {
          refreshId: museum.refreshId,
          leasedUntil,
          outcome,
        });
      });
      return null;
    }),
});

export const recordCheck = internalMutation({
  args: { refreshId: v.id("exhibitionRefreshes"), leasedUntil: v.number(), outcome: checkOutcome },
  returns: v.null(),
  handler: async (ctx, { refreshId, leasedUntil, outcome }) => {
    const row = await ctx.db.get("exhibitionRefreshes", refreshId);
    if (!row || row.leasedUntil !== leasedUntil) return null;
    if (outcome.kind === "deferred") {
      await ctx.db.patch("exhibitionRefreshes", refreshId, { leasedUntil: undefined });
      return null;
    }
    if (outcome.kind === "unavailable") {
      const failures = row.failures + 1;
      await ctx.db.patch("exhibitionRefreshes", refreshId, {
        failures,
        dueAt: retryAt(Date.now(), failures),
        leasedUntil: undefined,
      });
      return null;
    }
    const museum = await ctx.db.get("museums", row.museumId);
    if (!museum) {
      await ctx.db.delete("exhibitionRefreshes", refreshId);
      return null;
    }
    if (outcome.kind === "changed" && !(await isVenueOptedOut(ctx, museum))) {
      for (const show of outcome.shows) {
        try {
          await saveExhibition(ctx, museum, show);
        } catch (error) {
          // A show the import rules reject, or one a newer import already holds, is left out on its own.
          if (!(error instanceof ConvexError)) throw error;
        }
      }
    }
    const nextClosing = await ctx.db
      .query("exhibitions")
      .withIndex("by_museum_finalEndAt", (q) => q.eq("museumId", museum._id).gt("finalEndAt", outcome.checkedAt))
      .first();
    await ctx.db.patch("exhibitionRefreshes", refreshId, {
      checkedAt: outcome.checkedAt,
      dueAt:
        outcome.kind === "blocked"
          ? outcome.checkedAt + MAX_CHECK_GAP_MS
          : nextDueAt(outcome.checkedAt, nextClosing ? [nextClosing.finalEndAt] : []),
      failures: 0,
      leasedUntil: undefined,
      ...(outcome.kind === "changed" ? { pageHash: outcome.pageHash } : {}),
    });
    return null;
  },
});

/** Creates the schedule for museums whose listings were imported before it existed, one page per run. */
export const backfill = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("exhibitionSources")
      .withIndex("by_museumId")
      .paginate({ cursor, numItems: 200 });
    for (const { _id, _creationTime, ...source } of page) {
      if (source.status !== "validated" || (await refreshRow(ctx, source.museumId))) continue;
      const museum = await ctx.db.get("museums", source.museumId);
      if (museum) await syncRefresh(ctx, museum, source);
    }
    if (!isDone) await ctx.scheduler.runAfter(0, internal.exhibitionRefresh.backfill, { cursor: continueCursor });
    return null;
  },
});

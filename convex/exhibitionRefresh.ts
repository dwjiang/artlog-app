import tzLookup from "@photostructure/tz-lookup";
import { ConvexError, v, type Infer } from "convex/values";

import type { ExhibitionCandidate } from "../shared/exhibitions/acceptance";
import { politeClient, sameSite } from "../shared/exhibitions/polite-client";
import { calendarDate } from "../shared/journal/limits";
import { regionCountry } from "../shared/sources/region-country";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { saveExhibition } from "./exhibitions";
import { internalMutation, mutation } from "./functions";
import {
  EXHIBITION_MODEL,
  EXTRACTION_SYSTEM,
  SHOW_PAGE_SYSTEM,
  MAX_CHECK_GAP_MS,
  MAX_MUSEUM_CHARS,
  MIN_LISTING_CHARS,
  THIN_LISTING_CHARS,
  capturePages,
  documentTitle,
  extractionPrompt,
  extractionSchema,
  listingHash,
  listingLinks,
  listingText,
  nextDueAt,
  parseExtraction,
  retryAt,
  showPage,
  showPages,
  siteName,
  titleKey,
  verifiedShows,
  type ListingPage,
  type PageLink,
  type VerifiedShow,
} from "./lib/exhibitionListings";
import type { exhibitionSource } from "./lib/exhibitionSourceValidators";
import { verifiedExhibition } from "./lib/exhibitionValidators";
import { isEnabled } from "./lib/flags";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { userAgent } from "./lib/politeFetch";
import { dailyCap, reserveSpend, spentToday } from "./lib/spend";
import { MAX_EXTRACT_URLS } from "./lib/tavily";
import { extractWithCredit } from "./lib/tavilySpend";
import { chatJson } from "./lib/tokenFactory";
import { isVenueOptedOut } from "./lib/venueOptOut";
import { entityNames, getEntities } from "./lib/wikidata";

// A read still leased after this long is taken to have died, so its museum can be picked again.
const LEASE_MS = 15 * 60 * 1000;
const BATCH_SIZE = 20;
// Starting one batch this often keeps model reads under the project's Token Factory tokens-per-minute limit.
const BATCH_GAP_MS = 24_000;
// Background reads stop at this share of each daily cap, leaving the rest to people's own scans.
const BACKGROUND_SHARE = 0.5;
const MAX_LISTINGS = 4;
const MAX_LISTING_BYTES = 3 * 1024 * 1024;
// Listings that give only titles link each show to a page leading with its dates; the rest is visits and related shows.
const MAX_SHOW_PAGES = 8;
const SHOW_PAGE_CHARS = 5_000;
// Sites asking for longer pauses between requests count as refusing rather than being waited on.
const MAX_CRAWL_DELAY_S = 10;
const PAGE_READERS = 8;
const MODEL_READERS = 4;
// chatJson retries once, so a read can send two requests.
const MODEL_CALLS_RESERVED = 2;
const MAX_OUTPUT_TOKENS = 12_000;
const MODEL_TIMEOUT_MS = 120_000;

const checkOutcome = v.union(
  v.object({
    kind: v.literal("changed"),
    checkedAt: v.number(),
    pageHash: v.optional(v.string()),
    shows: v.array(verifiedExhibition),
  }),
  v.object({ kind: v.literal("unchanged"), checkedAt: v.number() }),
  v.object({ kind: v.literal("blocked"), checkedAt: v.number() }),
  v.object({ kind: v.literal("unavailable") }),
  v.object({ kind: v.literal("partial"), shows: v.array(verifiedExhibition) }),
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
  wikidataId: v.optional(v.string()),
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

// Explore never lists hidden or merged museums, so reading their listings would be paid for and never shown.
const listedInExplore = (museum: Doc<"museums">) => !museum.excludedFromDiscovery && !museum.mergedInto;

/** Keeps a museum's refresh schedule in step with its listing discovery; a new or changed listing is read as new. */
export async function syncRefresh(
  ctx: MutationCtx,
  museum: Doc<"museums">,
  source: Infer<typeof exhibitionSource>,
): Promise<void> {
  const row = await refreshRow(ctx, museum._id);
  if (source.status !== "validated" || !listedInExplore(museum)) {
    if (row) await ctx.db.delete("exhibitionRefreshes", row._id);
    return;
  }
  const now = Date.now();
  // A new row identity invalidates old workers even if the replacement is leased in the same millisecond.
  if (row) await ctx.db.delete("exhibitionRefreshes", row._id);
  await ctx.db.insert("exhibitionRefreshes", {
    museumId: museum._id,
    region: museum.region,
    dueAt: now,
    failures: 0,
  });
}

async function budgetLeft(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  for (const kind of ["tokenFactory", "tavily"] as const) {
    if ((await spentToday(ctx, kind)) >= dailyCap(kind) * BACKGROUND_SHARE) return false;
  }
  return true;
}

/** Leases the rows and reads them in bounded batches. Fetches reserve host slots independently of batch boundaries. */
async function leaseAndRead(ctx: MutationCtx, rows: Doc<"exhibitionRefreshes">[], now: number) {
  if (rows.length === 0) return;
  const leasedUntil = now + LEASE_MS;
  for (const row of rows) {
    await ctx.db.patch("exhibitionRefreshes", row._id, { leasedUntil });
  }
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.exhibitionRefresh.readBatch, {
      refreshIds: rows.slice(index, index + BATCH_SIZE).map((row) => row._id),
      leasedUntil,
    });
  }
}

/** Reads every due listing, one spaced batch at a time, until none is due or the day's background budget is spent. */
export const readDueListings = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!isEnabled("exhibitionRefresh") || !(await budgetLeft(ctx))) return null;
    const now = Date.now();
    const picked: Doc<"exhibitionRefreshes">[] = [];
    // Rows an earlier batch still holds sit among the due ones; a lease that outlived its worker counts as free.
    for await (const row of ctx.db.query("exhibitionRefreshes").withIndex("by_dueAt", (q) => q.lte("dueAt", now))) {
      if ((row.leasedUntil ?? 0) <= now) picked.push(row);
      if (picked.length === BATCH_SIZE) break;
    }
    await leaseAndRead(ctx, picked, now);
    if (picked.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(BATCH_GAP_MS, internal.exhibitionRefresh.readDueListings, {});
    }
    return null;
  },
});

/** Older app builds call this when Explore shows a region; listings are read on the daily schedule instead. */
export const requestRegion = mutation({
  args: { region: v.string() },
  returns: v.null(),
  handler: () => null,
});

export const remainingBudget = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: (ctx) => budgetLeft(ctx),
});

/** Claims a request slot now, or returns the delay before trying again without reserving a stale future slot. */
export const reserveHost = internalMutation({
  args: { host: v.string(), gapMs: v.number() },
  returns: v.number(),
  handler: async (ctx, { host, gapMs }) => {
    const row = await ctx.db
      .query("exhibitionFetchHosts")
      .withIndex("by_host", (q) => q.eq("host", host))
      .unique();
    const now = Date.now();
    const retryAfter = (row?.nextAt ?? 0) - now;
    if (retryAfter > 0) return retryAfter;
    const nextAt = now + Math.max(1000, gapMs);
    if (row) await ctx.db.patch("exhibitionFetchHosts", row._id, { nextAt });
    else await ctx.db.insert("exhibitionFetchHosts", { host, nextAt });
    return 0;
  },
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
      const readable =
        source?.status === "validated" && listedInExplore(museum) && !(await isVenueOptedOut(ctx, museum));
      museums.push({
        refreshId,
        museumId: museum._id,
        name: museum.name,
        website: museum.website ?? null,
        timeZone: tzLookup(museum.lat, museum.lng),
        country: museum.country ?? regionCountry(museum.region),
        ...(museum.wikidataId ? { wikidataId: museum.wikidataId } : {}),
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
  /** Links on the listings to pages of the same site, where a show the listing leaves undated may give its dates. */
  links: PageLink[];
  /** Listings that failed in a way a later read may not: a missing page, a redirect off the site, a rate limit. */
  failed: number;
};

type PoliteClient = ReturnType<typeof politeClient>;

/** artlog-bot's client for background reads, spacing requests to each host across every running read. */
export function backgroundClient(ctx: ActionCtx): PoliteClient {
  return politeClient({
    userAgent: userAgent(),
    maxCrawlDelayS: MAX_CRAWL_DELAY_S,
    waitForHost: (host, gapMs) =>
      withErrorReporting("exhibitionRefresh.host", async () => {
        for (;;) {
          const retryAfter = await ctx.runMutation(internal.exhibitionRefresh.reserveHost, { host, gapMs });
          if (retryAfter === 0) return;
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
        }
      }),
  });
}

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
  const read: ListingRead = { pages: [], fallback: [], siteNames: [], links: [], failed: 0 };
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
      read.links.push(...listingLinks(html, followed.url.href).filter((link) => sameSite(new URL(link.url), home)));
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

/** Each museum's Wikidata labels and aliases in every language, so a page may name its venue in its own language. */
async function wikidataNames(museums: ListingMuseum[]): Promise<Map<Id<"museums">, string[]> | null> {
  const ids = museums.flatMap((museum) => (museum.wikidataId ? [museum.wikidataId] : []));
  if (ids.length === 0) return new Map();
  try {
    const entities = await getEntities(ids, "labels|aliases", "all");
    return new Map(
      museums.flatMap((museum) => {
        const entity = museum.wikidataId ? entities[museum.wikidataId] : undefined;
        return entity ? [[museum.museumId, entityNames(entity)] as const] : [];
      }),
    );
  } catch (error) {
    // Without them only the museum's own name and its pages' site names count as venue evidence.
    await reportBackendError(error, "exhibitionRefresh.names");
    return null;
  }
}

function withinBudget(pages: ListingPage[]): ListingPage[] {
  let left = MAX_MUSEUM_CHARS;
  return pages.flatMap((page) => {
    const text = page.text.slice(0, left);
    left -= text.length;
    return text ? [{ ...page, text }] : [];
  });
}

type ShowsRead = { candidates: ExhibitionCandidate[]; shows: VerifiedShow[] };

type ReadContext = {
  museum: ListingMuseum;
  /** Names the listings give their site, offered to the model as the museum's. */
  siteNames: string[];
  /** Further names a venue quote may use, such as the museum's Wikidata names. */
  otherNames: string[];
  checkedAt: number;
};

/** One model read of the pages, with the shows those pages quote. */
async function readShows(
  ctx: ActionCtx,
  { museum, siteNames, otherNames, checkedAt }: ReadContext,
  pages: ListingPage[],
  singleShow = false,
): Promise<ShowsRead | "deferred" | "failed"> {
  if (!(await ctx.runQuery(internal.exhibitionRefresh.remainingBudget, {}))) return "deferred";
  let day: string;
  try {
    day = await reserveSpend(ctx, "tokenFactory", MODEL_CALLS_RESERVED);
  } catch (error) {
    if (error instanceof ConvexError && error.data.code === "spend_cap") return "deferred";
    throw error;
  }
  const asOfDate = calendarDate(checkedAt, museum.timeZone);
  const venueNames = [...new Set([...siteNames, ...otherNames])];
  let calls = MODEL_CALLS_RESERVED;
  try {
    const response = await chatJson({
      model: EXHIBITION_MODEL,
      system: singleShow ? SHOW_PAGE_SYSTEM : EXTRACTION_SYSTEM,
      user: extractionPrompt({ name: museum.name, venueNames }, pages, asOfDate),
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
      pages: await capturePages(pages, checkedAt),
      candidates: response.value,
      asOfDate,
    });
    return { candidates: response.value, shows };
  } catch (error) {
    const sent = error instanceof ConvexError ? (error.data as { calls?: unknown }).calls : undefined;
    if (typeof sent === "number") calls = sent;
    await reportBackendError(error, "exhibitionRefresh.extract");
    return "failed";
  } finally {
    await ctx.runMutation(internal.spend.reconcile, {
      kind: "tokenFactory",
      day,
      reserved: MODEL_CALLS_RESERVED,
      actual: calls,
    });
  }
}

async function readShowPage(client: PoliteClient, url: string): Promise<ListingPage | "blocked" | "failed"> {
  const start = new URL(url);
  try {
    const followed = await client.follow(start, "text/html, application/xhtml+xml;q=0.9", MAX_LISTING_BYTES, (next) =>
      sameSite(next, start),
    );
    if ("reason" in followed) return followed.reason === "robots" ? "blocked" : "failed";
    const { status, headers, body } = followed.response;
    if ([401, 403, 451].includes(status)) return "blocked";
    if (status >= 500) {
      await reportBackendError(
        new ConvexError({ code: "page_unavailable", reason: `http_${status}` }),
        "exhibitionRefresh.showPage",
      );
    }
    if (status !== 200 || !headers.get("content-type")?.includes("html")) return "failed";
    const page = showPage(new TextDecoder().decode(body), SHOW_PAGE_CHARS);
    return page.text.length >= MIN_LISTING_CHARS ? { ...page, url: followed.url.href } : "failed";
  } catch (error) {
    await reportBackendError(error, "exhibitionRefresh.showPage");
    return "failed";
  }
}

/** Shows the listings name without verifiable dates, read from their own pages when the listings link to them. */
async function readOwnPages(
  ctx: ActionCtx,
  client: PoliteClient,
  context: ReadContext,
  links: PageLink[],
  listed: ShowsRead,
): Promise<{ shows: VerifiedShow[]; complete: boolean; cacheable: boolean }> {
  const dated = new Set(listed.shows.map((show) => titleKey(show.title)));
  const undated = listed.candidates.filter(
    (candidate) =>
      candidate.kind === "temporary_exhibition" && candidate.venueMatch && !dated.has(titleKey(candidate.title)),
  );
  const urls = showPages(
    undated.map((candidate) => candidate.title),
    links,
    MAX_SHOW_PAGES,
  );
  if (urls.length === 0) return { shows: [], complete: true, cacheable: true };
  const results = await Promise.all(urls.map((url) => readShowPage(client, url)));
  const complete = !results.includes("failed");
  const pages = withinBudget(results.flatMap((page) => (typeof page === "string" ? [] : [page])));
  if (pages.length === 0) return { shows: [], complete, cacheable: false };
  const read = await readShows(ctx, context, pages, true);
  if (typeof read === "string") return { shows: [], complete: false, cacheable: false };
  return { shows: read.shows.filter((show) => !dated.has(titleKey(show.title))), complete, cacheable: false };
}

async function extractShows(
  ctx: ActionCtx,
  client: PoliteClient,
  museum: ListingMuseum,
  read: ListingRead,
  tavily: TavilyRead,
  names: string[] | null,
): Promise<CheckOutcome> {
  const fallbackPages = read.fallback.flatMap(longerText(tavily));
  const incomplete = names === null || read.failed > 0 || fallbackPages.length < read.fallback.length;
  const pages = withinBudget([...read.pages, ...fallbackPages]);
  const checkedAt = Date.now();
  if (read.fallback.some(({ url }) => tavily.skipped.has(url))) return { kind: "deferred" };
  if (pages.length === 0) {
    return read.failed === 0 && read.fallback.length === 0 ? { kind: "blocked", checkedAt } : { kind: "unavailable" };
  }
  const pageHash = await listingHash(await capturePages(pages, checkedAt), read.links);
  if (pageHash === museum.pageHash) {
    return incomplete ? { kind: "partial", shows: [] } : { kind: "unchanged", checkedAt };
  }
  const context: ReadContext = { museum, siteNames: [...new Set(read.siteNames)], otherNames: names ?? [], checkedAt };
  const listed = await readShows(ctx, context, pages);
  if (listed === "deferred") return { kind: "deferred" };
  if (listed === "failed") return { kind: "unavailable" };
  const own = await readOwnPages(ctx, client, context, read.links, listed);
  const shows = [...listed.shows, ...own.shows];
  if (incomplete || !own.complete) return { kind: "partial", shows };
  // Detail-page dates can change independently of the listing, so only self-contained listings may skip a read.
  return { kind: "changed", checkedAt, ...(own.cacheable ? { pageHash } : {}), shows };
}

export async function eachConcurrently<T>(items: T[], limit: number, run: (item: T, index: number) => Promise<void>) {
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
      const client = backgroundClient(ctx);
      const reads: ListingRead[] = Array(museums.length);
      await eachConcurrently(museums, PAGE_READERS, async (museum, index) => {
        reads[index] = await readListings(client, museum);
      });
      const tavily = await readWithTavily(
        ctx,
        reads.flatMap((read) => read.fallback.map(({ url }) => url)),
      );
      const names = await wikidataNames(museums);
      await eachConcurrently(museums, MODEL_READERS, async (museum, index) => {
        const otherNames = museum.wikidataId && names === null ? null : (names?.get(museum.museumId) ?? []);
        const outcome = await extractShows(ctx, client, museum, reads[index], tavily, otherNames);
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
    const museum = await ctx.db.get("museums", row.museumId);
    if (!museum) {
      await ctx.db.delete("exhibitionRefreshes", refreshId);
      return null;
    }
    if ((outcome.kind === "changed" || outcome.kind === "partial") && !(await isVenueOptedOut(ctx, museum))) {
      for (const show of outcome.shows) {
        try {
          await saveExhibition(ctx, museum, show);
        } catch (error) {
          // A show the import rules reject, or one a newer import already holds, is left out on its own.
          if (!(error instanceof ConvexError)) throw error;
        }
      }
    }
    if (outcome.kind === "unavailable" || outcome.kind === "partial") {
      const failures = row.failures + 1;
      await ctx.db.patch("exhibitionRefreshes", refreshId, {
        failures,
        dueAt: retryAt(Date.now(), failures),
        leasedUntil: undefined,
        ...(outcome.kind === "partial" ? { pageHash: undefined } : {}),
      });
      return null;
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

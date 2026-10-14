import type { Infer } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { capturePages, listingHash, listingText } from "./lib/exhibitionListings";
import type { exhibitionSource } from "./lib/exhibitionSourceValidators";
import { jsonResponse } from "./lib/labelFixtures";
import { readSpend, seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T19:00:00Z");
const MODEL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY = "https://api.tavily.com/extract";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const BAY_AREA = "San Francisco Bay Area";
// Readable listings carry more text than a JavaScript shell, so pad the fixture past that threshold.
const VISIT_TEXT = "Plan your visit with timed tickets, accessibility services and member previews. ".repeat(25);
const TIDES = {
  html: "<article><header><h2>Tides of Light</h2></header><p>Verified Museum presents Tides of Light, October 1 – October 31, 2026.</p></article>",
  candidate: (url: string) => ({
    title: "Tides of Light",
    url,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dateText: "October 1 – October 31, 2026",
    titleEvidence: "Tides of Light",
    venueEvidence: "Verified Museum presents Tides of Light",
    dateEvidence: "Tides of Light, October 1 – October 31, 2026",
    kind: "temporary_exhibition",
    venueMatch: true,
    datePrecision: "day",
  }),
};
// Tides of Light closes at the end of October 31 in San Francisco.
const TIDES_CLOSES = Date.parse("2026-11-01T06:59:59.999Z");

type Reply = { status?: number; type?: string; body?: string };
let web: Record<string, Reply>;
let tavilyPages: Record<string, string>;
let wikidataNames: Record<string, { labels?: Record<string, string>; aliases?: Record<string, string[]> }> | null;
let answer: (request: { messages: { content: string }[] }) => Response;
const fetchMock = vi.fn<typeof fetch>();

const listing = (shows: string) =>
  `<html><head><title>Exhibitions | Verified Museum</title></head><body><nav>Visit</nav><main><h1>Exhibitions</h1>${shows}<p>${VISIT_TEXT}</p></main></body></html>`;

const undatedShow = (url: string, title = "Tides of Light") => ({
  ...TIDES.candidate(url),
  title,
  startDate: null,
  endDate: null,
  dateText: "",
  titleEvidence: title,
  venueEvidence: "Exhibitions | Verified Museum",
  dateEvidence: title,
  datePrecision: "unknown",
});

const showDetail = ({ title, dateText }: { title: string; dateText: string }) =>
  `<html><head><title>${title} | Verified Museum</title></head><body><main><h1>${title}</h1><p>Verified Museum presents ${title}, ${dateText}.</p><p>${VISIT_TEXT}</p></main></body></html>`;

function modelAnswer(candidates: unknown[]): Response {
  return jsonResponse({
    choices: [
      { message: { content: JSON.stringify({ candidates, outcomeReason: "Listed shows" }) }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 2000, completion_tokens: 500 },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("FLAG_EXHIBITION_REFRESH", "on");
  vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  web = {};
  tavilyPages = {};
  wikidataNames = {};
  answer = () => modelAnswer([]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === MODEL) return answer(JSON.parse(String(init?.body)));
    if (url.startsWith(`${WIKIDATA}?`)) {
      if (!wikidataNames) return new Response("", { status: 503 });
      const names = wikidataNames;
      const ids = new URL(url).searchParams.get("ids")!.split("|");
      const entities = Object.fromEntries(
        ids.map((id) => {
          const entity = names[id];
          if (!entity) return [id, { id, missing: "" }];
          const labels = Object.entries(entity.labels ?? {}).map(([language, value]) => [
            language,
            { language, value },
          ]);
          const aliases = Object.entries(entity.aliases ?? {}).map(([language, values]) => [
            language,
            values.map((value) => ({ language, value })),
          ]);
          return [id, { id, labels: Object.fromEntries(labels), aliases: Object.fromEntries(aliases) }];
        }),
      );
      return jsonResponse({ entities });
    }
    if (url === TAVILY) {
      const { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
      const results = urls.flatMap((page) =>
        tavilyPages[page] ? [{ url: page, raw_content: tavilyPages[page] }] : [],
      );
      return jsonResponse({ results, usage: { credits: Math.ceil(results.length / 5) } });
    }
    const { status = 200, type = "text/html", body = "" } = web[url] ?? { status: 404 };
    return new Response(body, { status, headers: { "content-type": type } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function source(museumId: Id<"museums">, url: string, overrides: Partial<Infer<typeof exhibitionSource>> = {}) {
  return {
    museumId,
    websiteSnapshot: new URL(url).origin,
    status: "validated" as const,
    urls: [
      {
        url,
        purpose: "combined" as const,
        discoverySource: "navigation" as const,
        validatedAt: NOW - DAY,
        evidence: "Exhibitions heading with current show cards.",
        venueAssociation: "venue_specific" as const,
      },
    ],
    outcomeReason: "Verified the listing.",
    checkedAt: NOW - DAY,
    ...overrides,
  };
}

/** A San Francisco museum whose validated listing is its site's /exhibitions page. */
async function listedMuseum(t: Harness, host: string, region = BAY_AREA) {
  const museumId = await t.run((ctx) =>
    seedMuseum(ctx, { name: "Verified Museum", website: `https://${host}`, lat: 37.785, lng: -122.401, region }),
  );
  const url = `https://${host}/exhibitions`;
  await t.action(internal.exhibitionSources.upsertBatch, { records: [source(museumId, url)] });
  return { museumId, url };
}

const runScheduled = (t: Harness) => t.finishAllScheduledFunctions(() => vi.runOnlyPendingTimersAsync());

async function readDue(t: Harness) {
  await t.mutation(internal.exhibitionRefresh.dispatch, {});
  await runScheduled(t);
}

async function refreshRow(t: Harness, museumId: Id<"museums">): Promise<Doc<"exhibitionRefreshes"> | null> {
  return t.run((ctx) =>
    ctx.db
      .query("exhibitionRefreshes")
      .withIndex("by_museumId", (q) => q.eq("museumId", museumId))
      .unique(),
  );
}

const requested = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input) === url);

describe("exhibition listing refresh", () => {
  it("reads a new listing, keeps only quoted shows and reads it again after its next show closes", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    web["https://museum.example/robots.txt"] = { type: "text/plain", body: "User-agent: *\nAllow: /" };
    web[url] = { body: listing(TIDES.html) };
    answer = () =>
      modelAnswer([
        TIDES.candidate(url),
        { ...TIDES.candidate(url), title: "Ghost Show", titleEvidence: "Ghost Show" },
      ]);

    await readDue(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(catalog.exhibitions).toEqual([
      expect.objectContaining({
        title: "Tides of Light",
        sourceUrl: url,
        viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
      }),
    ]);
    const row = await refreshRow(t, museumId);
    expect(row).toMatchObject({
      checkedAt: expect.any(Number),
      pageHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      failures: 0,
      dueAt: TIDES_CLOSES + 3 * DAY,
    });
    expect(row?.leasedUntil).toBeUndefined();
    const pageRequests = fetchMock.mock.calls.filter(([input]) => String(input).startsWith("https://museum.example/"));
    expect(pageRequests.map(([input]) => String(input))).toEqual(["https://museum.example/robots.txt", url]);
    expect(
      pageRequests.every(([, init]) => new Headers(init?.headers).get("User-Agent")?.startsWith("artlog-bot/")),
    ).toBe(true);
    expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 1, tavilyCredits: 0 });
  });

  it("keeps regions Explore shows on schedule, skips the model for unchanged pages and leaves other regions until opened", async () => {
    const t = harness();
    const { as } = await seedDevice(t);
    const shown = await listedMuseum(t, "museum.example");
    const unseen = await listedMuseum(t, "elsewhere.example", "Elsewhere");
    for (const { url } of [shown, unseen]) web[url] = { body: listing(TIDES.html) };
    answer = (request) => {
      const url = request.messages[1].content.includes("elsewhere.example") ? unseen.url : shown.url;
      return modelAnswer([TIDES.candidate(url)]);
    };
    await readDue(t);
    expect(requested(MODEL)).toHaveLength(2);

    const later = NOW + 26 * DAY;
    vi.setSystemTime(later);
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    await runScheduled(t);
    expect(requested(shown.url)).toHaveLength(2);
    expect(requested(MODEL)).toHaveLength(2);
    const checked = (await refreshRow(t, shown.museumId))!;
    expect(checked.checkedAt).toBeGreaterThanOrEqual(later);
    expect(checked.dueAt).toBe(checked.checkedAt! + 30 * DAY);

    vi.setSystemTime(later + 29 * DAY);
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    vi.setSystemTime(later + 31 * DAY);
    web[shown.url] = { body: listing(`${TIDES.html}<p>Paper Worlds opens soon.</p>`) };
    await readDue(t);
    expect(requested(shown.url)).toHaveLength(3);
    expect(requested(MODEL)).toHaveLength(3);
    expect(requested(unseen.url)).toHaveLength(1);
  });

  it("reads numeric dates in the order of the museum's country", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "musee.example", "paris");
    const show = "Verified Museum présente Beauté(s), du 01.07.2026 au 10.01.2027.";
    web[url] = { body: listing(`<p>${show}</p>`) };
    answer = () =>
      modelAnswer([
        {
          ...TIDES.candidate(url),
          title: "Beauté(s)",
          startDate: "2026-07-01",
          endDate: "2027-01-10",
          dateText: "du 01.07.2026 au 10.01.2027",
          titleEvidence: "Beauté(s)",
          venueEvidence: "Verified Museum présente",
          dateEvidence: "Beauté(s), du 01.07.2026 au 10.01.2027",
        },
      ]);

    await readDue(t);

    const [stored] = (await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).exhibitions;
    expect(stored?.viewingPeriods).toEqual([{ startDate: "2026-07-01", endDate: "2027-01-10" }]);
  });

  it("accepts a venue quote that uses one of the museum's Wikidata names in another language", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "rusmuseum.example", "country:RU");
    await t.run((ctx) => ctx.db.patch("museums", museumId, { wikidataId: "Q211043" }));
    wikidataNames = {
      Q211043: { labels: { ru: "Государственный Русский музей" }, aliases: { ru: ["Русский музей"] } },
    };
    const show = "Русский музей представляет выставку «Стекло и камень», 30 апреля 2026 – 26 октября 2026.";
    web[url] = { body: listing(`<p>${show}</p>`) };
    answer = ({ messages }) => {
      const prompt = JSON.parse(messages[1].content.split("DATA:\n")[1]);
      if (!prompt.museum.venueNames.includes("Русский музей")) return modelAnswer([]);
      return modelAnswer([
        {
          ...TIDES.candidate(url),
          title: "Стекло и камень",
          startDate: "2026-04-30",
          endDate: "2026-10-26",
          dateText: "30 апреля 2026 – 26 октября 2026",
          titleEvidence: "Стекло и камень",
          venueEvidence: "Русский музей представляет",
          dateEvidence: "«Стекло и камень», 30 апреля 2026 – 26 октября 2026",
        },
      ]);
    };

    await readDue(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(catalog.exhibitions).toEqual([
      expect.objectContaining({
        title: "Стекло и камень",
        viewingPeriods: [{ startDate: "2026-04-30", endDate: "2026-10-26" }],
      }),
    ]);
  });

  it("still reads a listing when Wikidata is unavailable, judging the venue by the museum's own name", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    await t.run((ctx) => ctx.db.patch("museums", museumId, { wikidataId: "Q1" }));
    wikidataNames = null;
    web[url] = { body: listing(TIDES.html) };
    answer = () => modelAnswer([TIDES.candidate(url)]);

    await readDue(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(catalog.exhibitions.map((show) => show.title)).toEqual(["Tides of Light"]);
  });

  it("retries localized venue evidence when Wikidata recovers without a listing change", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const other = await listedMuseum(t, "other.example");
    await t.run((ctx) => ctx.db.patch("museums", museumId, { wikidataId: "Q1" }));
    web[url] = {
      body: listing("<p>Русский музей presents Tides of Light, October 1 – October 31, 2026.</p>"),
    };
    web[other.url] = { body: listing(TIDES.html) };
    answer = ({ messages }) =>
      modelAnswer([
        messages[1].content.includes(other.url)
          ? TIDES.candidate(other.url)
          : { ...TIDES.candidate(url), venueEvidence: "Русский музей" },
      ]);
    wikidataNames = null;

    await readDue(t);

    expect((await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).exhibitions).toHaveLength(0);
    const row = (await refreshRow(t, museumId))!;
    expect(row.failures).toBe(1);
    expect(row.pageHash).toBeUndefined();
    expect(row.dueAt).toBeGreaterThanOrEqual(NOW + DAY);
    expect(row.dueAt).toBeLessThan(NOW + 2 * DAY);
    expect((await refreshRow(t, other.museumId))?.failures).toBe(0);

    wikidataNames = { Q1: { aliases: { ru: ["Русский музей"] } } };
    vi.setSystemTime(row.dueAt);
    await readDue(t);

    const recovered = await t.query(api.exhibitions.atMuseum, { museumId, asOf: row.dueAt });
    expect(recovered.exhibitions.map((show) => show.title)).toEqual(["Tides of Light"]);
    expect((await refreshRow(t, museumId))?.failures).toBe(0);
    expect(requested(url)).toHaveLength(2);
  });

  it.each(["dates", "ellipsis", "whole quote"])("rejects nearby related-show dates quoted as %s", async (quote) => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const showUrl = "https://museum.example/exhibitions/tides";
    const body = "Tides of Light Dates to be announced. Related exhibitions Paper Worlds Until January 3, 2027";
    web[url] = { body: listing('<a href="/exhibitions/tides">Tides of Light</a>') };
    web[showUrl] = {
      body: `<html><head><title>Tides of Light | Verified Museum</title></head><body><main>
        <h1>Tides of Light</h1><p>Dates to be announced.</p>
        <h2>Related exhibitions</h2><h3>Paper Worlds</h3><p>Until January 3, 2027</p>
        <p>${VISIT_TEXT}</p></main></body></html>`,
    };
    const own = {
      ...TIDES.candidate(showUrl),
      startDate: null,
      endDate: "2027-01-03",
      dateText: "Until January 3, 2027",
      dateEvidence:
        quote === "dates"
          ? "Until January 3, 2027"
          : quote === "ellipsis"
            ? "Tides of Light ... Until January 3, 2027"
            : body,
      venueEvidence: "Verified Museum",
    };
    answer = ({ messages }) => modelAnswer([messages[1].content.includes(showUrl) ? own : undatedShow(url)]);

    await readDue(t);

    expect((await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).exhibitions).toHaveLength(0);
  });

  it("reads the dates of a show the listing names without them from the show's own page", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const showUrl = "https://museum.example/exhibitions/tides";
    web[url] = { body: listing(`<article><a href="/exhibitions/tides"><h2>Tides of Light</h2></a></article>`) };
    web[showUrl] = { body: showDetail(TIDES.candidate(showUrl)) };
    const undated = undatedShow(url);
    const ownDates = { ...TIDES.candidate(showUrl), dateEvidence: "October 1 – October 31, 2026" };
    answer = (request) => modelAnswer([request.messages[1].content.includes(showUrl) ? ownDates : undated]);

    await readDue(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(catalog.exhibitions).toEqual([
      expect.objectContaining({
        title: "Tides of Light",
        sourceUrl: showUrl,
        viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
      }),
    ]);
    expect(requested(showUrl)).toHaveLength(1);
    expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 2, tavilyCredits: 0 });
  });

  it("refreshes an extended exhibition when only its linked detail page changes", async () => {
    const t = harness();
    const { as } = await seedDevice(t);
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const showUrl = "https://museum.example/exhibitions/tides";
    web[url] = { body: listing('<a href="/exhibitions/tides">Tides of Light</a>') };
    const cached = (await refreshRow(t, museumId))!;
    const priorHash = await listingHash(await capturePages([{ url, text: listingText(web[url].body!) }], NOW));
    await t.run((ctx) => ctx.db.patch("exhibitionRefreshes", cached._id, { pageHash: priorHash }));
    let dated = { ...TIDES.candidate(showUrl), dateEvidence: "October 1 – October 31, 2026" };
    web[showUrl] = { body: showDetail(dated) };
    answer = ({ messages }) => modelAnswer([messages[1].content.includes(showUrl) ? dated : undatedShow(url)]);
    await readDue(t);
    const initial = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(initial.exhibitions).toHaveLength(1);

    dated = {
      ...dated,
      endDate: "2026-11-30",
      dateText: "October 1 – November 30, 2026",
      dateEvidence: "October 1 – November 30, 2026",
    };
    web[showUrl] = { body: showDetail(dated) };
    const later = NOW + 26 * DAY;
    vi.setSystemTime(later);
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    await runScheduled(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: later });
    expect(catalog.exhibitions).toEqual([
      expect.objectContaining({ viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-11-30" }] }),
    ]);
    expect(requested(showUrl)).toHaveLength(2);
    expect((await refreshRow(t, museumId))?.failures).toBe(0);
  });

  it("retries a cached typography miss and imports dates from the detail page's own heading", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const showUrl = `${url}/artist`;
    const title = "An Artist's World";
    web[url] = { body: listing('<a href="/exhibitions/artist">An Artist’s World</a>') };
    web[showUrl] = {
      body: `<title>An Artist’s World | Verified Museum</title><main><h1>An Artist’s World</h1>
        <p>A temporary exhibition at Verified Museum.</p><h2><button>October 1 – October 31, 2026</button></h2>
        <h2>Related exhibitions</h2><h3>Paper Worlds</h3><p>Until January 3, 2027</p></main>`,
    };
    const row = (await refreshRow(t, museumId))!;
    // The unversioned parser cached this listing without following its curly-apostrophe link.
    await t.run((ctx) =>
      ctx.db.patch("exhibitionRefreshes", row._id, {
        pageHash: "9296533e9f9963c9723eee51187a613a1f5a1850bffb14c26cb5c514c7fe814d",
      }),
    );
    answer = ({ messages }) =>
      modelAnswer([
        messages[1].content.includes(showUrl)
          ? {
              ...TIDES.candidate(showUrl),
              title,
              titleEvidence: title,
              venueEvidence: "Verified Museum",
              dateEvidence: "October 1 – October 31, 2026",
            }
          : undatedShow(url, title),
      ]);

    await readDue(t);

    const catalog = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
    expect(catalog.exhibitions).toEqual([
      expect.objectContaining({
        title,
        sourceUrl: showUrl,
        viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
      }),
    ]);
    expect(requested(showUrl)).toHaveLength(1);
    expect((await refreshRow(t, museumId))?.pageHash).toBeUndefined();
    expect((await refreshRow(t, museumId))?.failures).toBe(0);
  });

  describe.each([false, true])("when another detail page succeeds: %s", (anotherSucceeds) => {
    it.each([503, 429, "network"] as const)("retries a detail page after %s", async (failure) => {
      const t = harness();
      const { museumId, url } = await listedMuseum(t, "museum.example");
      const showUrl = "https://museum.example/exhibitions/tides";
      const paperUrl = "https://museum.example/exhibitions/paper";
      const tides = { ...TIDES.candidate(showUrl), dateEvidence: "October 1 – October 31, 2026" };
      const paper = {
        ...TIDES.candidate(paperUrl),
        title: "Paper Worlds",
        titleEvidence: "Paper Worlds",
        venueEvidence: "Verified Museum",
        dateEvidence: "October 1 – October 31, 2026",
      };
      web[url] = {
        body: listing(
          '<a href="/exhibitions/tides">Tides of Light</a>'
            + (anotherSucceeds ? '<a href="/exhibitions/paper">Paper Worlds</a>' : ""),
        ),
      };
      web[paperUrl] = { body: showDetail(paper) };
      web[showUrl] = { status: typeof failure === "number" ? failure : 503 };
      const fetchPage = fetchMock.getMockImplementation()!;
      let unavailable = true;
      fetchMock.mockImplementation((input, init) => {
        if (unavailable && failure === "network" && String(input) === showUrl) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return fetchPage(input, init);
      });
      answer = ({ messages }) => {
        const { pages } = JSON.parse(messages[1].content.split("DATA:\n")[1]) as { pages: { url: string }[] };
        return modelAnswer(
          pages[0].url === url
            ? [undatedShow(url), ...(anotherSucceeds ? [undatedShow(url, "Paper Worlds")] : [])]
            : [tides, paper].filter((show) => pages.some((page) => page.url === show.url)),
        );
      };
      await readDue(t);

      const row = (await refreshRow(t, museumId))!;
      expect(row.failures).toBe(1);
      expect(row.pageHash).toBeUndefined();
      expect(row.dueAt).toBeGreaterThanOrEqual(NOW + DAY);
      expect(row.dueAt).toBeLessThan(NOW + 2 * DAY);
      const partial = await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW });
      expect(partial.exhibitions.map((show) => show.title)).toEqual(anotherSucceeds ? ["Paper Worlds"] : []);

      unavailable = false;
      web[showUrl] = { body: showDetail(tides) };
      vi.setSystemTime(row.dueAt);
      await readDue(t);

      const recovered = await t.query(api.exhibitions.atMuseum, { museumId, asOf: row.dueAt });
      expect(recovered.exhibitions.map((show) => show.title).sort()).toEqual(
        anotherSucceeds ? ["Paper Worlds", "Tides of Light"] : ["Tides of Light"],
      );
      expect((await refreshRow(t, museumId))?.failures).toBe(0);
      expect(requested(showUrl)).toHaveLength(2);
    });
  });

  it.each(["robots", 401, 403, 451] as const)("treats a detail page's %s refusal as final", async (refusal) => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    const showUrl = "https://museum.example/exhibitions/tides";
    web[url] = { body: listing('<a href="/exhibitions/tides">Tides of Light</a>') };
    if (refusal === "robots") {
      web["https://museum.example/robots.txt"] = {
        type: "text/plain",
        body: "User-agent: artlog-bot\nDisallow: /exhibitions/tides",
      };
    } else {
      web[showUrl] = { status: refusal };
    }
    answer = () => modelAnswer([undatedShow(url)]);
    await readDue(t);

    const row = (await refreshRow(t, museumId))!;
    expect(row.failures).toBe(0);
    expect(row.dueAt).toBe(row.checkedAt! + 30 * DAY);
    expect(requested(showUrl)).toHaveLength(refusal === "robots" ? 0 : 1);
    expect(requested(TAVILY)).toHaveLength(0);
    expect(requested(MODEL)).toHaveLength(1);
  });

  it("honours robots.txt and refusals without asking Tavily to read the page", async () => {
    const t = harness();
    const disallowed = await listedMuseum(t, "private.example");
    const refusing = await listedMuseum(t, "refusing.example");
    web["https://private.example/robots.txt"] = {
      type: "text/plain",
      body: "User-agent: artlog-bot\nDisallow: /exhibitions",
    };
    web[disallowed.url] = { body: listing(TIDES.html) };
    web[refusing.url] = { status: 403 };

    await readDue(t);

    expect(requested(disallowed.url)).toHaveLength(0);
    expect(requested(TAVILY)).toHaveLength(0);
    expect(requested(MODEL)).toHaveLength(0);
    for (const { museumId } of [disallowed, refusing]) {
      const row = (await refreshRow(t, museumId))!;
      expect(row).toMatchObject({ checkedAt: expect.any(Number), failures: 0 });
      expect(row.dueAt).toBe(row.checkedAt! + 30 * DAY);
    }
  });

  it("reads listings drawn by JavaScript through one basic Tavily extract for the whole batch", async () => {
    const t = harness();
    const first = await listedMuseum(t, "first.example");
    const second = await listedMuseum(t, "second.example");
    // A short listing is not necessarily drawn by JavaScript: its own text stands when Tavily reads less.
    const short = await listedMuseum(t, "short.example");
    web[short.url] = { body: listing(TIDES.html).replace(`<p>${VISIT_TEXT}</p>`, "") };
    tavilyPages[short.url] = "Tides of Light";
    for (const { url } of [first, second]) {
      web[url] = {
        body: "<html><title>Exhibitions</title><body><div id=root></div><script>render()</script></body></html>",
      };
      tavilyPages[url] = `Exhibitions | Verified Museum\n${TIDES.html.replaceAll(/<[^>]+>/g, " ")}\n${VISIT_TEXT}`;
    }
    answer = (request) => {
      const [url] = [first, second, short]
        .map((museum) => museum.url)
        .filter((candidate) => request.messages[1].content.includes(candidate));
      return modelAnswer([TIDES.candidate(url)]);
    };

    await readDue(t);

    expect(requested(TAVILY)).toHaveLength(1);
    expect(JSON.parse(String(requested(TAVILY)[0][1]?.body))).toMatchObject({
      urls: expect.arrayContaining([first.url, second.url, short.url]),
      extract_depth: "basic",
    });
    for (const { museumId } of [first, second, short]) {
      expect((await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).exhibitions).toHaveLength(1);
    }
    expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 3, tavilyCredits: 1 });
  });

  it("backs off a failed read and runs the model on the next read", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    web[url] = { body: listing(TIDES.html) };
    answer = () => new Response("unavailable", { status: 503 });

    await readDue(t);

    expect(requested(MODEL)).toHaveLength(2);
    const row = await refreshRow(t, museumId);
    expect(row).toMatchObject({ failures: 1, dueAt: Date.now() + DAY });
    expect(row?.checkedAt).toBeUndefined();
    expect(row?.pageHash).toBeUndefined();
    expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 2, tavilyCredits: 0 });
  });

  it("stops background reads at half of either daily cap", async () => {
    const t = harness();
    await listedMuseum(t, "museum.example");
    await t.mutation(internal.spend.record, { tavilyCredits: 1000 });

    await readDue(t);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads nothing until the deployment turns it on", async () => {
    vi.stubEnv("FLAG_EXHIBITION_REFRESH", undefined);
    const t = harness();
    const { as } = await seedDevice(t);
    await listedMuseum(t, "museum.example");

    await readDue(t);
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    await runScheduled(t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("exploreRegionViews").collect())).toEqual([]);
  });

  it("follows listing discovery: schedules imported listings and drops museums that lost theirs", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    expect(await refreshRow(t, museumId)).toMatchObject({ dueAt: NOW, region: BAY_AREA, failures: 0 });

    web[url] = { body: listing(TIDES.html) };
    await readDue(t);
    expect(await refreshRow(t, museumId)).toMatchObject({ checkedAt: expect.any(Number) });
    const moved = `${url}/current`;
    await t.action(internal.exhibitionSources.upsertBatch, {
      records: [{ ...source(museumId, moved), checkedAt: NOW - 1000 }],
    });
    const rediscovered = await refreshRow(t, museumId);
    expect(rediscovered).toMatchObject({ dueAt: Date.now() });
    expect(rediscovered?.checkedAt).toBeUndefined();
    expect(rediscovered?.pageHash).toBeUndefined();

    await t.action(internal.exhibitionSources.upsertBatch, {
      records: [{ ...source(museumId, url), status: "no_listing_found", urls: [], checkedAt: NOW }],
    });
    expect(await refreshRow(t, museumId)).toBeNull();

    const imported = await t.run(async (ctx) => {
      const id = await seedMuseum(ctx, { website: "https://older.example", region: BAY_AREA });
      await ctx.db.insert("exhibitionSources", source(id, "https://older.example/exhibitions"));
      return id;
    });
    await t.mutation(internal.exhibitionRefresh.backfill, { cursor: null });
    await runScheduled(t);
    expect(await refreshRow(t, imported)).toMatchObject({ dueAt: Date.now(), failures: 0 });
  });

  it("leaves a dormant region off Explore's cities until a phone there asks for it", async () => {
    const t = harness();
    const { as } = await seedDevice(t);
    const { museumId, url } = await listedMuseum(t, "museum.example");
    web[url] = { body: listing(TIDES.html) };
    answer = () => modelAnswer([]);
    await readDue(t);

    vi.setSystemTime(NOW + 40 * DAY);
    await readDue(t);
    expect(requested(url)).toHaveLength(1);
    expect(await t.query(api.exhibitions.regions, { asOf: NOW + 40 * DAY })).toEqual([]);

    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    await runScheduled(t);
    expect(requested(url)).toHaveLength(2);
    expect(await refreshRow(t, museumId)).toMatchObject({ checkedAt: expect.any(Number) });
  });

  it("ignores an old worker after listing discovery replaces its source", async () => {
    const t = harness();
    const { museumId, url } = await listedMuseum(t, "museum.example");
    await t.mutation(internal.exhibitionRefresh.dispatch, {});
    const old = (await refreshRow(t, museumId))!;
    await t.action(internal.exhibitionSources.upsertBatch, {
      records: [source(museumId, `${url}/new`, { checkedAt: NOW })],
    });
    await t.mutation(internal.exhibitionRefresh.dispatch, {});
    await t.mutation(internal.exhibitionRefresh.recordCheck, {
      refreshId: old._id,
      leasedUntil: old.leasedUntil!,
      outcome: { kind: "changed", checkedAt: NOW, pageHash: "a".repeat(64), shows: [] },
    });
    const row = (await refreshRow(t, museumId))!;
    expect(row.checkedAt).toBeUndefined();
    expect(row.pageHash).toBeUndefined();
    expect(row.dueAt).toBe(NOW);
    expect(row.leasedUntil).toBe(old.leasedUntil);
    await runScheduled(t);
    expect(requested(url)).toHaveLength(0);
    expect(requested(`${url}/new`)).toHaveLength(1);
  });

  it("shares host spacing and crawl delays across batches and region requests", async () => {
    const t = harness();
    const { as } = await seedDevice(t);
    const times: number[] = [];
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://museum.example/")) times.push(Date.now());
      return respond(input, init);
    });
    web["https://museum.example/robots.txt"] = {
      type: "text/plain",
      body: "User-agent: artlog-bot\nAllow: /\nCrawl-delay: 2",
    };
    for (let index = 0; index < 21; index++) {
      const { url } = await listedMuseum(t, "museum.example");
      web[url] = { body: listing(TIDES.html) };
    }
    await t.mutation(internal.exhibitionRefresh.dispatch, {});
    await listedMuseum(t, "museum.example", "Elsewhere");
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: "Elsewhere" });
    await runScheduled(t);

    expect(requested("https://museum.example/exhibitions")).toHaveLength(22);
    const calls = fetchMock.mock.calls.filter(([input]) => String(input).startsWith("https://museum.example/"));
    for (let index = 0; index < times.length - 1; index++) {
      const minimumGap = String(calls[index][0]).endsWith("exhibitions") ? 2000 : 1000;
      expect(times[index + 1] - times[index]).toBeGreaterThanOrEqual(minimumGap);
    }
  });

  it.each(["rate limit", "unreadable fallback"])(
    "retries a partial read with %s while keeping verified shows",
    async (failure) => {
      const t = harness();
      const { museumId, url } = await listedMuseum(t, "museum.example");
      const upcoming = `${url}/upcoming`;
      const current = source(museumId, url, { checkedAt: NOW });
      await t.action(internal.exhibitionSources.upsertBatch, {
        records: [{ ...current, urls: [...current.urls, ...source(museumId, upcoming).urls] }],
      });
      web[url] = { body: listing(TIDES.html) };
      web[upcoming] = failure === "rate limit" ? { status: 429 } : { body: "<main>Loading</main>" };
      answer = () => modelAnswer([TIDES.candidate(url)]);
      await readDue(t);

      const row = (await refreshRow(t, museumId))!;
      expect(row.failures).toBe(1);
      expect(row.dueAt).toBe(Date.now() + DAY);
      expect(row.checkedAt).toBeUndefined();
      expect(row.pageHash).toBeUndefined();
      expect((await t.query(api.exhibitions.atMuseum, { museumId, asOf: NOW })).exhibitions).toHaveLength(1);

      vi.setSystemTime(row.dueAt);
      web[upcoming] = { body: listing("No upcoming shows.") };
      await readDue(t);
      expect(await refreshRow(t, museumId)).toMatchObject({ checkedAt: expect.any(Number), failures: 0 });
      expect(requested(upcoming)).toHaveLength(2);
    },
  );
});

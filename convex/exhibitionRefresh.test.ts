import type { Infer } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { exhibitionSource } from "./lib/exhibitionSourceValidators";
import { jsonResponse } from "./lib/labelFixtures";
import { readSpend, seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T19:00:00Z");
const MODEL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY = "https://api.tavily.com/extract";
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
let answer: (request: { messages: { content: string }[] }) => Response;
const fetchMock = vi.fn<typeof fetch>();

const listing = (shows: string) =>
  `<html><head><title>Exhibitions | Verified Museum</title></head><body><nav>Visit</nav><main><h1>Exhibitions</h1>${shows}<p>${VISIT_TEXT}</p></main></body></html>`;

function modelAnswer(candidates: unknown[]): Response {
  return jsonResponse({
    choices: [
      { message: { content: JSON.stringify({ candidates, outcomeReason: "Listed shows" }) }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 2000, completion_tokens: 500 },
  });
}

beforeEach(() => {
  // Only timers are faked, so the one-second pauses between a site's requests pass instantly while the clock holds.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubEnv("FLAG_EXHIBITION_REFRESH", "on");
  vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  web = {};
  tavilyPages = {};
  answer = () => modelAnswer([]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === MODEL) return answer(JSON.parse(String(init?.body)));
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

const runScheduled = (t: Harness) => t.finishAllScheduledFunctions(() => vi.runOnlyPendingTimers());

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
      checkedAt: NOW,
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
    vi.mocked(Date.now).mockReturnValue(later);
    await as.mutation(api.exhibitionRefresh.requestRegion, { region: BAY_AREA });
    await runScheduled(t);
    expect(requested(shown.url)).toHaveLength(2);
    expect(requested(MODEL)).toHaveLength(2);
    expect(await refreshRow(t, shown.museumId)).toMatchObject({ checkedAt: later, dueAt: later + 30 * DAY });

    vi.mocked(Date.now).mockReturnValue(later + 30 * DAY);
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
      expect(await refreshRow(t, museumId)).toMatchObject({ checkedAt: NOW, dueAt: NOW + 30 * DAY, failures: 0 });
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
    expect(row).toMatchObject({ failures: 1, dueAt: NOW + DAY });
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
    expect(await refreshRow(t, museumId)).toMatchObject({ checkedAt: NOW });
    const moved = `${url}/current`;
    await t.action(internal.exhibitionSources.upsertBatch, {
      records: [{ ...source(museumId, moved), checkedAt: NOW - 1000 }],
    });
    const rediscovered = await refreshRow(t, museumId);
    expect(rediscovered).toMatchObject({ dueAt: NOW });
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
    expect(await refreshRow(t, imported)).toMatchObject({ dueAt: NOW, failures: 0 });
  });
});

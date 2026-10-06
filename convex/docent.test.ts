import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guideOpening, guideResearch } from "../shared/audio/guide";
import { guideBodyFixture, sectionedGuide } from "../shared/audio/guide-fixtures";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { patchArtworkContent, readArtworkContent } from "./lib/artworkContent";
import { speechMp3 } from "./lib/hls.fixtures";
import { completion, jsonResponse } from "./lib/labelFixtures";
import { labelField } from "./lib/labelVerify";
import { limiter } from "./lib/rateLimits";
import { readSpend, seedArtworkWithObject, seedDevice, seedMuseum, seedScan } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const TOKEN_FACTORY = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY = "https://api.tavily.com/search";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const PAGE = "https://www.metmuseum.org/art/collection/search/436535";
const WIKIDATA_PAGE = "https://www.wikidata.org/wiki/Q18689458";
const SEARCH_HIT = "https://www.metmuseum.org/perspectives/wheat-field-cypresses-acquired";
const FACT_SHEET_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const DOCENT_MODEL = "nvidia/Nemotron-3_5-Lightning";

const ownerPage = `<!doctype html><html><head><title>Wheat Field with Cypresses</title><script>var x = 1;</script></head>
<body><nav>Visit Exhibitions Shop</nav><main><h1>Wheat Field with Cypresses</h1>
<p>Vincent van Gogh (Dutch, 1853–1890). 1889. Oil on canvas. Purchase, The Annenberg Foundation Gift, 1993. Accession Number: 1993.132.</p>
<p>Vincent van Gogh painted Wheat Field with Cypresses in 1889.</p><p>Van Gogh painted this wheat field with cypresses in late June 1889 while at the asylum in Saint-Rémy.</p></main>
<footer>Copyright</footer></body></html>`;

const entity = {
  id: "Q18689458",
  type: "item",
  labels: { en: { language: "en", value: "Wheat Field with Cypresses" } },
  claims: {
    P571: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: { type: "time", value: { time: "+1889-06-00T00:00:00Z" } },
        },
      },
    ],
    P217: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: { type: "string", value: "1993.132" },
        },
      },
    ],
    P195: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: { type: "wikibase-entityid", value: { id: "Q160236" } },
        },
      },
    ],
    P2048: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: {
            type: "quantity",
            value: {
              amount: "+73",
              unit: "http://www.wikidata.org/entity/Q174728",
            },
          },
        },
      },
    ],
    P1476: [
      {
        mainsnak: {
          snaktype: "value",
          datavalue: {
            type: "monolingualtext",
            value: { text: "Wheat Field with Cypresses", language: "en" },
          },
        },
      },
    ],
  },
};
const museumEntity = {
  id: "Q160236",
  type: "item",
  labels: { en: { language: "en", value: "Metropolitan Museum of Art" } },
};

const searchResponse = {
  results: [
    {
      url: SEARCH_HIT,
      title: "Wheat Field with Cypresses",
      content: "Short snippet.",
      raw_content:
        "The painting was acquired in 1993. The lively brushwork conveys wind through the wheat field. See [the painting](/art/collection/search/436535).",
      score: 0.9,
    },
    {
      url: "https://www.metmuseum.org/art/collection/search/99999",
      title: "Wheat Field with Cypresses",
      content: "Another version was made in a different year.",
      score: 0.99,
    },
    {
      url: "https://www.metmuseum.org/art/collection/search/caf%E9",
      title: "Latin-1 escape",
      content: "Malformed percent escape must not abort the action.",
      score: 0.9,
    },
    {
      url: "https://www.pinterest.com/pin/1",
      title: "Wheat field",
      content: "Pinned image",
      score: 0.95,
    },
    {
      url: "https://randomblog.example/vangogh",
      title: "Blog",
      content: "My thoughts",
      score: 0.8,
    },
    {
      url: "https://store.metmuseum.org/van-gogh-wheat-field-tee",
      title: "Van Gogh tee",
      content: "Reproduced on this comfy tee.",
      score: 0.9,
    },
    {
      url: "https://www.metmuseum.org/shop/prints/489070",
      title: "Custom print",
      content: "Order a print.",
      score: 0.9,
    },
  ],
  usage: { credits: 1 },
};

// Mock sheets cite URLs for readability; `models` turns them into the ids the request numbered.
type MockFact = { text: string; sourceUrl: string };
const facts: MockFact[] = [
  { text: "Vincent van Gogh painted Wheat Field with Cypresses in 1889.", sourceUrl: PAGE },
  { text: "The painting was acquired in 1993.", sourceUrl: SEARCH_HIT },
  { text: "Inventory number: 1993.132", sourceUrl: WIKIDATA_PAGE },
  { text: "It hung in a Paris salon.", sourceUrl: "https://invented.example/salon" },
  { text: "The painting was acquired in 1993.", sourceUrl: PAGE },
];
const prose = [
  {
    sentence: "Vincent van Gogh painted this wheat field in 1889.",
    fact_ids: ["f1"],
  },
  {
    sentence: "The museum acquired it in 1993 under inventory number 1993.132.",
    fact_ids: ["f2", "f3"],
  },
  { sentence: "It once hung in a Paris salon.", fact_ids: ["f9"] },
  { sentence: "Too short here.", fact_ids: ["f1"] },
];

type Route = (url: URL, init?: RequestInit) => Response | undefined;
const fetchMock = vi.fn<typeof fetch>();
let routes: Route[] = [];

beforeEach(() => {
  routes = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  vi.stubEnv("FACT_SHEET_MODEL", FACT_SHEET_MODEL);
  vi.stubEnv("DOCENT_MODEL", DOCENT_MODEL);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function page(href: string, html: string, init?: ResponseInit) {
  routes.push((url) => (url.href === href ? new Response(html, init) : undefined));
}
function wikidata(status = 200) {
  routes.push((url) => {
    if (`${url.origin}${url.pathname}` !== WIKIDATA) return undefined;
    if (status !== 200) return new Response("down", { status });
    const ids = (url.searchParams.get("ids") ?? "").split("|");
    const entities: Record<string, unknown> = {};
    for (const id of ids) {
      entities[id] = id === "Q18689458" ? entity : id === "Q160236" ? museumEntity : { id, missing: "" };
    }
    return jsonResponse({ entities });
  });
}
function tavily(response: unknown = searchResponse, status = 200) {
  routes.push((url) =>
    url.href === TAVILY ? (status === 200 ? jsonResponse(response) : new Response("down", { status })) : undefined,
  );
}
function models(sheet: MockFact[] = facts, sentences: unknown = prose) {
  routes.push((url, init) => {
    if (url.href !== TOKEN_FACTORY) return undefined;
    const body = JSON.parse(String(init?.body));
    if (body.model !== FACT_SHEET_MODEL) return completion(sentences);
    const sources: { id: string; url: string }[] = JSON.parse(body.messages[1].content).input.sources;
    return completion(
      sheet.map(({ text, sourceUrl }) => ({
        text,
        source: sources.find((source) => source.url === sourceUrl)?.id ?? "s99",
      })),
    );
  });
}
function everything() {
  page(PAGE, ownerPage);
  wikidata();
  tavily();
  models();
}
const calls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));
const bodies = (prefix: string) => calls(prefix).map(([, init]) => JSON.parse(String(init?.body)));

async function readArtwork(t: Harness, artworkId: Id<"artworks">) {
  return t.run(async (ctx) => {
    const artwork = await ctx.db.get("artworks", artworkId);
    if (!artwork) return null;
    const { _id, _creationTime, ...content } = (await readArtworkContent(ctx, artwork)) ?? {};
    return { ...artwork, ...content };
  });
}

async function fixture(
  options: {
    pageUrl?: string | null;
    wikidataId?: string | null;
    optOut?: boolean;
  } = {},
) {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const museumId = await t.run((ctx) =>
    seedMuseum(ctx, {
      name: "The Metropolitan Museum of Art",
      website: "https://www.metmuseum.org/",
      optOut: options.optOut ?? false,
    }),
  );
  const work = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: {
        title: "Wheat Field with Cypresses",
        artist: "Vincent van Gogh",
        date: "1889",
        wikidataId: options.wikidataId === null ? undefined : (options.wikidataId ?? "Q18689458"),
      },
      object: { ownerId: museumId },
      objectDetails: {
        pageUrl: options.pageUrl === null ? undefined : (options.pageUrl ?? PAGE),
      },
    }),
  );
  const artwork = () => readArtwork(t, work.artworkId);
  const spend = () => readSpend(t);
  const ensure = () => t.action(internal.docent.ensure, { artworkId: work.artworkId, deviceId });
  return { t, deviceId, museumId, work, artwork, spend, ensure };
}

describe("docent.ensure", () => {
  it.each(["facts", "prose"])("keeps a run retryable when all generated %s are rejected", async (stage) => {
    const { artwork, ensure } = await fixture();
    page(PAGE, ownerPage);
    wikidata();
    tavily();
    models(stage === "facts" ? [{ text: "An unsupported statement.", sourceUrl: PAGE }] : facts, [
      { sentence: "This sentence cites an unknown fact.", fact_ids: ["missing"] },
    ]);
    await ensure();
    expect((await artwork())?.docent?.en?.length ?? 0).toBe(0);
    expect(await artwork()).toHaveProperty("docentFailedAt");
    expect(await artwork()).not.toHaveProperty("enrichClaimedAt");
    routes = [];
    everything();
    await ensure();
    expect((await artwork())?.docent?.en).toHaveLength(2);
  });

  it("rebuilds empty cached research and prose on the next identification", async () => {
    const { t, work, artwork, ensure } = await fixture();
    await t.run(async (ctx) => {
      await patchArtworkContent(ctx, { _id: work.artworkId }, { factSheet: [], docent: { en: [] } });
      await ctx.db.patch("artworks", work.artworkId, { factSheetUpdatedAt: 1, docentUpdatedAt: 1 });
    });
    everything();
    await ensure();
    expect((await artwork())?.factSheet?.length).toBeGreaterThan(0);
    expect((await artwork())?.docent?.en).toHaveLength(2);
  });

  it("generates a sourced fact sheet and validated sentences on a cache miss and settles spend", async () => {
    const { artwork, spend, ensure } = await fixture();
    everything();
    await ensure();
    const stored = await artwork();
    expect(stored?.factSheet).toEqual([
      {
        id: "f1",
        text: "Vincent van Gogh painted Wheat Field with Cypresses in 1889.",
        sourceUrl: PAGE,
        sourceLabel: "The Metropolitan Museum of Art",
        sourceScore: 1,
      },
      {
        id: "f2",
        text: "The painting was acquired in 1993.",
        sourceUrl: SEARCH_HIT,
        sourceLabel: "metmuseum.org",
        sourceScore: 1,
      },
      {
        id: "f3",
        text: "Inventory number: 1993.132",
        sourceUrl: WIKIDATA_PAGE,
        sourceLabel: "Wikidata",
        sourceScore: 0.8,
      },
    ]);
    expect(stored?.docent).toEqual({
      en: [
        {
          sentence: "Vincent van Gogh painted this wheat field in 1889.",
          factIds: ["f1"],
        },
        {
          sentence: "The museum acquired it in 1993 under inventory number 1993.132.",
          factIds: ["f2", "f3"],
        },
      ],
    });
    expect(stored?.factSheetUpdatedAt).toEqual(expect.any(Number));
    expect(stored?.docentUpdatedAt).toEqual(expect.any(Number));
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 2,
      tavilyCredits: 2,
    });

    const [search] = bodies(TAVILY);
    expect(search).toMatchObject({
      query: '"Wheat Field with Cypresses" Vincent van Gogh The Metropolitan Museum of Art',
      include_raw_content: "markdown",
      topic: "general",
      search_depth: "basic",
      max_results: 8,
      include_domains_mode: "filter",
    });
    expect(search.include_domains).toContain("metmuseum.org");
    expect(search.include_domains).not.toContain("pinterest.com");
    const [sheet, docent] = bodies(TOKEN_FACTORY);
    expect(sheet).toMatchObject({
      model: FACT_SHEET_MODEL,
      temperature: 0,
      max_tokens: 6000,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(JSON.parse(sheet.messages[1].content).input.target).toEqual({
      title: "Wheat Field with Cypresses",
      artist: "Vincent van Gogh",
      date: "1889",
      wikidataId: "Q18689458",
    });
    const input = JSON.parse(sheet.messages[1].content).input.sources as {
      url: string;
      label: string;
      score: number;
      text: string;
    }[];
    expect(input.map(({ url, label, score }) => ({ url, label, score }))).toEqual([
      { url: PAGE, label: "The Metropolitan Museum of Art", score: 1 },
      { url: SEARCH_HIT, label: "metmuseum.org", score: 1 },
      { url: WIKIDATA_PAGE, label: "Wikidata", score: 0.8 },
    ]);
    expect(input[0].text).toContain("Saint-Rémy");
    expect(input[1].text).toContain("lively brushwork");
    expect(calls(TAVILY)).toHaveLength(2);
    expect(input[0].text).not.toContain("Visit Exhibitions Shop");
    expect(input[2].text).toContain("Inception: 1889");
    expect(input[2].text).toContain("Collection: Metropolitan Museum of Art");
    expect(input[2].text).toContain("Height: 73 cm");
    expect(input[2].text).toContain("Inventory number: 1993.132");
    expect(docent).toMatchObject({
      model: DOCENT_MODEL,
      temperature: 0,
      max_tokens: 1024,
    });
    expect(JSON.parse(docent.messages[1].content).input).toEqual(stored?.factSheet);
  });

  it("makes no calls when sentences are cached, under review, or claimed by a concurrent run", async () => {
    const { t, work, artwork, ensure, spend } = await fixture();
    everything();
    await t.run(async (ctx) => {
      await patchArtworkContent(
        ctx,
        { _id: work.artworkId },
        { docent: { en: [{ sentence: "A cached paragraph about the painting.", factIds: ["f1"] }] } },
      );
      await ctx.db.patch("artworks", work.artworkId, { docentUpdatedAt: 1 });
    });
    await ensure();
    await t.run(async (ctx) => {
      await patchArtworkContent(ctx, { _id: work.artworkId }, { docent: undefined });
      await ctx.db.patch("artworks", work.artworkId, {
        docentUpdatedAt: undefined,
        factSheetNeedsReview: true,
      });
    });
    await ensure();
    await t.run((ctx) =>
      ctx.db.patch("artworks", work.artworkId, {
        factSheetNeedsReview: undefined,
        enrichClaimedAt: Date.now() - 5 * 60 * 1000,
      }),
    );
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    await t.run((ctx) =>
      ctx.db.patch("artworks", work.artworkId, {
        enrichClaimedAt: Date.now() - 11 * 60 * 1000,
      }),
    );
    await ensure();
    expect((await artwork())?.docent?.en).toHaveLength(2);
  });

  it("skips generation without spending when the models are unconfigured or the daily cap is reached", async () => {
    const { artwork, ensure, spend } = await fixture();
    everything();
    vi.stubEnv("DOCENT_MODEL", "");
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await artwork()).not.toHaveProperty("enrichClaimedAt");
    expect(await artwork()).toHaveProperty("docentFailedAt");
    vi.stubEnv("DOCENT_MODEL", DOCENT_MODEL);
    vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "0");
    await ensure();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    expect(await artwork()).not.toHaveProperty("enrichClaimedAt");
    expect(await artwork()).toHaveProperty("docentFailedAt");
  });

  it("fetches the owner page only on the venue host and never for an opted-out venue", async () => {
    const offHost = await fixture({ pageUrl: "https://mirror.example/436535" });
    everything();
    await offHost.ensure();
    expect(calls("https://mirror.example")).toEqual([]);
    expect((await offHost.artwork())?.factSheet?.map((fact) => fact.sourceUrl)).toEqual([WIKIDATA_PAGE]);

    fetchMock.mockClear();
    const optedOut = await fixture({ optOut: true });
    await optedOut.ensure();
    expect(calls(PAGE)).toEqual([]);
    expect((await optedOut.artwork())?.factSheet?.map((fact) => fact.sourceUrl)).toEqual([WIKIDATA_PAGE]);
  });

  it("keeps missing evidence and fetch failures retryable without caching empty success", async () => {
    const bare = await fixture({ pageUrl: null, wikidataId: null });
    tavily({
      results: [
        {
          url: "https://randomblog.example/x",
          title: "x",
          content: "y",
          score: 0.9,
        },
      ],
      usage: { credits: 1 },
    });
    models();
    await bare.ensure();
    expect((await bare.artwork())?.factSheet).toBeUndefined();
    expect((await bare.artwork())?.docent).toBeUndefined();
    expect(await bare.artwork()).not.toHaveProperty("enrichClaimedAt");
    expect(await bare.artwork()).toHaveProperty("docentFailedAt");
    expect(calls(TOKEN_FACTORY)).toEqual([]);
    expect(await bare.spend()).toMatchObject({
      tokenFactoryCalls: 0,
      tavilyCredits: 2,
    });

    fetchMock.mockClear();
    routes = [];
    const failing = await fixture();
    page(PAGE, "down", { status: 503 });
    wikidata(500);
    tavily(undefined, 500);
    models();
    await failing.ensure();
    const stored = await failing.artwork();
    expect(stored?.factSheet).toBeUndefined();
    expect(stored?.docent).toBeUndefined();
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(stored?.docentFailedAt).toEqual(expect.any(Number));
    expect(calls(TOKEN_FACTORY)).toEqual([]);

    routes = [];
    everything();
    await failing.ensure();
    expect(await failing.artwork()).not.toHaveProperty("docentFailedAt");
    expect((await failing.artwork())?.docent?.en).toHaveLength(2);
  });

  it("releases the claim, settles spend, and writes nothing when the model fails", async () => {
    const { artwork, ensure, spend } = await fixture();
    page(PAGE, ownerPage);
    wikidata();
    tavily();
    routes.push((url) =>
      url.href === TOKEN_FACTORY ? new Response("busy", { status: 503, headers: { "retry-after": "0" } }) : undefined,
    );
    await expect(ensure()).rejects.toMatchObject({
      data: { code: "model_error", reason: "http_503", calls: 2 },
    });
    const stored = await artwork();
    expect(stored?.factSheet).toBeUndefined();
    expect(stored?.enrichClaimedAt).toBeUndefined();
    expect(stored?.docentFailedAt).toEqual(expect.any(Number));
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 2,
      tavilyCredits: 2,
    });
  });

  it("rewrites only the sentences when a current fact sheet exists", async () => {
    const { t, work, artwork, ensure, spend } = await fixture();
    everything();
    const factSheet = [
      {
        id: "f1",
        text: "Painted in 1889.",
        sourceUrl: PAGE,
        sourceLabel: "The Met",
        sourceScore: 1,
      },
    ];
    await t.run(async (ctx) => {
      await patchArtworkContent(ctx, { _id: work.artworkId }, { factSheet });
      await ctx.db.patch("artworks", work.artworkId, { factSheetUpdatedAt: 5 });
    });
    await ensure();
    expect(calls(TAVILY)).toEqual([]);
    expect(calls(PAGE)).toEqual([]);
    expect(bodies(TOKEN_FACTORY).map((body) => body.model)).toEqual([DOCENT_MODEL]);
    const stored = await artwork();
    expect(stored).toMatchObject({ factSheet, factSheetUpdatedAt: 5 });
    expect(stored?.docent?.en).toEqual([
      {
        sentence: "Vincent van Gogh painted this wheat field in 1889.",
        factIds: ["f1"],
      },
    ]);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 1 });
  });

  it("limits a device to sixty generations per hour", async () => {
    const { t, deviceId } = await fixture({ pageUrl: null, wikidataId: null });
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "1000");
    tavily();
    models();
    const artworkIds: Id<"artworks">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < 61; i++) {
        artworkIds.push((await seedArtworkWithObject(ctx)).artworkId);
      }
    });
    for (const artworkId of artworkIds) {
      await t.action(internal.docent.ensure, { artworkId, deviceId });
    }
    const last = await readArtwork(t, artworkIds[60]);
    expect(last?.factSheet).toBeUndefined();
    expect(last?.enrichClaimedAt).toBeUndefined();
    expect(calls(TAVILY)).toHaveLength(120);
    expect((await readArtwork(t, artworkIds[59]))?.docent?.en).toHaveLength(1);
  });
});

describe("catalog research", () => {
  it.each(["rate limit", "spend cap", "source failure"])("recovers on a later open after a %s", async (failure) => {
    vi.useFakeTimers();
    try {
      const { t, work, artwork } = await fixture();
      const { as, deviceId } = await seedDevice(t);
      if (failure === "rate limit") {
        await t.run((ctx) => limiter.limit(ctx, "docent", { key: deviceId, count: 60 }));
      } else if (failure === "spend cap") {
        vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "0");
      } else {
        page(PAGE, "down", { status: 503 });
        wikidata(500);
        tavily(undefined, 500);
      }
      expect(await as.mutation(api.artworks.research, { artworkId: work.artworkId })).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await artwork()).toHaveProperty("docentFailedAt");

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "1000");
      routes = [];
      everything();
      expect(await as.mutation(api.artworks.research, { artworkId: work.artworkId })).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await artwork())?.docent?.en).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves successful empty research alone until it is explicitly invalidated", async () => {
    vi.useFakeTimers();
    try {
      const { t, work, artwork } = await fixture({ pageUrl: null, wikidataId: null });
      const { as } = await seedDevice(t);
      tavily({ results: [], usage: { credits: 1 } });
      expect(await as.mutation(api.artworks.research, { artworkId: work.artworkId })).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await artwork())?.docent).toBeUndefined();
      const searches = calls(TAVILY).length;
      expect(searches).toBeGreaterThan(0);
      const other = await seedDevice(t);
      expect(await other.as.mutation(api.artworks.research, { artworkId: work.artworkId })).toBe(false);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(calls(TAVILY)).toHaveLength(searches);

      await t.mutation(internal.docent.invalidateDocent, { artworkId: work.artworkId });
      expect(await as.mutation(api.artworks.research, { artworkId: work.artworkId })).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(calls(TAVILY).length).toBeGreaterThan(searches);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("docent.retry", () => {
  async function confidentScan() {
    const setup = await fixture();
    const user = await seedDevice(setup.t);
    const scanId = await setup.t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        outcome: "confident",
        best: {
          identityStatus: "established",
          objectId: setup.work.objectId,
          artworkId: setup.work.artworkId,
          probability: 0.99,
        },
      }),
    );
    await setup.t.run((ctx) => ctx.db.patch("artworks", setup.work.artworkId, { docentFailedAt: 1 }));
    return { ...setup, user, scanId };
  }

  it("clears the failure and runs generation again for the scan's own device", async () => {
    vi.useFakeTimers();
    const { t, user, scanId, artwork } = await confidentScan();
    everything();
    await user.as.mutation(api.docent.retry, { scanId });
    expect(await artwork()).not.toHaveProperty("docentFailedAt");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect((await artwork())?.docent?.en).toHaveLength(2);
  });

  it("retries the catalogue work a missed scan was linked to", async () => {
    const { t, user, artwork, work } = await confidentScan();
    const linked = await t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        linked: { source: "label", objectId: work.objectId, artworkId: work.artworkId, linkedAt: 1 },
      }),
    );
    await user.as.mutation(api.docent.retry, { scanId: linked });
    expect(await artwork()).not.toHaveProperty("docentFailedAt");
  });

  it("rejects another device and a scan without a confident work", async () => {
    const { t, user, scanId, artwork } = await confidentScan();
    const other = await seedDevice(t);
    await expect(other.as.mutation(api.docent.retry, { scanId })).rejects.toMatchObject({
      data: { code: "invalid_scan" },
    });
    const soft = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, outcome: "soft" }));
    await expect(user.as.mutation(api.docent.retry, { scanId: soft })).rejects.toMatchObject({
      data: { code: "invalid_scan" },
    });
    expect((await artwork())?.docentFailedAt).toBe(1);
  });
});

describe("docent write mutations", () => {
  async function seeded(t: Harness) {
    return t.run((ctx) => seedArtworkWithObject(ctx));
  }

  it("writeEnrichment stores the sheet and sentences for the owning claim", async () => {
    const t = harness();
    const { artworkId } = await seeded(t);
    const generation = (await t.mutation(internal.docent.claim, {
      artworkId,
    }))!;
    const factSheet = [
      {
        id: "f1",
        text: "A fact.",
        sourceUrl: PAGE,
        sourceLabel: "The Met",
        sourceScore: 1,
      },
    ];
    const docentEn = [{ sentence: "A sentence with four words.", factIds: ["f1"] }];
    await t.mutation(internal.docent.writeEnrichment, {
      artworkId,
      generation,
      factSheet,
      docentEn,
    });
    const written = await t.run((ctx) => ctx.db.get("artworks", artworkId));
    expect(written).not.toHaveProperty("factSheet");
    expect(written).not.toHaveProperty("docent");
    expect(await t.run((ctx) => ctx.db.get("artworkContent", written!.contentId!))).toMatchObject({
      factSheet,
      docent: { en: docentEn },
    });
    expect(written).toMatchObject({
      factSheetUpdatedAt: expect.any(Number),
      docentUpdatedAt: expect.any(Number),
    });
    expect(written).not.toHaveProperty("enrichClaimedAt");
    expect(written).not.toHaveProperty("factSheetNeedsReview");
    await t.mutation(internal.docent.invalidateDocent, { artworkId });
    const invalidated = await t.run((ctx) => ctx.db.get("artworks", artworkId));
    const content = await t.run((ctx) => ctx.db.get("artworkContent", invalidated!.contentId!));
    expect(content).toMatchObject({ factSheet });
    expect(content).not.toHaveProperty("docent");
    expect(invalidated).not.toHaveProperty("docentUpdatedAt");
  });
});

it("rejects late writes and releases after a claim is reclaimed or invalidated", async () => {
  const t = harness();
  const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx));
  const generation = (await t.mutation(internal.docent.claim, { artworkId }))!;
  await t.run((ctx) => ctx.db.patch("artworks", artworkId, { enrichClaimedAt: Date.now() - 11 * 60 * 1000 }));
  const next = (await t.mutation(internal.docent.claim, { artworkId }))!;
  const result = { artworkId, factSheet: [], docentEn: [] };
  expect(
    await t.mutation(internal.docent.writeEnrichment, {
      ...result,
      generation,
    }),
  ).toBe(false);
  await t.mutation(internal.enrich.releaseClaim, { artworkId, generation });
  expect(await t.run((ctx) => ctx.db.get("artworks", artworkId))).toMatchObject({
    enrichGeneration: next,
    enrichClaimedAt: expect.any(Number),
  });
  await t.mutation(internal.docent.invalidateDocent, { artworkId });
  expect(
    await t.mutation(internal.docent.writeEnrichment, {
      ...result,
      generation: next,
    }),
  ).toBe(false);
  expect((await readArtwork(t, artworkId))?.docent).toBeUndefined();
});

it("shares a single research pass between independent docent and audio scripts", async () => {
  const { t, work, ensure, artwork } = await fixture();
  everything();
  await ensure();
  const researched = await artwork();
  vi.stubEnv("OPENAI_API_KEY", "speech-test");
  routes.unshift((url) =>
    url.href === TOKEN_FACTORY
      ? completion(
          sectionedGuide(
            guideBodyFixture.map(({ sentence, factIds }) => ({
              sentence,
              fact_ids: factIds,
              support: researched!.factSheet!.find((fact) => fact.id === factIds[0])!.text.slice(0, 30),
            })),
          ),
        )
      : undefined,
  );
  routes.push((url) =>
    url.href.includes("api.openai.com")
      ? new Response(speechMp3(100), {
          headers: { "Content-Type": "audio/mpeg" },
        })
      : undefined,
  );
  const { as } = await seedDevice(t);
  const spoken = await as.action(api.narration.render, {
    artworkId: work.artworkId,
  });
  expect(spoken.sentences).toEqual([
    { sentence: guideOpening(researched!), factIds: [], section: "hook" },
    ...guideBodyFixture,
  ]);
  expect((await artwork())?.docent).toEqual(researched?.docent);
  expect(calls(TAVILY)).toHaveLength(2);
  expect(JSON.parse(bodies(TOKEN_FACTORY)[2].messages[1].content).research).toEqual(
    guideResearch(researched!.factSheet!),
  );
});

it("refreshes the shared research when explicitly invalidated", async () => {
  const { t, work, ensure, artwork } = await fixture();
  everything();
  await ensure();
  await t.mutation(internal.docent.invalidateDocent, {
    artworkId: work.artworkId,
    includeResearch: true,
  });
  expect((await artwork())?.factSheet).toBeUndefined();
  expect((await artwork())?.docent).toBeUndefined();
  await ensure();
  expect(calls(TAVILY)).toHaveLength(4);
  expect((await artwork())?.factSheet?.length).toBeGreaterThan(0);
});

it("includes museum essays linked to the exact artwork while excluding another version", async () => {
  const { ensure } = await fixture({
    pageUrl: PAGE.replace("https:", "http:"),
  });
  page(PAGE, ownerPage);
  wikidata();
  models();
  tavily({
    results: [
      {
        url: "https://www.metmuseum.org/exhibitions/listings/2015/van-gogh",
        raw_content: "Historical context for [this painting](/exhibitions/view?oid=436535&exhibitionId=one).",
      },
      {
        url: "https://www.metmuseum.org/perspectives/another-version",
        raw_content: "Another version: [painting](/exhibitions/view?oid=99999).",
      },
      {
        url: "https://www.metmuseum.org/art/collection/search/99999",
        raw_content: "Another painting. Related work: [target](/art/collection/search/436535).",
      },
    ],
    usage: { credits: 1 },
  });
  await ensure();
  const { sources } = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input;
  expect(sources.map((source: { url: string }) => source.url)).toEqual([
    PAGE,
    "https://www.metmuseum.org/exhibitions/listings/2015/van-gogh",
    WIKIDATA_PAGE,
  ]);
  expect(calls(PAGE)).toHaveLength(1);
  expect(calls(TAVILY)).toHaveLength(2);
});

it("sends markdown search pages as plain prose, so a fact copied from an essay survives the verbatim check", async () => {
  const { ensure, artwork } = await fixture();
  const essay = "https://www.metmuseum.org/perspectives/van-gogh-cypresses";
  const quoted = {
    text: "He described the cypresses in Wheat Field with Cypresses as a splash of black.",
    sourceUrl: essay,
  };
  page(PAGE, ownerPage);
  wikidata();
  models([quoted]);
  tavily({
    results: [
      {
        url: essay,
        title: "Cypresses",
        content: "Snippet",
        raw_content:
          "## Letters\n\n![Detail](https://images.example/detail_(crop).jpg)\n\nHe described the cypresses in *Wheat Field with Cypresses* as a **splash of black**. See [the painting](/art/collection/search/436535).",
      },
    ],
    usage: { credits: 1 },
  });
  await ensure();
  const sources: { url: string; text: string }[] = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input
    .sources;
  expect(sources.find((source) => source.url === essay)?.text).toBe(
    "Cypresses\nLetters\n\nHe described the cypresses in Wheat Field with Cypresses as a splash of black. See the painting.",
  );
  expect((await artwork())?.factSheet?.map((fact) => fact.text)).toEqual([quoted.text]);
});

it.each([
  ["a shorter", PAGE, "Wheat Field with Cypresses, a painting.", "Saint-Rémy"],
  [
    "a fuller",
    PAGE,
    `Vincent van Gogh (Dutch, 1853–1890). ${"The lively brushwork conveys wind through the wheat field. ".repeat(20)}`,
    "lively brushwork",
  ],
  [
    "a translated",
    `${PAGE}?lang=it`,
    "Vincent van Gogh (Dutch, 1853–1890). Campo di grano con cipressi.",
    "Saint-Rémy",
  ],
])(
  "sends the owner page once when search returns %s copy of it, and keeps facts quoted from the text sent",
  async (_, url, rawContent, kept) => {
    const { ensure, artwork } = await fixture();
    const quoted = { text: "Vincent van Gogh (Dutch, 1853–1890).", sourceUrl: PAGE };
    page(PAGE, ownerPage);
    wikidata();
    models([quoted]);
    tavily({
      results: [
        {
          url,
          title: "Wheat Field with Cypresses",
          content: "Snippet",
          raw_content: rawContent,
        },
      ],
      usage: { credits: 1 },
    });
    await ensure();
    const sources: {
      url: string;
      label: string;
      score: number;
      text: string;
    }[] = JSON.parse(bodies(TOKEN_FACTORY)[0].messages[1].content).input.sources;
    const owner = sources.filter((source) => source.url === PAGE);
    expect(owner).toEqual([
      expect.objectContaining({
        label: "The Metropolitan Museum of Art",
        score: 1,
      }),
    ]);
    expect(owner[0].text).toContain(kept);
    expect((await artwork())?.factSheet?.map((fact) => fact.text)).toEqual([quoted.text]);
  },
);

describe("reference attribution review", () => {
  it("holds conflicting research and narration until an operator replaces the sheet", async () => {
    const t = harness();
    const { artworkId } = await t.run((ctx) => seedArtworkWithObject(ctx, { artwork: { artist: "Marten van Cleve" } }));
    const generation = (await t.mutation(internal.docent.claim, { artworkId }))!;
    const conflict = {
      field: "artist" as const,
      text: "Follower of Pieter Brueghel II",
      sourceUrl: "https://auction.example/1",
      sourceLabel: "Auction",
      referenceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    };
    expect(
      await t.mutation(internal.docent.writeEnrichment, {
        artworkId,
        generation,
        docentEn: [{ sentence: "Must not be published.", factIds: [] }],
        researchConflicts: [conflict],
      }),
    ).toBe(true);
    expect(await readArtwork(t, artworkId)).toMatchObject({
      artist: "Marten van Cleve",
      factSheetNeedsReview: true,
      researchConflicts: [conflict],
    });
    expect((await readArtwork(t, artworkId))?.docent).toBeUndefined();
    expect(await t.mutation(internal.docent.claim, { artworkId })).toBeNull();
    expect(await t.query(internal.review.listResearchConflicts, {})).toEqual({
      rows: [{ artworkId, title: "Water Lilies", artist: "Marten van Cleve", conflicts: [conflict] }],
      cursor: null,
    });
    expect(await t.mutation(internal.docent.writeEnrichment, { artworkId, generation, docentEn: [] })).toBe(false);
    await t.mutation(internal.review.replaceFactSheet, { artworkId, factSheet: [], correctionIds: [] });
    expect((await readArtwork(t, artworkId))?.researchConflicts).toBeUndefined();
    expect((await readArtwork(t, artworkId))?.factSheetNeedsReview).toBeUndefined();
  });

  it("runs reference verification before extracting facts and reconciles the extra model call", async () => {
    const t = harness();
    const { deviceId } = await seedDevice(t);
    const { artworkId } = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        artwork: { title: "Carnival and Lent", artist: "Marten van Cleve", wikidataId: "Q1" },
      }),
    );
    const citation = "https://auction.example/lot/1";
    const text = "Carnival and Lent. Follower of Pieter Brueghel II. Oil on circular panel, diameter 26.8 cm.";
    routes.push((url) => {
      if (url.href.startsWith(WIKIDATA)) {
        return jsonResponse({
          entities: {
            Q1: {
              id: "Q1",
              claims: { P170: [{ references: [{ snaks: { P854: [{ datavalue: { value: citation } }] } }] }] },
            },
          },
        });
      }
      if (url.href === "https://api.tavily.com/extract") {
        return jsonResponse({ results: [{ url: citation, raw_content: text }], usage: { credits: 1 } });
      }
      if (url.href === TOKEN_FACTORY) {
        return completion({
          reviews: [
            {
              source: "s1",
              comparison: "The citation and object details match the target.",
              relation: "same_artwork",
              evidence: text,
              conflicts: [{ field: "artist", text: "Follower of Pieter Brueghel II." }],
            },
          ],
        });
      }
    });
    tavily({ results: [], images: [], usage: { credits: 1 } });
    await t.action(internal.docent.ensure, { artworkId, deviceId });
    expect((await readArtwork(t, artworkId))?.factSheetNeedsReview).toBe(true);
    expect(bodies(TOKEN_FACTORY).map((body) => body.response_format.json_schema.name)).toEqual(["referenceReview"]);
    expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 1, tavilyCredits: 3 });
  });
});

it("turns an accepted direct reference into grounded narration research with its citation trail", async () => {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const { artworkId } = await t.run((ctx) =>
    seedArtworkWithObject(ctx, {
      artwork: { title: "Carnival and Lent", artist: "Marten van Cleve", wikidataId: "Q1" },
    }),
  );
  const citation = "https://auction.example/lot/1";
  const text =
    "Carnival and Lent by Marten van Cleve. The plump figure represents Carnival and the gaunt woman represents Lent.";
  routes.push((url, init) => {
    if (url.href.startsWith(WIKIDATA)) {
      return jsonResponse({
        entities: {
          Q1: {
            id: "Q1",
            claims: { P170: [{ references: [{ snaks: { P854: [{ datavalue: { value: citation } }] } }] }] },
          },
        },
      });
    }
    if (url.href === "https://api.tavily.com/extract") {
      return jsonResponse({ results: [{ url: citation, raw_content: text }], usage: { credits: 1 } });
    }
    if (url.href !== TOKEN_FACTORY) return undefined;
    const { name } = JSON.parse(String(init?.body)).response_format.json_schema;
    if (name === "referenceReview") {
      return completion({
        reviews: [
          {
            source: "s1",
            comparison: "The citation and object details match the target.",
            relation: "same_artwork",
            evidence: text,
            conflicts: [],
          },
        ],
      });
    }
    if (name === "factSheet") {
      return completion([
        { source: "s1", text: "The plump figure represents Carnival and the gaunt woman represents Lent." },
      ]);
    }
    return completion([
      { sentence: "The plump figure represents Carnival, while the gaunt woman represents Lent.", fact_ids: ["f1"] },
    ]);
  });
  tavily({ results: [], images: [], usage: { credits: 1 } });
  await t.action(internal.docent.ensure, { artworkId, deviceId });
  const artwork = await readArtwork(t, artworkId);
  expect(artwork?.factSheetNeedsReview).toBeUndefined();
  expect(guideResearch(artwork?.factSheet ?? [])).toHaveLength(1);
  expect(artwork?.factSheet?.[0]).toMatchObject({
    sourceUrl: citation,
    referenceUrl: "https://www.wikidata.org/wiki/Q1",
  });
  expect(await readSpend(t)).toEqual({ tokenFactoryCalls: 3, tavilyCredits: 3 });
});

it.each(["other", "same_artwork"])(
  "applies the fact-sheet budget after reviewing long references as %s",
  async (relation) => {
    const t = harness();
    const { deviceId } = await seedDevice(t);
    const { artworkId } = await t.run((ctx) =>
      seedArtworkWithObject(ctx, {
        artwork: { title: "Harbor", artist: "Artist", wikidataId: "Q1" },
      }),
    );
    const article = "The artist painted the harbor outdoors during the summer.";
    const referenceFact = "The painting was first shown in a village exhibition.";
    const references = [0, 1].map((index) => ({
      url: `https://auction.example/${index}`,
      raw_content: `${index}. ${referenceFact} `.repeat(500),
    }));
    routes.push((url, init) => {
      if (url.href.startsWith(WIKIDATA)) {
        return jsonResponse({
          entities: {
            Q1: {
              id: "Q1",
              sitelinks: { enwiki: { title: "Harbor" } },
              claims: {
                P170: [
                  { references: [{ snaks: { P854: references.map(({ url }) => ({ datavalue: { value: url } })) } }] },
                ],
              },
            },
          },
        });
      }
      if (url.hostname === "en.wikipedia.org") return jsonResponse({ query: { pages: [{ extract: article }] } });
      if (url.href === "https://api.tavily.com/extract") {
        return jsonResponse({ results: references, usage: { credits: 2 } });
      }
      if (url.href !== TOKEN_FACTORY) return undefined;
      const body = JSON.parse(String(init?.body));
      const { name } = body.response_format.json_schema;
      const { input } = JSON.parse(body.messages[1].content);
      if (name === "referenceReview") {
        return completion({
          reviews: input.references.map((source: { source: string }) => ({
            source: source.source,
            relation,
            evidence: referenceFact,
            comparison: "Compared the object details.",
            conflicts: [],
          })),
        });
      }
      if (name === "factSheet") {
        return completion([{ source: input.sources[0].id, text: relation === "other" ? article : referenceFact }]);
      }
      return completion([{ sentence: relation === "other" ? article : referenceFact, fact_ids: ["f1"] }]);
    });
    tavily({ results: [], images: [], usage: { credits: 1 } });
    await t.action(internal.docent.ensure, { artworkId, deviceId });
    const sheet = bodies(TOKEN_FACTORY).find((body) => body.response_format.json_schema.name === "factSheet");
    expect(sheet).toBeDefined();
    const sources: { text: string; url: string }[] = JSON.parse(sheet.messages[1].content).input.sources;
    expect(sources.reduce((sum, source) => sum + source.text.length, 0)).toBe(
      relation === "other" ? article.length : 40_000,
    );
    expect(sources.map(({ url }) => url)).toEqual(
      relation === "other" ? ["https://en.wikipedia.org/wiki/Harbor"] : references.map(({ url }) => url),
    );
    expect((await readArtwork(t, artworkId))?.docent?.en).toHaveLength(1);
  },
);

describe("docent for confirmed scan details", () => {
  async function confirmedFixture(options: { verifiedTitle?: string } = {}) {
    const setup = await fixture();
    const user = await seedDevice(setup.t);
    const scanId = await setup.t.run((ctx) =>
      seedScan(ctx, {
        deviceId: user.deviceId,
        venueId: setup.museumId,
        labelFlow: {
          stage: "verified",
          fields: {
            title: labelField(options.verifiedTitle ?? "Wheat Field with Cypresses", "wikidata"),
            artist: labelField("Vincent van Gogh", "wikidata"),
          },
          evidence: ["wikidata"],
          warnings: [],
          moderation: "clear",
          sourceUrl: PAGE,
          wikidataId: "Q18689458",
          updatedAt: Date.now(),
        },
      }),
    );
    const confirm = (source: "label" | "manual", fields: { title: string; artist?: string; date?: string }) =>
      user.as.mutation(api.scans.confirm, { scanId, source, fields });
    const view = () => user.as.query(api.scans.get, { scanId });
    const settle = async () => {
      await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    return { ...setup, user, scanId, confirm, view, settle };
  }

  it("writes private prose for confirmed label details from the label's museum page and Wikidata item", async () => {
    vi.useFakeTimers();
    const { confirm, view, settle, artwork } = await confirmedFixture();
    everything();
    await confirm("label", { title: " Wheat Field with Cypresses ", artist: "Vincent van Gogh", date: "1889" });
    expect(await view()).toMatchObject({
      docentStatus: "writing",
      confirmed: {
        source: "label",
        fields: { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", date: "1889" },
      },
    });
    await settle();
    vi.useRealTimers();
    const shown = await view();
    expect(shown?.docentStatus).toBe("ready");
    expect(shown?.docent).toHaveLength(2);
    expect(shown?.factSheet?.[0]).toEqual({ id: "f1", sourceUrl: PAGE, sourceLabel: "The Metropolitan Museum of Art" });
    expect(calls(PAGE)).toHaveLength(1);
    expect(calls(WIKIDATA).length).toBeGreaterThan(0);
    // The catalogue artwork with the same name is untouched.
    expect(await artwork()).not.toHaveProperty("docentUpdatedAt");
  });

  it("drops the label's museum page and Wikidata item once the work's name was edited", async () => {
    vi.useFakeTimers();
    const { confirm, view, settle } = await confirmedFixture({ verifiedTitle: "Cypresses" });
    everything();
    await confirm("label", { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" });
    await settle();
    vi.useRealTimers();
    expect(calls(PAGE)).toEqual([]);
    expect(calls(WIKIDATA)).toEqual([]);
    expect(bodies(TAVILY)[0].query).toContain('"Wheat Field with Cypresses" Vincent van Gogh');
    expect((await view())?.docentStatus).toBe("ready");
  });

  it("settles as unavailable when research finds nothing to cite, and retry leaves it alone", async () => {
    vi.useFakeTimers();
    const { user, scanId, confirm, view, settle } = await confirmedFixture();
    tavily({ results: [], usage: { credits: 1 } });
    models();
    await confirm("manual", { title: "Ellington, East Yorkshire", artist: "Benjamin Haughton" });
    await settle();
    expect((await view())?.docentStatus).toBe("unavailable");
    const searches = calls(TAVILY).length;
    await user.as.mutation(api.docent.retry, { scanId });
    await settle();
    vi.useRealTimers();
    expect(calls(TAVILY)).toHaveLength(searches);
    expect(calls(TOKEN_FACTORY)).toEqual([]);
  });

  it("retries research after a temporary source failure", async () => {
    vi.useFakeTimers();
    const { user, scanId, confirm, view, settle } = await confirmedFixture();
    tavily({}, 503);
    await confirm("manual", { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" });
    await settle();
    expect((await view())?.docentStatus).toBe("failed");
    const searches = calls(TAVILY).length;
    routes = [];
    everything();
    await user.as.mutation(api.docent.retry, { scanId });
    expect((await view())?.docentStatus).toBe("writing");
    await settle();
    vi.useRealTimers();
    expect(calls(TAVILY).length).toBeGreaterThan(searches);
    expect((await view())?.docentStatus).toBe("ready");
  });

  it("keeps a run whose prose was rejected retryable", async () => {
    vi.useFakeTimers();
    const { user, scanId, confirm, view, settle } = await confirmedFixture();
    page(PAGE, ownerPage);
    wikidata();
    tavily();
    models(facts, [{ sentence: "This sentence cites an unknown fact.", fact_ids: ["missing"] }]);
    await confirm("label", { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" });
    await settle();
    expect((await view())?.docentStatus).toBe("failed");
    routes = [];
    everything();
    await user.as.mutation(api.docent.retry, { scanId });
    expect((await view())?.docentStatus).toBe("writing");
    await settle();
    vi.useRealTimers();
    expect((await view())?.docentStatus).toBe("ready");
    // The retry reuses the cached fact sheet and only rewrites the sentences.
    expect(bodies(TOKEN_FACTORY).at(-1)?.model).toBe(DOCENT_MODEL);
  });

  it("skips research for details without an artist and keeps prose when the same details are confirmed again", async () => {
    vi.useFakeTimers();
    const { t, scanId, confirm, view, settle } = await confirmedFixture();
    everything();
    await confirm("manual", { title: "Harbour at dusk" });
    await settle();
    expect((await view())?.docentStatus).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    await confirm("label", { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" });
    await settle();
    const generation = (await t.run((ctx) => ctx.db.get("scans", scanId)))?.confirmed?.generation;
    await confirm("label", { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" });
    await settle();
    vi.useRealTimers();
    expect((await t.run((ctx) => ctx.db.get("scans", scanId)))?.confirmed?.generation).toBe(generation);
    expect((await view())?.docent).toHaveLength(2);
  });

  it("ignores a run's late write once newer details were confirmed", async () => {
    const { t, scanId, confirm } = await confirmedFixture();
    await confirm("manual", { title: "First", artist: "Someone" });
    const context = await t.mutation(internal.docent.claimScan, { scanId, generation: 1 });
    expect(context?.target).toEqual({ title: "First", artist: "Someone" });
    await confirm("manual", { title: "Second", artist: "Someone" });
    expect(
      await t.mutation(internal.docent.writeScan, {
        scanId,
        generation: 1,
        docentEn: [{ sentence: "A stale sentence about the first work.", factIds: ["f1"] }],
      }),
    ).toBe(false);
    expect((await t.run((ctx) => ctx.db.get("scans", scanId)))?.confirmed).toMatchObject({
      generation: 2,
      fields: { title: "Second" },
    });
  });

  it.each(["unsupported_version", "failed"] as const)("confirms details after recognition is %s", async (status) => {
    const { t, scanId, confirm, view } = await confirmedFixture();
    await t.run((ctx) => ctx.db.patch("scans", scanId, { status }));
    await confirm("label", { title: "A work read from the label" });
    expect(await view()).toMatchObject({
      status,
      confirmed: { source: "label", fields: { title: "A work read from the label" } },
      docentStatus: "unavailable",
    });
    await confirm("manual", { title: "My corrected title" });
    expect(await view()).toMatchObject({
      confirmed: { source: "manual", fields: { title: "My corrected title" } },
    });
  });

  it("rejects another device, an unverified label, a blank title, and a scan still identifying", async () => {
    const { t, user, scanId, confirm } = await confirmedFixture();
    const other = await seedDevice(t);
    await expect(
      other.as.mutation(api.scans.confirm, { scanId, source: "manual", fields: { title: "Mine" } }),
    ).rejects.toMatchObject({ data: { code: "invalid_scan" } });
    await expect(confirm("manual", { title: "   " })).rejects.toMatchObject({ data: { code: "invalid_fields" } });
    const unread = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId }));
    await expect(
      user.as.mutation(api.scans.confirm, { scanId: unread, source: "label", fields: { title: "Read" } }),
    ).rejects.toMatchObject({ data: { code: "label_not_verified" } });
    const pending = await t.run((ctx) => seedScan(ctx, { deviceId: user.deviceId, status: "pending" }));
    await expect(
      user.as.mutation(api.scans.confirm, { scanId: pending, source: "manual", fields: { title: "Too soon" } }),
    ).rejects.toMatchObject({ data: { code: "invalid_scan" } });
  });
});

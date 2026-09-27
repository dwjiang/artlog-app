import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  completion,
  graphPage,
  jsonLdPage,
  jsonResponse,
  labelReading,
  metaPage,
  plainPage,
  tavilyMonet,
  wikidataEntitiesResponse,
  wikidataSearchMonet,
  wikidataSearchWaterLilies,
} from "./lib/labelFixtures";
import { readSpend, seedEmbedding, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import type { WikidataEntity } from "./lib/wikidata";
import { harness, signIn, type Harness } from "./test.helpers";

const TOKEN_FACTORY = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY = "https://api.tavily.com/search";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const LABEL_MODEL = "label-model";
const LINES = [
  { text: "Claude Monet", confidence: 1 },
  { text: "French, 1840–1926", confidence: 1 },
  { text: "Water Lilies, 1919", confidence: 1 },
  { text: "Oil on canvas", confidence: 1 },
  { text: "Gift of Louise Reinhardt Smith, 1983", confidence: 0.5 },
  { text: "1998.325.2", confidence: 1 },
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
    if (url.href === TOKEN_FACTORY && JSON.parse(String(init?.body)).model === "nvidia/Nemotron-3_5-Lightning") {
      return completion({ flagged: false });
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  vi.stubEnv("LABEL_MODEL", LABEL_MODEL);
  vi.stubEnv("MODERATION_MODEL", "nvidia/Nemotron-3_5-Lightning");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function wikidata(searches: Record<string, unknown> = {}, status = 200) {
  routes.push((url) => {
    if (`${url.origin}${url.pathname}` !== WIKIDATA) return undefined;
    if (status !== 200) return new Response("down", { status });
    const action = url.searchParams.get("action");
    if (action === "wbsearchentities") {
      return jsonResponse(searches[url.searchParams.get("search") ?? ""] ?? { search: [] });
    }
    return jsonResponse(wikidataEntitiesResponse((url.searchParams.get("ids") ?? "").split("|")));
  });
}
function tokenFactory(handler: (body: { model: string; messages: { content: unknown }[] }) => Response) {
  routes.push((url, init) => (url.href === TOKEN_FACTORY ? handler(JSON.parse(String(init?.body))) : undefined));
}
function models(reading: object = labelReading, flagged = false) {
  tokenFactory((body) => (body.model === LABEL_MODEL ? completion(reading) : completion({ flagged })));
}
function tavily(response: unknown) {
  routes.push((url) => (url.href === TAVILY ? jsonResponse(response) : undefined));
  page("https://www.metmuseum.org/art/collection/search/437137", jsonLdPage);
}
function page(href: string, html: string, init?: ResponseInit) {
  routes.push((url) => (url.href === href ? new Response(html, init) : undefined));
}
const calls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));

type MuseumOverrides = Partial<Omit<Doc<"museums">, "_id" | "_creationTime">>;
const MET: MuseumOverrides = {
  website: "https://www.metmuseum.org/",
  wikidataId: "Q160236",
};

async function seedScan(t: Harness, deviceId: Id<"devices">, venueId?: Id<"museums">) {
  const now = Date.now();
  return t.run(async (ctx) =>
    ctx.db.insert("scans", {
      deviceId,
      localId: crypto.randomUUID(),
      generation: 0,
      venueId,
      modelVersion: model.modelVersion,
      embeddingId: await seedEmbedding(ctx, { vector: testVector() }),
      capturedAt: now,
      status: "identified",
      outcome: "miss",
      updatedAt: now,
    }),
  );
}

async function fixture(venue: MuseumOverrides | null = MET) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = venue ? await t.run((ctx) => seedMuseum(ctx, venue)) : undefined;
  const scanId = await seedScan(t, user.deviceId, venueId);
  const stored = async () => (await t.run((ctx) => ctx.db.get("scans", scanId)))?.labelFlow;
  const spend = () => readSpend(t);
  return { t, user, venueId, scanId, stored, spend };
}

describe("scan restarts during label requests", () => {
  it.each([
    { action: "fetchQr", tokenFactoryCalls: undefined },
    { action: "readLabel", tokenFactoryCalls: 2 },
    { action: "verifyLabel", tokenFactoryCalls: 1 },
  ] as const)(
    "rejects an obsolete $action result without changing the restarted scan",
    async ({ action, tokenFactoryCalls }) => {
      const { t, user, scanId, stored, spend } = await fixture();
      const original = (await t.run((ctx) => ctx.db.get("scans", scanId)))!;
      await t.run((ctx) => ctx.db.patch("scans", scanId, { status: "failed" }));
      let beginFetch!: () => void;
      let resumeFetch!: () => void;
      const started = new Promise<void>((resolve) => {
        beginFetch = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resumeFetch = resolve;
      });
      fetchMock.mockImplementationOnce(async () => {
        beginFetch();
        await resumed;
        return action === "fetchQr"
          ? new Response(jsonLdPage)
          : action === "readLabel"
            ? completion(labelReading)
            : jsonResponse({ search: [] });
      });
      models();
      wikidata();
      tavily({ results: [], usage: { credits: 1 } });
      const pending =
        action === "fetchQr"
          ? user.as.action(api.label.fetchQr, {
              scanId,
              url: "https://www.metmuseum.org/art/1",
            })
          : action === "readLabel"
            ? user.as.action(api.label.readLabel, { scanId, lines: LINES })
            : user.as.action(api.label.verifyLabel, {
                scanId,
                fields: { title: "Water Lilies", artist: "Claude Monet" },
              });
      await started;
      const restarted = await t.action(internal.scans.create, {
        deviceId: user.deviceId,
        localId: original.localId,
        modelVersion: model.modelVersion,
        vector: testVector(),
        capturedAt: original.capturedAt,
        venueId: original.venueId,
        visitId: original.visitId,
      });
      expect(restarted.scan).toMatchObject({ _id: scanId, generation: 1 });
      resumeFetch();
      await expect(pending).rejects.toMatchObject({
        data: { code: "scan_restarted" },
      });
      expect(await stored()).toBeUndefined();
      expect((await spend())?.tokenFactoryCalls).toBe(tokenFactoryCalls);
    },
  );
});

describe("fetchQr", () => {
  it("fetches a page on the venue host and locks the fields it declares as qr evidence", async () => {
    const { user, scanId, stored } = await fixture();
    page("https://www.metmuseum.org/art/collection/search/437137", jsonLdPage);
    const result = await user.as.action(api.label.fetchQr, {
      scanId,
      url: "https://www.metmuseum.org/art/collection/search/437137",
    });
    expect(result).toMatchObject({
      stage: "qr",
      evidence: ["qr"],
      warnings: [],
      moderation: "unchecked",
      sourceUrl: "https://www.metmuseum.org/art/collection/search/437137",
      fields: {
        title: { value: "Water Lilies", evidence: "qr", locked: true },
        artist: { value: "Claude Monet", evidence: "qr", locked: true },
        date: { value: "1919", evidence: "qr", locked: true },
        accession: { value: "1998.325.2", evidence: "qr", locked: true },
        medium: { value: "Oil on canvas", evidence: "qr", locked: true },
        creditLine: {
          value: "Gift of Louise Reinhardt Smith, 1983",
          evidence: "qr",
          locked: true,
        },
      },
    });
    expect(await stored()).toEqual(result);
  });

  it.each([
    ["https://evil.example/art/1", MET],
    ["http://www.metmuseum.org/art/1", MET],
    ["https://metmuseum.org.evil.test/art/1", MET],
    ["https://www.metmuseum.org/art/1", null],
  ])("refuses to fetch %s", async (url, venue) => {
    const { user, scanId } = await fixture(venue);
    await expect(user.as.action(api.label.fetchQr, { scanId, url })).rejects.toMatchObject({
      data: { code: "qr_host_not_allowed" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at a redirect that leaves the venue host and writes nothing", async () => {
    const { user, scanId, stored } = await fixture();
    page("https://www.metmuseum.org/q/1", "", {
      status: 302,
      headers: { location: "https://evil.example/" },
    });
    await expect(
      user.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.metmuseum.org/q/1",
      }),
    ).rejects.toMatchObject({
      data: { code: "page_unavailable", reason: "redirect_off_host" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await stored()).toBeUndefined();
  });

  it("falls back to og:title and meta author, and reports pages without an artwork", async () => {
    const { user, scanId } = await fixture({
      website: "https://www.artic.edu/",
    });
    page("https://www.artic.edu/artworks/111628/nighthawks", metaPage);
    page("https://www.artic.edu/visit", plainPage);
    await expect(
      user.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.artic.edu/artworks/111628/nighthawks",
      }),
    ).resolves.toMatchObject({
      fields: {
        title: { value: "Nighthawks", evidence: "qr" },
        artist: { value: "Edward Hopper" },
        accession: { value: "1942.51" },
      },
    });
    await expect(
      user.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.artic.edu/visit",
      }),
    ).rejects.toMatchObject({ data: { code: "qr_no_artwork" } });
  });

  it("requires the feature flag, a device, and the caller to own the scan", async () => {
    const { t, user, scanId } = await fixture();
    vi.stubEnv("FLAG_LABEL_FLOW", "off");
    await expect(
      user.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.metmuseum.org/x",
      }),
    ).rejects.toMatchObject({ data: { code: "feature_off" } });
    vi.stubEnv("FLAG_LABEL_FLOW", "on");
    const other = await seedDevice(t);
    await expect(
      other.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.metmuseum.org/x",
      }),
    ).rejects.toMatchObject({ data: { code: "scan_not_found" } });
    const unregistered = await signIn(t);
    await expect(
      unregistered.as.action(api.label.fetchQr, {
        scanId,
        url: "https://www.metmuseum.org/x",
      }),
    ).rejects.toMatchObject({ data: { code: "device_not_registered" } });
    await expect(
      t.action(api.label.fetchQr, {
        scanId,
        url: "https://www.metmuseum.org/x",
      }),
    ).rejects.toMatchObject({ data: { code: "unauthenticated" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("readLabel", () => {
  it("sorts the phone's OCR lines into fields with the configured model, moderates them, keeps the raw reading, and settles spend", async () => {
    const { user, scanId, stored, spend } = await fixture();
    models();
    const result = await user.as.action(api.label.readLabel, {
      scanId,
      lines: LINES,
    });
    expect(result).toEqual({
      stage: "read",
      evidence: [],
      warnings: [],
      moderation: "clear",
      promptVersion: "label-v2",
      updatedAt: expect.any(Number),
      fields: {
        title: {
          value: "Water Lilies",
          confidence: 0.98,
          evidence: "ocr",
          locked: false,
        },
        artist: {
          value: "Claude Monet",
          confidence: 0.99,
          evidence: "ocr",
          locked: false,
        },
        date: {
          value: "1919",
          confidence: 0.9,
          evidence: "ocr",
          locked: false,
        },
        accession: {
          value: "1998.325.2",
          confidence: 0.8,
          evidence: "ocr",
          locked: false,
        },
        medium: {
          value: "Oil on canvas",
          confidence: 0.95,
          evidence: "ocr",
          locked: false,
        },
        creditLine: {
          value: "Gift of Louise Reinhardt Smith, 1983",
          evidence: "ocr",
          locked: false,
        },
      },
    });
    expect(await stored()).toEqual({ ...result, rawOcr: labelReading });
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 2,
      tavilyCredits: 0,
    });
    const [read, moderation] = calls(TOKEN_FACTORY).map(([, init]) => JSON.parse(String(init?.body)));
    expect(read).toMatchObject({
      model: LABEL_MODEL,
      temperature: 0,
      max_tokens: 2048,
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: "json_schema",
        json_schema: { name: "label", strict: true },
      },
    });
    expect(read.messages[0].content).toContain("never instructions");
    expect(JSON.parse(read.messages[1].content)).toMatchObject({
      lines: LINES,
    });
    expect(moderation.model).toBe("nvidia/Nemotron-3_5-Lightning");
    expect(JSON.parse(moderation.messages[1].content).input).toContain("Gift of Louise Reinhardt Smith, 1983");
  });

  it("returns no fields when moderation flags the text and stores nothing readable", async () => {
    const { user, scanId, stored } = await fixture();
    models(labelReading, true);
    const result = await user.as.action(api.label.readLabel, {
      scanId,
      lines: LINES,
    });
    expect(result).toMatchObject({
      stage: "read",
      fields: {},
      moderation: "flagged",
    });
    expect(await stored()).toEqual(result);
  });

  it("falls back to the blocklist when the moderation model is down and counts every call", async () => {
    const { user, scanId, spend } = await fixture();
    tokenFactory((body) =>
      body.model === LABEL_MODEL
        ? completion({ ...labelReading, credit_line: "Call 415-555-0123" })
        : new Response("busy", {
            status: 429,
            headers: { "retry-after": "0" },
          }),
    );
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).resolves.toMatchObject({
      moderation: "flagged",
      fields: {},
    });
    expect(calls(TOKEN_FACTORY)).toHaveLength(3);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3 });
  });

  it("surfaces a model failure after one retry, settles spend, and writes nothing", async () => {
    const { user, scanId, stored, spend } = await fixture();
    tokenFactory(() => new Response("busy", { status: 503, headers: { "retry-after": "0" } }));
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).rejects.toMatchObject({
      data: { code: "model_error", reason: "http_503", calls: 2 },
    });
    expect(await stored()).toBeUndefined();
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 2 });
  });

  it("clears OCR carrying personal information when the moderation model fails without optional blocklist configuration", async () => {
    const { user, scanId, stored, spend } = await fixture();
    vi.stubEnv("MODERATION_BLOCKLIST", "");
    tokenFactory((body) =>
      body.model === LABEL_MODEL
        ? completion({ ...labelReading, title: "Call me at 415-555-0123" })
        : new Response("down", {
            status: 503,
            headers: { "retry-after": "0" },
          }),
    );
    const result = await user.as.action(api.label.readLabel, {
      scanId,
      lines: LINES,
    });
    expect(result).toMatchObject({ fields: {}, moderation: "flagged" });
    expect(await stored()).toEqual(result);
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3 });
  });

  it("enforces the flag, the line bounds, the model configuration, and the daily cap before any call", async () => {
    const { user, scanId, spend } = await fixture();
    vi.stubEnv("FLAG_LABEL_FLOW", "off");
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).rejects.toMatchObject({
      data: { code: "feature_off" },
    });
    vi.stubEnv("FLAG_LABEL_FLOW", "on");
    const line = { text: "x", confidence: 1 };
    await expect(
      user.as.action(api.label.readLabel, {
        scanId,
        lines: Array.from({ length: 81 }, () => line),
      }),
    ).rejects.toMatchObject({ data: { code: "bad_lines" } });
    await expect(
      user.as.action(api.label.readLabel, {
        scanId,
        lines: [{ text: "x".repeat(301), confidence: 1 }],
      }),
    ).rejects.toMatchObject({ data: { code: "bad_lines" } });
    await expect(
      user.as.action(api.label.readLabel, {
        scanId,
        lines: [{ text: "x", confidence: 1.5 }],
      }),
    ).rejects.toMatchObject({ data: { code: "bad_lines" } });
    await expect(
      user.as.action(api.label.readLabel, {
        scanId,
        lines: [{ text: "  ", confidence: 1 }],
      }),
    ).rejects.toMatchObject({ data: { code: "nothing_read" } });
    await expect(user.as.action(api.label.readLabel, { scanId, lines: [] })).rejects.toMatchObject({
      data: { code: "nothing_read" },
    });
    vi.stubEnv("LABEL_MODEL", "");
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).rejects.toMatchObject({
      data: { code: "model_unconfigured" },
    });
    vi.stubEnv("LABEL_MODEL", LABEL_MODEL);
    vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "3");
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).rejects.toMatchObject({
      data: { code: "spend_cap", kind: "tokenFactory" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
  });

  it("limits a device to thirty reads per hour", async () => {
    const { user, scanId } = await fixture();
    models();
    for (let i = 0; i < 30; i++) {
      await user.as.action(api.label.readLabel, { scanId, lines: LINES });
    }
    await expect(user.as.action(api.label.readLabel, { scanId, lines: LINES })).rejects.toMatchObject({
      data: { code: "rate_limited", name: "labelRead" },
    });
    expect(calls(TOKEN_FACTORY)).toHaveLength(60);
  });
});

describe("verifyLabel", () => {
  it.each([
    ["Water Lilies at Giverny", "Study for Water Lilies at Giverny", false],
    ["Study for Water Lilies at Giverny", "Water Lilies at Giverny", false],
    ["Study for Water Lilies at Giverny", "Study for Water Lilies at Giverny", true],
  ] as const)('verifies "%s" against Wikidata title "%s": %s', async (title, candidateTitle, matches) => {
    const { user, scanId } = await fixture(null);
    routes.push((url) => {
      if (url.origin + url.pathname !== WIKIDATA || url.searchParams.get("action") !== "wbgetentities") {
        return undefined;
      }
      const response = structuredClone(wikidataEntitiesResponse((url.searchParams.get("ids") ?? "").split("|")));
      const painting = response.entities.Q7973309 as WikidataEntity | undefined;
      if (painting) painting.labels = { en: { value: candidateTitle } };
      return jsonResponse(response);
    });
    wikidata({
      [title]: { search: [{ id: "Q7973309" }] },
      "Claude Monet": wikidataSearchMonet,
    });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title, artist: "Claude Monet" },
    });
    expect(result.wikidataId).toBe(matches ? "Q7973309" : undefined);
    expect(result.fields.title?.locked).toBe(matches);
    expect(result.fields.artist?.locked).toBe(matches);
  });

  it("does not downgrade an artist when Wikidata returns an HTTP 200 API error", async () => {
    const { user, scanId } = await fixture(null);
    routes.push((url) =>
      url.origin + url.pathname === WIKIDATA
        ? jsonResponse({
            error: { code: "ratelimited", info: "Rate limit exceeded" },
          })
        : undefined,
    );
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(result.warnings).toEqual([]);
    expect(result.fields.artist).toMatchObject({
      evidence: "ocr",
      locked: false,
    });
  });

  const cleveland: MuseumOverrides = {
    website: "https://www.clevelandart.org/",
    accessionUrlPattern: "https://www.clevelandart.org/art/{accession}",
  };
  const thinker = {
    title: "The Thinker",
    artist: "Auguste Rodin",
    accession: "1917.42",
  };

  it("does not lock an accession or fill blanks from a redirect to another cast", async () => {
    const { user, scanId, stored } = await fixture(cleveland);
    page("https://www.clevelandart.org/art/1917.42", "", {
      status: 302,
      headers: { location: "/art/1979.138" },
    });
    page("https://www.clevelandart.org/art/1979.138", graphPage.replaceAll("1917.42", "1979.138"));
    wikidata();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: thinker,
    });
    expect(result.fields.accession).toMatchObject({
      value: "1917.42",
      evidence: "ocr",
      locked: false,
    });
    expect(result.fields.title).toMatchObject({
      evidence: "ocr",
      locked: false,
    });
    expect(result.fields.medium).toBeUndefined();
    expect(result.sourceUrl).toBeUndefined();
    expect(await stored()).toEqual(result);
  });

  it("locks title, artist and accession from the museum accession page and fills the blanks from it", async () => {
    const { user, scanId, stored, spend } = await fixture(cleveland);
    page("https://www.clevelandart.org/art/1917.42", graphPage);
    wikidata();
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: thinker,
    });
    expect(result).toMatchObject({
      stage: "verified",
      evidence: ["accession"],
      warnings: ["artist_not_found"],
      sourceUrl: "https://www.clevelandart.org/art/1917.42",
      fields: {
        title: { value: "The Thinker", evidence: "accession", locked: true },
        artist: { value: "Auguste Rodin", evidence: "accession", locked: true },
        accession: { value: "1917.42", evidence: "accession", locked: true },
        date: {
          value: "1880–81, cast 1916",
          evidence: "accession",
          locked: true,
        },
        medium: { value: "bronze", evidence: "accession", locked: true },
      },
    });
    expect(result.wikidataId).toBeUndefined();
    expect(await stored()).toEqual(result);
    expect(calls(TAVILY)).toHaveLength(0);
    expect(await spend()).toMatchObject({
      tavilyCredits: 0,
      tokenFactoryCalls: 1,
    });
  });

  it.each([
    "https://127.0.0.1/art/{accession}",
    "http://www.clevelandart.org/art/{accession}",
    "https://evil.example/{accession}",
  ])("never fetches accession pattern %s outside the venue", async (accessionUrlPattern) => {
    const { user, scanId } = await fixture({
      website: "https://www.clevelandart.org/",
      accessionUrlPattern,
    });
    wikidata();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: thinker,
    });
    expect(result.fields.accession).toMatchObject({
      evidence: "ocr",
      locked: false,
    });
    const fetched = fetchMock.mock.calls.map(([url]) => new URL(String(url)).host);
    expect(
      fetched.every((host) => ["www.wikidata.org", "api.tavily.com", "api.tokenfactory.nebius.com"].includes(host)),
    ).toBe(true);
  });

  it("verifies the title and artist pair on Wikidata, records the painting, and skips the web search", async () => {
    const { user, scanId, spend } = await fixture();
    wikidata({ "Water Lilies": wikidataSearchWaterLilies });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet", date: "1919" },
    });
    expect(result).toMatchObject({
      evidence: ["wikidata"],
      warnings: [],
      wikidataId: "Q7973309",
      fields: {
        title: { value: "Water Lilies", evidence: "wikidata", locked: true },
        artist: { value: "Claude Monet", evidence: "wikidata", locked: true },
        date: { value: "1919", evidence: "ocr", locked: false },
      },
    });
    expect(calls(TAVILY)).toHaveLength(0);
    expect(await spend()).toMatchObject({
      tavilyCredits: 0,
      tokenFactoryCalls: 1,
    });
  });

  it.each(["qr", "accession"] as const)(
    "keeps %s identity without attaching another same-title painting on Wikidata",
    async (evidence) => {
      const sourceUrl = "https://www.metmuseum.org/art/collection/search/437137";
      const { user, scanId, stored } = await fixture({
        ...MET,
        ...(evidence === "accession" ? { accessionUrlPattern: sourceUrl + "?accession={accession}" } : {}),
      });
      const fields = {
        title: "Water Lilies",
        artist: "Claude Monet",
        accession: "1983.532",
        date: "1916–19",
      };
      const html = jsonLdPage.replaceAll("1998.325.2", fields.accession).replaceAll("1919", fields.date);
      page(evidence === "qr" ? sourceUrl : sourceUrl + "?accession=1983.532", html);
      wikidata({
        "Water Lilies": wikidataSearchWaterLilies,
        "Claude Monet": wikidataSearchMonet,
      });
      const first =
        evidence === "qr"
          ? await user.as.action(api.label.fetchQr, { scanId, url: sourceUrl })
          : await user.as.action(api.label.verifyLabel, {
              scanId,
              fields: { title: fields.title, artist: fields.artist },
            });
      expect(first.wikidataId).toBe(evidence === "qr" ? undefined : "Q7973309");
      const result = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields,
      });
      expect(result.fields).toMatchObject({
        title: { value: fields.title, evidence, locked: true },
        artist: { value: fields.artist, evidence, locked: true },
        accession: { value: fields.accession, evidence, locked: true },
      });
      expect(result.wikidataId).toBeUndefined();
      expect((await stored())?.wikidataId).toBeUndefined();
      const edited = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { ...fields, date: "1950" },
      });
      expect(edited.wikidataId).toBeUndefined();
      expect(edited.fields.date).toMatchObject({
        evidence: "weak",
        locked: false,
      });
      expect(edited.warnings).toContain("date_outside_lifespan");
      expect(calls(TAVILY)).toHaveLength(0);
    },
  );

  it("downgrades a date outside the artist lifespan and flags a venue with no collection in that country", async () => {
    const { user, scanId } = await fixture({
      website: "https://www.metmuseum.org/",
      wikidataId: "Q1234567",
    });
    wikidata({ "Water Lilies": wikidataSearchWaterLilies });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet", date: "1950" },
    });
    expect(result.warnings).toEqual(["date_outside_lifespan", "venue_unlikely"]);
    expect(result.fields.date).toMatchObject({
      evidence: "weak",
      locked: false,
    });
    expect(result.fields.artist).toMatchObject({
      evidence: "wikidata",
      locked: true,
    });
  });

  it.each(["missing", "unrelated"])(
    "keeps a painting creator weak with %s artist-occupation claims",
    async (occupation) => {
      const { user, scanId } = await fixture();
      routes.push((url) => {
        if (url.origin + url.pathname !== WIKIDATA || url.searchParams.get("action") !== "wbgetentities") {
          return undefined;
        }
        const response = structuredClone(wikidataEntitiesResponse((url.searchParams.get("ids") ?? "").split("|")));
        const artist = response.entities.Q296 as WikidataEntity | undefined;
        if (artist?.claims) {
          if (occupation === "missing") {
            delete artist.claims.P106;
          } else {
            artist.claims.P106 = [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }];
          }
        }
        return jsonResponse(response);
      });
      wikidata({
        "Water Lilies": wikidataSearchWaterLilies,
        "Claude Monet": wikidataSearchMonet,
      });
      tavily({ results: [], usage: { credits: 1 } });
      const result = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { title: "Water Lilies", artist: "Claude Monet" },
      });
      expect(result.fields.artist).toMatchObject({
        evidence: "weak",
        locked: false,
      });
      expect(result.warnings).toContain("artist_not_found");
      expect(result.wikidataId).toBeUndefined();
    },
  );

  it("does not lock the requested artist using a page that names another person with the same surname", async () => {
    const { user, scanId } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily({
      results: [
        {
          ...tavilyMonet.results[0],
          title: "Camille Monet - Water Lilies",
          content: "Water Lilies by Camille Monet",
        },
      ],
    });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(result.fields.artist).toMatchObject({
      value: "Claude Monet",
      evidence: "ocr",
      locked: false,
    });
    expect(result.evidence).toEqual([]);
  });

  it("marks an artist Wikidata does not know as weak", async () => {
    const { user, scanId } = await fixture();
    wikidata();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Untitled", artist: "Nobody Fakename" },
    });
    expect(result.warnings).toEqual(["artist_not_found"]);
    expect(result.fields.artist).toMatchObject({
      evidence: "weak",
      locked: false,
    });
    expect(result.fields.title).toMatchObject({
      evidence: "ocr",
      locked: false,
    });
  });

  it("falls back to a museum-scoped web search, reserves one credit, and returns the object images", async () => {
    const { user, scanId, spend } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(result).toMatchObject({
      evidence: ["tavily"],
      warnings: [],
      sourceUrl: "https://www.metmuseum.org/art/collection/search/437137",
      fields: {
        title: { evidence: "tavily", locked: true },
        artist: { evidence: "tavily", locked: true },
      },
    });
    expect(result.imageUrls).toEqual([
      "https://collectionapi.metmuseum.org/api/collection/v1/iiif/437137/2018391/main-image",
    ]);
    expect(JSON.parse(String(calls(TAVILY)[0][1]?.body))).toMatchObject({
      query: '"Water Lilies" Claude Monet',
      include_domains: ["metmuseum.org"],
      include_images: true,
      max_results: 5,
    });
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("finds evidence on a collection host separate from the museum website", async () => {
    const { user, scanId, spend } = await fixture({
      website: "https://www.museum.example/",
      collectionSiteUrl: "https://collection.example/",
    });
    wikidata({ "Claude Monet": wikidataSearchMonet });
    const sourceUrl = "https://collection.example/objects/1";
    routes.push((url, init) => {
      if (url.href !== TAVILY) return undefined;
      const body = JSON.parse(String(init?.body));
      const results = body.include_domains.includes("collection.example")
        ? [{ ...tavilyMonet.results[0], url: sourceUrl }]
        : [];
      return jsonResponse({ results, usage: { credits: 1 } });
    });
    page(sourceUrl, jsonLdPage);
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(result).toMatchObject({
      sourceUrl,
      fields: {
        title: { evidence: "tavily", locked: true },
        artist: { evidence: "tavily", locked: true },
      },
    });
    expect(JSON.parse(String(calls(TAVILY)[0][1]?.body))).toMatchObject({
      include_domains: ["museum.example", "collection.example"],
      include_domains_mode: "filter",
    });
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("upgrades to tavily+image only after the phone confirms the embedding and the homography, without a second search", async () => {
    const { user, scanId, spend } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    const fields = { title: "Water Lilies", artist: "Claude Monet" };
    const first = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    const url = first.imageUrls![0];
    const before = fetchMock.mock.calls.length;
    for (const imageCheck of [
      { url, cosine: 0.5, homographyValid: true },
      { url, cosine: 0.9, homographyValid: false },
    ]) {
      await expect(user.as.action(api.label.verifyLabel, { scanId, fields, imageCheck })).resolves.toMatchObject({
        evidence: ["tavily"],
        fields: {
          title: { evidence: "tavily" },
          artist: { evidence: "tavily" },
        },
      });
    }
    const upgraded = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
      imageCheck: { url, cosine: 0.9, homographyValid: true },
    });
    expect(upgraded).toMatchObject({
      evidence: ["tavily+image"],
      fields: {
        title: { evidence: "tavily+image", locked: true },
        artist: { evidence: "tavily+image", locked: true },
      },
    });
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it.each([NaN, Infinity, -Infinity, 1.01, -1.01])("does not certify an invalid cosine %s", async (cosine) => {
    const { user, scanId, stored, spend } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    const fields = { title: "Water Lilies", artist: "Claude Monet" };
    const first = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
      imageCheck: { url: first.imageUrls![0], cosine, homographyValid: true },
    });
    expect(result).toEqual(first);
    expect(await stored()).toEqual(first);
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it.each(["tavily", "tavily+image"] as const)(
    "keeps %s evidence and its source when only the date changes",
    async (evidence) => {
      const { user, scanId, stored, spend } = await fixture();
      wikidata({ "Claude Monet": wikidataSearchMonet });
      tavily(tavilyMonet);
      const fields = { title: "Water Lilies", artist: "Claude Monet" };
      let first = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields,
      });
      if (evidence === "tavily+image") {
        first = await user.as.action(api.label.verifyLabel, {
          scanId,
          fields,
          imageCheck: {
            url: first.imageUrls![0],
            cosine: 0.9,
            homographyValid: true,
          },
        });
      }
      vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
      const result = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { ...fields, date: "1919" },
      });
      expect(result.fields.title).toEqual(first.fields.title);
      expect(result.fields.artist).toEqual(first.fields.artist);
      expect(result.sourceUrl).toBe(first.sourceUrl);
      expect(result.imageUrls).toEqual(first.imageUrls);
      expect(result.fields.date).toMatchObject({
        value: "1919",
        evidence: "ocr",
      });
      expect(await stored()).toEqual(result);
      expect(await spend()).toMatchObject({ tavilyCredits: 1 });
    },
  );

  it("keeps the verified Wikidata identity when another field changes during an outage", async () => {
    const { user, scanId } = await fixture();
    wikidata({ "Water Lilies": wikidataSearchWaterLilies });
    const fields = { title: "Water Lilies", artist: "Claude Monet" };
    const first = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    routes = [];
    wikidata({}, 503);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { ...fields, medium: "Oil on canvas" },
    });
    expect(result.fields.title).toEqual(first.fields.title);
    expect(result.fields.artist).toEqual(first.fields.artist);
    expect(result.wikidataId).toBe(first.wikidataId);
  });

  it.each([{ title: "Haystacks" }, { artist: "Camille Pissarro" }, { accession: "1983.532" }])(
    "invalidates old museum image evidence when an identity field changes: %j",
    async (edit) => {
      const { user, scanId } = await fixture();
      wikidata({ "Claude Monet": wikidataSearchMonet });
      tavily(tavilyMonet);
      const fields = {
        title: "Water Lilies",
        artist: "Claude Monet",
        accession: "1998.325.2",
      };
      const first = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields,
      });
      await user.as.action(api.label.verifyLabel, {
        scanId,
        fields,
        imageCheck: {
          url: first.imageUrls![0],
          cosine: 0.9,
          homographyValid: true,
        },
      });
      vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
      const result = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { ...fields, ...edit },
      });
      expect(result.fields.title?.locked).toBe(false);
      expect(result.fields.artist?.locked).toBe(false);
      expect(result.sourceUrl).toBeUndefined();
      expect(result.imageUrls).toBeUndefined();
    },
  );

  it("skips the web search when the daily Tavily cap is reached and when the search fails, keeping the reservation", async () => {
    const { user, scanId, spend } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
    const capped = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(capped.fields.title).toMatchObject({
      evidence: "ocr",
      locked: false,
    });
    expect(calls(TAVILY)).toHaveLength(0);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "20");
    routes.push((url) => (url.href === TAVILY ? new Response("down", { status: 500 }) : undefined));
    const failed = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet" },
    });
    expect(failed.fields.title).toMatchObject({ evidence: "ocr" });
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("keeps qr evidence for unchanged values and does not downgrade the museum on a Wikidata miss", async () => {
    const { user, scanId } = await fixture();
    page("https://www.metmuseum.org/art/collection/search/437137", jsonLdPage);
    wikidata();
    await user.as.action(api.label.fetchQr, {
      scanId,
      url: "https://www.metmuseum.org/art/collection/search/437137",
    });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: {
        title: "Water Lilies",
        artist: "Claude Monet",
        accession: "1998.325.2",
        date: "1920",
      },
    });
    expect(result).toMatchObject({
      evidence: ["qr"],
      warnings: ["artist_not_found"],
      sourceUrl: "https://www.metmuseum.org/art/collection/search/437137",
      fields: {
        title: { evidence: "qr", locked: true },
        artist: { evidence: "qr", locked: true },
        accession: { evidence: "qr", locked: true },
        date: { value: "1920", evidence: "ocr", locked: false },
      },
    });
    expect(calls(TAVILY)).toHaveLength(0);
  });

  it("skips the plausibility checks when Wikidata is unavailable", async () => {
    const { user, scanId } = await fixture();
    wikidata({}, 503);
    tavily(tavilyMonet);
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Claude Monet", date: "1950" },
    });
    expect(result.warnings).toEqual([]);
    expect(result.fields).toMatchObject({
      title: { evidence: "tavily" },
      artist: { evidence: "tavily" },
      date: { evidence: "ocr" },
    });
  });

  it("carries the confidence from the read stage for unchanged values and drops it for edits", async () => {
    const { user, scanId, stored } = await fixture();
    models();
    wikidata();
    tavily({ results: [], usage: { credits: 1 } });
    await user.as.action(api.label.readLabel, { scanId, lines: LINES });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Water Lilies", artist: "Camille Monet" },
    });
    expect(result.fields.title).toMatchObject({ confidence: 0.98 });
    expect(result.fields.artist?.confidence).toBeUndefined();
    expect(result.promptVersion).toBe("label-v2");
    expect((await stored())?.rawOcr).toEqual(labelReading);
  });

  it("limits a device to sixty verifications per hour", async () => {
    const { user, scanId } = await fixture(null);
    wikidata();
    for (let i = 0; i < 60; i++) {
      await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { title: "x" },
      });
    }
    await expect(user.as.action(api.label.verifyLabel, { scanId, fields: { title: "x" } })).rejects.toMatchObject({
      data: { code: "rate_limited", name: "labelVerify" },
    });
  });

  it.each([graphPage, graphPage.replace('"creator":[{"@type":"Person","name":"Auguste Rodin"}],', "")])(
    "keeps an artist editable when the accession page contradicts or omits it",
    async (html) => {
      const { user, scanId } = await fixture(cleveland);
      page("https://www.clevelandart.org/art/1917.42", html);
      wikidata({ "Claude Monet": wikidataSearchMonet });
      tavily({ results: [], usage: { credits: 1 } });
      const result = await user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { ...thinker, artist: "Claude Monet" },
      });
      expect(result.fields.artist).toMatchObject({
        value: "Claude Monet",
        evidence: "ocr",
        locked: false,
      });
      expect(result.fields.title).toMatchObject({
        evidence: "accession",
        locked: true,
      });
      expect(result.fields.accession).toMatchObject({
        evidence: "accession",
        locked: true,
      });
    },
  );

  it("does not lock a conflicting artist with the same surname and qualifier", async () => {
    const { user, scanId } = await fixture(cleveland);
    page("https://www.clevelandart.org/art/1917.42", graphPage.replace("Auguste Rodin", "Pieter Brueghel the Younger"));
    wikidata();
    tavily({ results: [], usage: { credits: 1 } });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { ...thinker, artist: "Jan Brueghel the Younger" },
    });
    expect(result.fields.artist).toMatchObject({
      value: "Jan Brueghel the Younger",
      evidence: "weak",
      locked: false,
    });
    expect(result.fields.title).toMatchObject({
      evidence: "accession",
      locked: true,
    });
    expect(result.fields.accession).toMatchObject({
      evidence: "accession",
      locked: true,
    });
  });

  it("does not accept a related-work thumbnail as image evidence", async () => {
    const { user, scanId } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    const fields = { title: "Water Lilies", artist: "Claude Monet" };
    const unrelated = "https://images.metmuseum.org/CRDImages/mi/web-large/238693.jpg";
    const first = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    expect(first.imageUrls).not.toContain(unrelated);
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
      imageCheck: { url: unrelated, cosine: 0.99, homographyValid: true },
    });
    expect(result.fields.title?.evidence).toBe("tavily");
  });

  it.each([
    { date: "1919" },
    { accession: "1998.325.2" },
    { medium: "Oil on canvas" },
    { creditLine: "Gift of Someone" },
    { date: undefined },
  ])("persists other field changes alongside an image check: %j", async (edit) => {
    const { user, scanId, stored } = await fixture();
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    const fields = {
      title: "Water Lilies",
      artist: "Claude Monet",
      date: "1910",
    };
    const first = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { ...fields, ...edit },
      imageCheck: {
        url: first.imageUrls![0],
        cosine: 0.9,
        homographyValid: true,
      },
    });
    for (const [name, value] of Object.entries(edit)) {
      expect(result.fields[name as keyof typeof result.fields]?.value).toBe(value);
    }
    expect(await stored()).toEqual(result);
  });

  it("moderates edited text, clears flagged fields, and accounts for the extra call", async () => {
    const { user, scanId, stored, spend } = await fixture();
    tokenFactory((body) =>
      body.model === LABEL_MODEL
        ? completion(labelReading)
        : completion({
            flagged: String(body.messages[1].content).includes("415-555-0123"),
          }),
    );
    wikidata({ "Claude Monet": wikidataSearchMonet });
    tavily(tavilyMonet);
    await user.as.action(api.label.readLabel, { scanId, lines: LINES });
    const result = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: {
        title: "Water Lilies",
        artist: "Claude Monet",
        creditLine: "Call 415-555-0123",
      },
    });
    expect(result).toMatchObject({
      moderation: "flagged",
      fields: {},
      evidence: [],
    });
    expect(result.fields).toEqual({});
    expect(await stored()).toEqual(result);
    expect(result).not.toHaveProperty("rawOcr");
    expect(await spend()).toMatchObject({ tokenFactoryCalls: 3 });
    const body = JSON.parse(String(calls(TOKEN_FACTORY)[2][1]?.body));
    expect(JSON.parse(body.messages[1].content).input).toContain("415-555-0123");
  });

  it("reuses a clear verdict only for unchanged fields and honors the moderation cap for edits", async () => {
    const { user, scanId, stored } = await fixture();
    models();
    wikidata({ "Water Lilies": wikidataSearchWaterLilies });
    const read = await user.as.action(api.label.readLabel, {
      scanId,
      lines: LINES,
    });
    const fields = Object.fromEntries(Object.entries(read.fields).map(([name, field]) => [name, field.value]));
    vi.stubEnv("DAILY_TOKEN_FACTORY_CALL_CAP", "2");
    const verified = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields,
    });
    expect(verified.moderation).toBe("clear");
    expect(calls(TOKEN_FACTORY)).toHaveLength(2);
    await expect(
      user.as.action(api.label.verifyLabel, {
        scanId,
        fields: { ...fields, creditLine: "Edited" },
      }),
    ).rejects.toMatchObject({
      data: { code: "spend_cap", kind: "tokenFactory" },
    });
    expect(await stored()).toEqual({ ...verified, rawOcr: labelReading });
  });
});

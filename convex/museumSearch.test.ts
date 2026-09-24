import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { completion, jsonResponse } from "./lib/labelFixtures";
import {
  seedDevice,
  seedMuseum,
  seedScan,
  testVector,
} from "./lib/testFactories";
import { harness, signIn } from "./test.helpers";

const TOKEN_FACTORY = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY = "https://api.tavily.com/search";
const MODERATION_MODEL = "nvidia/Nemotron-3_5-Lightning";
const COLOUR = "https://www.metmuseum.org/exhibitions/colour";
const WATER = "https://www.metmuseum.org/exhibitions/water";
const red = "https://www.metmuseum.org/red.jpg";
const blue = "https://www.metmuseum.org/blue.jpg";
const lilies = "https://www.metmuseum.org/lilies.jpg";
const results = {
  results: [
    {
      url: COLOUR,
      title: "A Century of Colour",
      content: "Two paintings.",
      score: 0.9,
      images: [red, blue],
    },
    {
      url: WATER,
      title: "Water",
      content: "One painting.",
      score: 0.8,
      images: [lilies],
    },
  ],
  usage: { credits: 1 },
};
const colourHtml = `<title>A Century of Colour</title><script type="application/ld+json">${JSON.stringify(
  [
    { "@type": "Painting", name: "Red", creator: "First Artist", image: red },
    {
      "@type": "Painting",
      name: "Blue",
      creator: "Second Artist",
      image: blue,
    },
  ],
)}</script>`;
const waterHtml = `<title>Water</title><script type="application/ld+json">${JSON.stringify(
  {
    "@type": "VisualArtwork",
    name: "Water Lilies",
    creator: { "@type": "Person", name: "Claude Monet" },
    dateCreated: "1919",
    artMedium: "Oil on canvas",
    identifier: "1998.325.2",
    creditText: "Gift of Louise Reinhardt Smith, 1983",
    image: lilies,
  },
)}</script>`;

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
    if (
      url.href === TOKEN_FACTORY
      && JSON.parse(String(init?.body)).model === MODERATION_MODEL
    ) {
      return completion({ flagged: false });
    }
    throw new Error(`Unexpected fetch ${url.href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEBIUS_API_KEY", "nebius-test");
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  vi.stubEnv("MODERATION_MODEL", MODERATION_MODEL);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function tavily(response: unknown) {
  routes.push((url) =>
    url.href === TAVILY ? jsonResponse(response) : undefined,
  );
}
function page(href: string, html: string, init?: ResponseInit) {
  routes.push((url) =>
    url.href === href ? new Response(html, init) : undefined,
  );
}
function exhibitionPages() {
  page(COLOUR, colourHtml);
  page(WATER, waterHtml);
}
const calls = (prefix: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith(prefix));
const venueFetches = () =>
  fetchMock.mock.calls.filter(([url]) =>
    new URL(String(url)).host.endsWith("metmuseum.org"),
  );
const pass = (url: string) => ({ url, cosine: 0.9, homographyValid: true });

type MuseumOverrides = Partial<Omit<Doc<"museums">, "_id" | "_creationTime">>;
const MET: MuseumOverrides = {
  website: "https://www.metmuseum.org/",
  name: "The Metropolitan Museum of Art",
};

async function fixture(venue: MuseumOverrides | null = MET) {
  const t = harness();
  const user = await seedDevice(t);
  const venueId = venue
    ? await t.run((ctx) => seedMuseum(ctx, venue))
    : undefined;
  const scanId = await t.run((ctx) =>
    seedScan(ctx, { deviceId: user.deviceId, venueId }),
  );
  const stored = async () => (await t.run((ctx) => ctx.db.get(scanId)))!;
  const spend = async () =>
    (await t.run((ctx) => ctx.db.query("dailySpend").collect()))[0];
  const search = () =>
    user.as.action(api.museumSearch.searchExhibitions, { scanId });
  const confirm = (
    sourceUrl: string,
    imageCheck: { url: string; cosine: number; homographyValid: boolean },
  ) =>
    user.as.action(api.museumSearch.confirmSearchCandidate, {
      scanId,
      sourceUrl,
      imageCheck,
    });
  return { t, user, venueId, scanId, stored, spend, search, confirm };
}

async function searched() {
  const f = await fixture();
  tavily(results);
  exhibitionPages();
  const result = await f.search();
  if (result.stage !== "exhibitions") throw new Error("expected exhibitions");
  return { ...f, candidates: result.candidates };
}

function pauseNextFetch(response: Response) {
  let begin!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  fetchMock.mockImplementationOnce(async () => {
    begin();
    await resumed;
    return response;
  });
  return { started, resume };
}

describe("searchExhibitions", () => {
  it("makes one museum-scoped search with images, retains the source content, and sends no photo to a model", async () => {
    const { search, stored, spend } = await fixture();
    tavily(results);
    const state = await search();
    expect(state).toEqual({
      stage: "exhibitions",
      updatedAt: expect.any(Number),
      candidates: [
        {
          sourceUrl: COLOUR,
          imageUrls: [red, blue],
          exhibition: {
            title: "A Century of Colour",
            content: "Two paintings.",
          },
        },
        {
          sourceUrl: WATER,
          imageUrls: [lilies],
          exhibition: { title: "Water", content: "One painting." },
        },
      ],
    });
    expect((await stored()).museumSearch).toEqual(state);
    expect(JSON.parse(String(calls(TAVILY)[0][1]?.body))).toMatchObject({
      query: "The Metropolitan Museum of Art current exhibitions",
      include_images: true,
      include_domains: ["metmuseum.org"],
    });
    expect(calls(TAVILY)).toHaveLength(1);
    expect(calls(TOKEN_FACTORY)).toHaveLength(0);
    expect(venueFetches()).toHaveLength(0);
    expect(await spend()).toMatchObject({
      tavilyCredits: 1,
      tokenFactoryCalls: 0,
    });
  });

  it("refuses the flag off, other devices, ineligible scans, and venues without a site or opted out before any call", async () => {
    const { t, user, venueId, scanId, stored, spend, search } = await fixture();
    const rejects = (code: string, run = search) =>
      expect(run()).rejects.toMatchObject({ data: { code } });
    vi.stubEnv("FLAG_MUSEUM_SEARCH", "off");
    await rejects("feature_off");
    vi.stubEnv("FLAG_MUSEUM_SEARCH", "on");
    const other = await seedDevice(t);
    await rejects("invalid_scan", () =>
      other.as.action(api.museumSearch.searchExhibitions, { scanId }),
    );
    const unregistered = await signIn(t);
    await rejects("device_not_registered", () =>
      unregistered.as.action(api.museumSearch.searchExhibitions, { scanId }),
    );
    await rejects("unauthenticated", () =>
      t.action(api.museumSearch.searchExhibitions, { scanId }),
    );
    await t.run((ctx) => ctx.db.patch(scanId, { outcome: "confident" }));
    await rejects("invalid_scan");
    await t.run((ctx) =>
      ctx.db.patch(scanId, { outcome: "miss", status: "pending" }),
    );
    await rejects("invalid_scan");
    await t.run((ctx) =>
      ctx.db.patch(scanId, { status: "identified", venueId: undefined }),
    );
    await rejects("invalid_scan");
    await t.run((ctx) => ctx.db.patch(scanId, { venueId }));
    await t.run((ctx) => ctx.db.patch(venueId!, { website: undefined }));
    await rejects("no_venue_site");
    await t.run((ctx) =>
      ctx.db.patch(venueId!, { website: "https://www.metmuseum.org/" }),
    );
    const optOutId = await t.run((ctx) =>
      ctx.db.insert("optOuts", {
        venueId,
        requester: "museum",
        receivedAt: Date.now(),
      }),
    );
    await rejects("venue_opted_out");
    await t.run((ctx) => ctx.db.delete(optOutId));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
    expect((await stored()).museumSearch).toBeUndefined();
    expect(user.deviceId).toBeDefined();
  });

  it("applies the daily cap before any request and leaves the counter unchanged", async () => {
    const { search, stored, spend } = await fixture();
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
    const result = await search();
    expect(result).toEqual({
      stage: "none",
      reason: "cap",
      updatedAt: expect.any(Number),
    });
    expect((await stored()).museumSearch).toEqual(result);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await spend()).toBeUndefined();
  });

  it("retains the search credit after an ambiguous search failure", async () => {
    const { stored, spend, search } = await fixture();
    routes.push((url) => {
      if (url.href === TAVILY) throw new Error("timeout");
      return undefined;
    });
    await expect(search()).rejects.toMatchObject({
      data: { code: "search_error", reason: "fetch_failed" },
    });
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
    expect((await stored()).museumSearch).toBeUndefined();
  });

  it("refunds the credit when the search client is unconfigured", async () => {
    const { spend, search } = await fixture();
    vi.stubEnv("TAVILY_API_KEY", "");
    await expect(search()).rejects.toMatchObject({
      data: { code: "search_unconfigured" },
    });
    expect(await spend()).toMatchObject({ tavilyCredits: 0 });
  });

  it("limits a device to ten searches per hour", async () => {
    const { search } = await fixture();
    tavily({ results: [], usage: { credits: 1 } });
    for (let i = 0; i < 10; i++) await search();
    await expect(search()).rejects.toMatchObject({
      data: { code: "rate_limited", name: "museumSearch" },
    });
    expect(calls(TAVILY)).toHaveLength(10);
  });

  it("preserves a newer confirmation when an older search finishes", async () => {
    const { stored, spend, search, confirm } = await fixture();
    const pending = pauseNextFetch(jsonResponse(results));
    tavily(results);
    exhibitionPages();
    const obsolete = expect(search()).rejects.toMatchObject({
      data: { code: "search_superseded" },
    });
    await pending.started;
    await search();
    await confirm(COLOUR, pass(blue));
    const confirmed = await stored();
    expect(confirmed.museumSearch?.stage).toBe("confirmed");
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(confirmed);
    expect(await spend()).toMatchObject({ tavilyCredits: 2 });
  });

  it("preserves the latest search result when a capped retry supersedes an in-flight search", async () => {
    const { stored, spend, search } = await fixture();
    const pending = pauseNextFetch(
      jsonResponse({ results: [], usage: { credits: 1 } }),
    );
    const obsolete = expect(search()).rejects.toMatchObject({
      data: { code: "search_superseded" },
    });
    await pending.started;
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "1");
    expect(await search()).toMatchObject({ stage: "none", reason: "cap" });
    const latest = await stored();
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(latest);
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("rejects an obsolete result after the scan restarts and still settles spend", async () => {
    const { t, user, scanId, stored, spend, search } = await fixture();
    const original = await stored();
    const pending = pauseNextFetch(
      jsonResponse({ results: [], usage: { credits: 1 } }),
    );
    const rejected = expect(search()).rejects.toMatchObject({
      data: { code: "scan_restarted" },
    });
    await pending.started;
    await t.run((ctx) => ctx.db.patch(scanId, { status: "failed" }));
    const restarted = await t.mutation(internal.scans.create, {
      deviceId: user.deviceId,
      localId: original.localId,
      modelVersion: model.modelVersion,
      vector: testVector(),
      capturedAt: original.capturedAt,
      venueId: original.venueId,
      visitId: original.visitId,
    });
    expect(restarted.scan).toMatchObject({ _id: scanId, generation: 1 });
    pending.resume();
    await rejected;
    expect((await stored()).museumSearch).toBeUndefined();
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });
});

describe("confirmSearchCandidate", () => {
  it("locks title and artist with tavily+image and the other page fields with tavily, and records the selection", async () => {
    const { stored, spend, candidates, confirm } = await searched();
    const result = await confirm(WATER, pass(lilies));
    expect(result).toEqual({
      stage: "verified",
      evidence: ["tavily+image", "tavily"],
      warnings: [],
      moderation: "clear",
      sourceUrl: WATER,
      imageUrls: [lilies],
      identityImageUrl: lilies,
      updatedAt: expect.any(Number),
      fields: {
        title: {
          value: "Water Lilies",
          evidence: "tavily+image",
          locked: true,
        },
        artist: {
          value: "Claude Monet",
          evidence: "tavily+image",
          locked: true,
        },
        date: { value: "1919", evidence: "tavily", locked: true },
        accession: { value: "1998.325.2", evidence: "tavily", locked: true },
        medium: { value: "Oil on canvas", evidence: "tavily", locked: true },
        creditLine: {
          value: "Gift of Louise Reinhardt Smith, 1983",
          evidence: "tavily",
          locked: true,
        },
      },
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toEqual({
      stage: "confirmed",
      candidates,
      selected: { sourceUrl: WATER, imageUrl: lilies },
      updatedAt: result.updatedAt,
    });
    // 04.07's contribute precondition on the stored scan.
    expect(
      scan.labelFlow?.stage === "verified"
        && scan.labelFlow.moderation !== "flagged",
    ).toBe(true);
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 1,
      tavilyCredits: 1,
    });
    expect(calls(TAVILY)).toHaveLength(1);
    expect(venueFetches().map(([url]) => String(url))).toEqual([WATER]);
    const moderation = JSON.parse(String(calls(TOKEN_FACTORY)[0][1]?.body));
    expect(moderation.model).toBe(MODERATION_MODEL);
    expect(JSON.parse(moderation.messages[1].content).input).toContain(
      "Gift of Louise Reinhardt Smith, 1983",
    );
  });

  it("confirms the second image with only its own metadata and returns retries without another fetch", async () => {
    const { confirm, stored } = await searched();
    const flow = await confirm(COLOUR, pass(blue));
    expect(flow).toMatchObject({
      identityImageUrl: blue,
      sourceUrl: COLOUR,
      imageUrls: [blue],
      evidence: ["tavily+image"],
      fields: {
        title: { value: "Blue", evidence: "tavily+image" },
        artist: { value: "Second Artist", evidence: "tavily+image" },
      },
    });
    expect((await stored()).museumSearch).toMatchObject({
      stage: "confirmed",
      selected: { sourceUrl: COLOUR, imageUrl: blue },
    });
    const count = fetchMock.mock.calls.length;
    expect(await confirm(COLOUR, pass(blue))).toEqual(flow);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it.each(["exhibitions", "confirmed"] as const)(
    "rejects an unknown page or image while %s",
    async (stage) => {
      const { confirm } = await searched();
      if (stage === "confirmed") await confirm(COLOUR, pass(blue));
      await expect(
        confirm("https://www.metmuseum.org/exhibitions/other", pass(blue)),
      ).rejects.toMatchObject({ data: { code: "unknown_candidate" } });
      await expect(
        confirm(COLOUR, pass("https://www.metmuseum.org/other.jpg")),
      ).rejects.toMatchObject({ data: { code: "unknown_candidate" } });
      await expect(confirm(COLOUR, pass(lilies))).rejects.toMatchObject({
        data: { code: "unknown_candidate" },
      });
    },
  );

  it("rejects a confirmation for a scan without a search", async () => {
    const { confirm } = await fixture();
    await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
      data: { code: "unknown_candidate" },
    });
    vi.stubEnv("FLAG_MUSEUM_SEARCH", "off");
    await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
      data: { code: "feature_off" },
    });
  });

  it.each([
    { cosine: NaN, homographyValid: true },
    { cosine: 1.01, homographyValid: true },
    { cosine: 0.5, homographyValid: true },
    { cosine: 0.99, homographyValid: false },
  ])("rejects the image check %j", async (check) => {
    const { stored, confirm } = await searched();
    await expect(
      confirm(COLOUR, { url: blue, ...check }),
    ).rejects.toMatchObject({
      data: { code: "image_mismatch" },
    });
    const scan = await stored();
    expect(scan.labelFlow).toBeUndefined();
    expect(scan.museumSearch?.stage).toBe("exhibitions");
    expect(venueFetches()).toHaveLength(0);
  });

  it("refuses to identify a matching image from a generic exhibition title and records the outcome", async () => {
    const { search, confirm, stored } = await fixture();
    tavily(results);
    page(
      COLOUR,
      '<meta property="og:title" content="A Century of Colour"><meta name="author" content="Museum curator">',
    );
    await search();
    await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
      data: { code: "identity_unresolved" },
    });
    expect((await stored()).labelFlow).toBeUndefined();
    expect((await stored()).museumSearch).toMatchObject({
      stage: "none",
      reason: "identity_unresolved",
    });
    expect(calls(TOKEN_FACTORY)).toHaveLength(0);
    // Reopening the scan finds a finished search, so the page is not fetched again.
    const fetches = venueFetches().length;
    await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
      data: { code: "unknown_candidate" },
    });
    expect(venueFetches()).toHaveLength(fetches);
  });

  it("keeps the exhibition candidates when the page cannot be fetched, so a later confirmation retries", async () => {
    const { search, confirm, stored } = await fixture();
    tavily(results);
    page(COLOUR, "slow down", { status: 429 });
    await search();
    await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
      data: { code: "page_unavailable" },
    });
    expect((await stored()).museumSearch).toMatchObject({
      stage: "exhibitions",
    });
    expect((await stored()).labelFlow).toBeUndefined();
    routes = [];
    page(COLOUR, colourHtml);
    expect(await confirm(COLOUR, pass(blue))).toMatchObject({
      fields: { title: { value: "Blue" }, artist: { value: "Second Artist" } },
    });
  });

  it("resolves only the matched image caption, grounds model fields in it, and accounts for both extraction and moderation", async () => {
    const { search, confirm, spend } = await fixture();
    vi.stubEnv("DOCENT_MODEL", "caption-model");
    tavily(results);
    page(
      COLOUR,
      `<figure><img src="${red}"><figcaption>First Artist, Red.</figcaption></figure>`
        + `<figure><img src="${blue}"><figcaption>Second Artist, Blue, 2020.</figcaption></figure>`,
    );
    routes.push((url, init) =>
      url.href === TOKEN_FACTORY
      && JSON.parse(String(init?.body)).model === "caption-model"
        ? completion({ title: "Blue", artist: "Second Artist" })
        : undefined,
    );
    await search();
    expect(await confirm(COLOUR, pass(blue))).toMatchObject({
      fields: { title: { value: "Blue" }, artist: { value: "Second Artist" } },
    });
    const request = JSON.parse(String(calls(TOKEN_FACTORY)[0][1]?.body));
    expect(JSON.parse(request.messages[1].content)).toEqual({
      caption: "Second Artist, Blue, 2020.",
    });
    expect(await spend()).toMatchObject({
      tavilyCredits: 1,
      tokenFactoryCalls: 2,
    });
  });

  it("clears flagged fields and returns the flagged result again on a retry", async () => {
    const { stored, spend, confirm } = await searched();
    routes.push((url, init) =>
      url.href === TOKEN_FACTORY
      && JSON.parse(String(init?.body)).model === MODERATION_MODEL
        ? completion({ flagged: true })
        : undefined,
    );
    const result = await confirm(WATER, pass(lilies));
    expect(result).toEqual({
      stage: "verified",
      fields: {},
      evidence: [],
      warnings: [],
      moderation: "flagged",
      sourceUrl: WATER,
      imageUrls: [lilies],
      identityImageUrl: lilies,
      updatedAt: expect.any(Number),
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toMatchObject({
      stage: "confirmed",
      selected: { sourceUrl: WATER, imageUrl: lilies },
    });
    const before = fetchMock.mock.calls.length;
    const spent = await spend();
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(await confirm(WATER, pass(lilies))).toEqual(result);
    expect(await stored()).toEqual(scan);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(await spend()).toEqual(spent);
  });

  it("replaces the selection when another retained candidate is confirmed, without another search", async () => {
    const { stored, candidates, confirm } = await searched();
    await confirm(COLOUR, pass(blue));
    const result = await confirm(WATER, pass(lilies));
    expect(result).toMatchObject({
      sourceUrl: WATER,
      imageUrls: [lilies],
      fields: {
        title: { evidence: "tavily+image" },
        accession: { value: "1998.325.2", evidence: "tavily", locked: true },
      },
    });
    const scan = await stored();
    expect(scan.labelFlow).toEqual(result);
    expect(scan.museumSearch).toEqual({
      stage: "confirmed",
      candidates,
      selected: { sourceUrl: WATER, imageUrl: lilies },
      updatedAt: result.updatedAt,
    });
    expect(calls(TAVILY)).toHaveLength(1);
    expect(calls(TOKEN_FACTORY)).toHaveLength(2);
  });

  it.each([false, true])(
    "limits paid confirmations while preserving free retries (flagged=%s)",
    async (flagged) => {
      const { stored, spend, confirm } = await searched();
      routes.push((url) =>
        url.href === TOKEN_FACTORY ? completion({ flagged }) : undefined,
      );
      const selections = [
        [COLOUR, blue],
        [WATER, lilies],
      ] as const;
      for (let i = 0; i < 60; i++) {
        const [sourceUrl, imageUrl] = selections[i % 2];
        await confirm(sourceUrl, pass(imageUrl));
      }
      const scan = await stored();
      const spent = await spend();
      expect(spent).toMatchObject({ tokenFactoryCalls: 60, tavilyCredits: 1 });
      await expect(confirm(COLOUR, pass(blue))).rejects.toMatchObject({
        data: { code: "rate_limited", name: "labelVerify" },
      });
      expect(await confirm(WATER, pass(lilies))).toEqual(scan.labelFlow);
      expect(await stored()).toEqual(scan);
      expect(await spend()).toEqual(spent);
      expect(calls(TOKEN_FACTORY)).toHaveLength(60);
    },
  );

  it("retains image-specific evidence when the visitor shares unchanged fields", async () => {
    const { user, scanId, confirm } = await searched();
    await confirm(COLOUR, pass(blue));
    const flow = await user.as.action(api.label.verifyLabel, {
      scanId,
      fields: { title: "Blue", artist: "Second Artist" },
    });
    expect(flow).toMatchObject({
      identityImageUrl: blue,
      sourceUrl: COLOUR,
      fields: {
        title: { evidence: "tavily+image" },
        artist: { evidence: "tavily+image" },
      },
    });
    expect(flow.wikidataId).toBeUndefined();
  });

  it("invalidates an in-flight retry when a retained candidate is confirmed", async () => {
    const { stored, spend, confirm, search } = await searched();
    const pending = pauseNextFetch(
      jsonResponse({ results: [], usage: { credits: 1 } }),
    );
    const obsolete = expect(search()).rejects.toMatchObject({
      data: { code: "search_superseded" },
    });
    await pending.started;
    await confirm(COLOUR, pass(blue));
    const confirmed = await stored();
    pending.resume();
    await obsolete;
    expect(await stored()).toEqual(confirmed);
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 1,
      tavilyCredits: 2,
    });
  });

  it("allows a new manual search after confirmation", async () => {
    const { stored, spend, confirm, search } = await searched();
    await confirm(COLOUR, pass(blue));
    routes = [];
    tavily({ results: [], usage: { credits: 1 } });
    const result = await search();
    expect(result).toEqual({
      stage: "exhibitions",
      candidates: [],
      updatedAt: expect.any(Number),
    });
    expect((await stored()).museumSearch).toEqual(result);
    expect(await spend()).toMatchObject({
      tokenFactoryCalls: 1,
      tavilyCredits: 2,
    });
  });

  it("rejects a stale confirmation after the scan restarts", async () => {
    const { t, user, scanId, stored, confirm } = await searched();
    const original = await stored();
    routes = [];
    const pending = pauseNextFetch(new Response(waterHtml));
    const rejected = expect(confirm(WATER, pass(lilies))).rejects.toMatchObject(
      {
        data: { code: "scan_restarted" },
      },
    );
    await pending.started;
    await t.run((ctx) => ctx.db.patch(scanId, { status: "failed" }));
    await t.mutation(internal.scans.create, {
      deviceId: user.deviceId,
      localId: original.localId,
      modelVersion: model.modelVersion,
      vector: testVector(),
      capturedAt: original.capturedAt,
      venueId: original.venueId,
      visitId: original.visitId,
    });
    pending.resume();
    await rejected;
    expect((await stored()).labelFlow).toBeUndefined();
  });
});

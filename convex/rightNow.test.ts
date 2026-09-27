import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { jsonResponse } from "./lib/labelFixtures";
import { regionDomains } from "./lib/regions";
import { FIXTURE_NOW, rawTavily, rightNowFixtures, type RightNowFixture } from "./lib/rightNowFixtures";
import { readSpend, seedEmbedding, seedDevice, seedMuseum, testVector } from "./lib/testFactories";
import { harness, type Harness } from "./test.helpers";

const TAVILY = "https://api.tavily.com/search";
const supportedNews: RightNowFixture = {
  artist: "Yayoi Kusama",
  region: "sf-bay-area",
  note: "Synthetic verbatim, dated event announcement",
  response: {
    answer: "Yayoi Kusama’s exhibition opens at the San Francisco Museum of Modern Art on September 12, 2026.",
    images: [],
    credits: 1,
    results: [
      {
        url: "https://www.sfmoma.org/press/kusama-exhibition",
        title: "Kusama exhibition announcement",
        content: "Yayoi Kusama’s exhibition opens at the San Francisco Museum of Modern Art on September 12, 2026.",
        score: 0.9,
        publishedDate: "2026-09-07",
        images: [],
      },
    ],
  },
};
const supportedCard = {
  text: supportedNews.response.answer!,
  sourceUrl: supportedNews.response.results[0].url,
  sourceLabel: "sfmoma.org",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
  vi.stubEnv("FLAG_RIGHT_NOW", "on");
  vi.spyOn(Date, "now").mockReturnValue(FIXTURE_NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function tavily(fixture: RightNowFixture) {
  fetchMock.mockImplementation(async (input) => {
    if (String(input) !== TAVILY) {
      throw new Error(`Unexpected fetch ${String(input)}`);
    }
    return jsonResponse(rawTavily(fixture));
  });
}

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
      outcome: "confident",
      updatedAt: now,
    }),
  );
}

async function fixture(region: string | null = "sf-bay-area") {
  const t = harness();
  const { deviceId } = await seedDevice(t);
  const venueId = region ? await t.run((ctx) => seedMuseum(ctx, { region })) : undefined;
  const scanId = await seedScan(t, deviceId, venueId);
  const run = (
    overrides: Partial<{
      scanId: Id<"scans">;
      generation: number;
      artist: string;
      artistId: string;
    }> = {},
  ) =>
    t.action(internal.rightNow.fetch, {
      scanId,
      generation: 0,
      artist: "Yayoi Kusama",
      venueId,
      deviceId,
      ...overrides,
    });
  const scan = (id: Id<"scans"> = scanId) => t.run((ctx) => ctx.db.get("scans", id));
  const rows = () => t.run((ctx) => ctx.db.query("artistContext").collect());
  const spend = () => readSpend(t);
  return { t, deviceId, venueId, scanId, run, scan, rows, spend };
}

describe("rightNow.fetch", () => {
  it("is off by default and makes no request", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    const { run, rows } = await fixture();
    tavily(supportedNews);
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it("sends the scoped search request, writes the supported answer with its actual source, and caches it", async () => {
    const { run, scan, rows, spend } = await fixture();
    tavily(supportedNews);
    await run();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      query: "Yayoi Kusama exhibition OR news",
      search_depth: "basic",
      auto_parameters: false,
      topic: "news",
      time_range: "month",
      include_answer: "basic",
      include_domains: regionDomains("sf-bay-area"),
      include_domains_mode: "filter",
      include_images: false,
      max_results: 5,
      include_usage: true,
    });
    expect((await scan())?.rightNow).toEqual(supportedCard);
    const [row] = await rows();
    expect(row).toMatchObject({
      artistId: "name:yayoi kusama",
      region: "sf-bay-area",
      empty: false,
      fetchedAt: FIXTURE_NOW,
      ...supportedCard,
    });
    expect(row).not.toHaveProperty("pendingAt");
    expect(row).not.toHaveProperty("waiting");
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("serves later scans from the cache and keys Wikidata artists by id", async () => {
    const { t, deviceId, venueId, run, scan, rows } = await fixture();
    tavily(supportedNews);
    await run();
    const second = await seedScan(t, deviceId, venueId);
    await run({ scanId: second });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await scan(second))?.rightNow).toEqual(supportedCard);
    const third = await seedScan(t, deviceId, venueId);
    await run({ scanId: third, artistId: "Q231301" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await rows()).map((row) => row.artistId).sort()).toEqual(["Q231301", "name:yayoi kusama"]);
  });

  it.each([
    ["a synthetic-name answer", rightNowFixtures.emptyFilter],
    ["an abstention", rightNowFixtures.rupyTutSf],
    ["a low-score archive answer", rightNowFixtures.hockneySf],
  ])("caches %s as empty for seven days without a card", async (_label, recorded) => {
    const { t, deviceId, venueId, run, scan, rows } = await fixture();
    tavily(recorded);
    await run({ artist: recorded.artist });
    expect((await scan())?.rightNow).toBeUndefined();
    expect(await rows()).toMatchObject([{ empty: true, text: "", fetchedAt: FIXTURE_NOW }]);
    const second = await seedScan(t, deviceId, venueId);
    await run({ scanId: second, artist: recorded.artist });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await scan(second))?.rightNow).toBeUndefined();
  });

  it("refuses a contradicted high-score answer", async () => {
    const { run, scan, rows } = await fixture("new-york");
    tavily(rightNowFixtures.kusamaNy);
    await run();
    expect((await scan())?.rightNow).toBeUndefined();
    expect(await rows()).toMatchObject([{ empty: true }]);
  });

  it("coalesces concurrent misses into one credit and delivers the card to every waiting scan", async () => {
    const { t, deviceId, venueId, run, scan, spend } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return jsonResponse(rawTavily(supportedNews));
    });
    const second = await seedScan(t, deviceId, venueId);
    const first = run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pending = run({ scanId: second });
    await pending;
    expect((await scan(second))?.rightNow).toBeUndefined();
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await scan())?.rightNow).toEqual(supportedCard);
    expect((await scan(second))?.rightNow).toEqual(supportedCard);
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
  });

  it("makes no request for an unconfigured region or a scan without a venue", async () => {
    const unconfigured = await fixture("country:DE");
    tavily(supportedNews);
    await unconfigured.run();
    const noVenue = await fixture(null);
    await noVenue.run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await unconfigured.rows()).toEqual([]);
  });

  it("does not write a card to a restarted scan generation", async () => {
    const { run, scan, rows } = await fixture();
    tavily(supportedNews);
    await run({ generation: 3 });
    expect((await scan())?.rightNow).toBeUndefined();
    expect(await rows()).toMatchObject([{ empty: false }]);
  });

  it("keeps the reservation and releases the claim when the search fails, and refunds when unconfigured", async () => {
    const { run, rows, spend } = await fixture();
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await run();
    expect(await rows()).toEqual([]);
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
    vi.stubEnv("TAVILY_API_KEY", "");
    await run();
    expect(await spend()).toMatchObject({ tavilyCredits: 1 });
    expect(await rows()).toEqual([]);
  });

  it("stops at the per-device limit and the daily credit cap before any request", async () => {
    const { t, deviceId, venueId, run, rows } = await fixture();
    tavily(supportedNews);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "1000");
    for (let i = 0; i < 61; i++) {
      await run({
        scanId: await seedScan(t, deviceId, venueId),
        artist: `Artist ${i}`,
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(await rows()).toHaveLength(60);
    vi.stubEnv("DAILY_TAVILY_CREDIT_CAP", "0");
    const other = await seedDevice(t);
    await t.action(internal.rightNow.fetch, {
      scanId: await seedScan(t, other.deviceId, venueId),
      generation: 0,
      artist: "Yayoi Kusama",
      venueId,
      deviceId: other.deviceId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(await rows()).toHaveLength(60);
  });
});

describe("news claim ownership", () => {
  it.each([false, true])("ignores a superseded write and release (existing expired cache: %s)", async (cached) => {
    const { t, scanId, deviceId, venueId, scan, rows } = await fixture();
    const key = { artistKey: "name:yayoi kusama", region: "sf-bay-area" };
    if (cached) {
      await t.run((ctx) =>
        ctx.db.insert("artistContext", {
          artistId: key.artistKey,
          region: key.region,
          ...supportedCard,
          empty: false,
          fetchedAt: FIXTURE_NOW - 8 * 24 * 60 * 60 * 1000,
        }),
      );
    }
    const first = await t.mutation(internal.rightNow.claim, {
      ...key,
      scanId,
      generation: 0,
    });
    expect(first).toHaveProperty("claimId");
    if (typeof first === "string") {
      throw new Error("Expected ownership of the first request");
    }
    vi.mocked(Date.now).mockReturnValue(FIXTURE_NOW + 61_000);
    const secondScanId = await seedScan(t, deviceId, venueId);
    const second = await t.mutation(internal.rightNow.claim, {
      ...key,
      scanId: secondScanId,
      generation: 0,
    });
    expect(second).toHaveProperty("claimId");
    if (typeof second === "string") {
      throw new Error("Expected ownership of the replacement request");
    }
    const waitingScanId = await seedScan(t, deviceId, venueId);
    expect(
      await t.mutation(internal.rightNow.claim, {
        ...key,
        scanId: waitingScanId,
        generation: 0,
      }),
    ).toBe("pending");
    await t.mutation(internal.rightNow.release, {
      ...key,
      claimId: first.claimId,
    });
    expect(
      await t.mutation(internal.rightNow.write, {
        ...key,
        claimId: first.claimId,
        card: null,
      }),
    ).toBe(false);
    expect((await rows())[0].waiting).toHaveLength(2);
    expect(
      await t.mutation(internal.rightNow.write, {
        ...key,
        claimId: second.claimId,
        card: supportedCard,
      }),
    ).toBe(true);
    expect((await scan(secondScanId))?.rightNow).toEqual(supportedCard);
    expect((await scan(waitingScanId))?.rightNow).toEqual(supportedCard);
    await t.mutation(internal.rightNow.release, {
      ...key,
      claimId: first.claimId,
    });
    expect(
      await t.mutation(internal.rightNow.write, {
        ...key,
        claimId: first.claimId,
        card: null,
      }),
    ).toBe(false);
    expect((await rows())[0]).toMatchObject({
      ...supportedCard,
      empty: false,
    });
  });

  it("does not reuse ownership after a failed cache miss is deleted and retried at the same time", async () => {
    const { t, scanId } = await fixture();
    const key = { artistKey: "name:yayoi kusama", region: "sf-bay-area" };
    const first = await t.mutation(internal.rightNow.claim, {
      ...key,
      scanId,
      generation: 0,
    });
    if (typeof first === "string") throw new Error("Expected first claim");
    await t.mutation(internal.rightNow.release, {
      ...key,
      claimId: first.claimId,
    });
    const next = await t.mutation(internal.rightNow.claim, {
      ...key,
      scanId,
      generation: 0,
    });
    if (typeof next === "string") throw new Error("Expected replacement claim");
    expect(next.claimId).not.toBe(first.claimId);
  });
});

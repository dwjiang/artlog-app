import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, wikidataEntities, wikidataEntitiesResponse, wikidataSearchWaterLilies } from "./labelFixtures";
import { reportBackendError } from "./observability";
import {
  collections,
  countries,
  creators,
  entityLabel,
  findEntityByStatement,
  getEntities,
  getEntity,
  isArtist,
  isPainting,
  lifespan,
  searchEntities,
  wikipediaArticle,
  yearValues,
  type WikidataEntity,
} from "./wikidata";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const entity = (id: string) => wikidataEntities[id] as WikidataEntity;

describe("Wikidata client", () => {
  it("requests bounded language labels and sitelinks and reads the selected Wikipedia language", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entities: { Q1: { id: "Q1" } } }));
    await getEntity("Q1", "labels|aliases|sitelinks", ["en", "fr"]);
    const query = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(query.get("languages")).toBe("en|fr");
    expect(query.get("sitefilter")).toBe("enwiki|frwiki");
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { pages: [{ extract: "Un tableau." }] } }));
    expect(await wikipediaArticle("Le Port", "fr")).toBe("Un tableau.");
    expect(new URL(String(fetchMock.mock.calls[1][0])).host).toBe("fr.wikipedia.org");
    await expect(wikipediaArticle("Le Port", "fr.evil.example/")).rejects.toMatchObject({
      data: { reason: "invalid_language" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { error: { code: "ratelimited", info: "Rate limit exceeded" } },
    { errors: [{ code: "ratelimited", text: "Rate limit exceeded" }] },
  ])("surfaces HTTP 200 API errors for searches and entity lookups", async (response) => {
    fetchMock.mockImplementation(async () => jsonResponse(response));
    await expect(searchEntities("Claude Monet")).rejects.toMatchObject({
      data: { code: "wikidata_error" },
    });
    await expect(getEntities(["Q296"])).rejects.toMatchObject({
      data: { code: "wikidata_error" },
    });
  });

  it("searches items in English with an identified User-Agent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(wikidataSearchWaterLilies));
    const hits = await searchEntities("Water Lilies");
    expect(hits.map((hit) => hit.id)).toEqual(["Q1189907", "Q7973309", "Q93512"]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://www.wikidata.org/w/api.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "wbsearchentities",
      search: "Water Lilies",
      language: "en",
      type: "item",
      limit: "10",
      format: "json",
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: {
        "User-Agent": expect.stringMatching(/^artlog-bot\/0\.1 \(\+https:\/\/github\.com\//),
      },
    });
  });

  it("finds the one item carrying a museum identifier", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ query: { search: [{ title: "Q18713076" }] } }))
      .mockResolvedValueOnce(jsonResponse({ query: { search: [{ title: "Q1" }, { title: "Q2" }] } }))
      .mockResolvedValueOnce(jsonResponse({ query: { search: [] } }));
    expect(await findEntityByStatement("P4610", "28560")).toBe("Q18713076");
    expect(await findEntityByStatement("P3634", "1")).toBeNull();
    expect(await findEntityByStatement("P3634", "2")).toBeNull();
    const params = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(params.get("list")).toBe("search");
    expect(params.get("srsearch")).toBe("haswbstatement:P4610=28560");
  });

  it("reads an English Wikipedia article as plain text, empty when it does not exist", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          query: { pages: [{ title: "The Bohemian (Bouguereau)", extract: " The Bohemian is an oil painting.\n" }] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ query: { pages: [{ title: "Missing", missing: true }] } }));
    expect(await wikipediaArticle("The Bohemian (Bouguereau)")).toBe("The Bohemian is an oil painting.");
    expect(await wikipediaArticle("Missing")).toBe("");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(url.searchParams.get("titles")).toBe("The Bohemian (Bouguereau)");
    expect(url.searchParams.get("explaintext")).toBe("1");
  });

  it("batches entity lookups into one call and drops missing entities", async () => {
    fetchMock.mockImplementation(async (input) => {
      const ids = new URL(String(input)).searchParams.get("ids")!.split("|");
      return jsonResponse(wikidataEntitiesResponse(ids));
    });
    const entities = await getEntities(["Q296", "Q296", "Q999999"]);
    expect(Object.keys(entities)).toEqual(["Q296"]);
    const params = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(params.get("action")).toBe("wbgetentities");
    expect(params.get("ids")).toBe("Q296|Q999999");
    expect(params.get("props")).toBe("labels|claims");
    expect(params.get("sitefilter")).toBe("enwiki");
    expect(await getEntity("Q999999")).toBeNull();
    expect(await getEntities([])).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads painting, creator, occupation, lifespan, collection and country claims", () => {
    expect(isPainting(entity("Q7973309"))).toBe(true);
    expect(isPainting(entity("Q1189907"))).toBe(false);
    expect(creators(entity("Q7973309"))).toEqual(["Q296"]);
    expect(entityLabel(entity("Q296"))).toBe("Claude Monet");
    expect(isArtist(entity("Q296"))).toBe(true);
    expect(isArtist(entity("Q160236"))).toBe(false);
    expect(lifespan(entity("Q296"))).toEqual({ birth: 1840, death: 1926 });
    expect(lifespan(entity("Q160236"))).toEqual({
      birth: undefined,
      death: undefined,
    });
    expect(collections(entity("Q296"))).toEqual(["Q160236", "Q679527"]);
    expect(countries(entity("Q679527"))).toEqual(["Q55"]);
    expect(
      yearValues(
        {
          id: "Q1",
          claims: {
            P569: [
              {
                mainsnak: {
                  snaktype: "value",
                  datavalue: {
                    type: "time",
                    value: { time: "-0500-01-01T00:00:00Z" },
                  },
                },
              },
            ],
          },
        },
        "P569",
      ),
    ).toEqual([-500]);
  });

  it("returns every requested entity across batches and propagates later failures", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `Q${1000 + i}`);
    fetchMock.mockImplementation(async (input) => {
      const requested = new URL(String(input)).searchParams.get("ids")!.split("|");
      expect(requested.length).toBeLessThanOrEqual(50);
      return jsonResponse({
        entities: Object.fromEntries(requested.map((id) => [id, { id }])),
      });
    });
    expect(Object.keys(await getEntities([...ids, ids[0]]))).toEqual(ids);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(jsonResponse({ entities: { Q1000: { id: "Q1000" } } }));
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(getEntities(ids)).rejects.toMatchObject({
      data: { code: "wikidata_error" },
    });
  });

  it.each(["timeout", "body_timeout", "size", "fetch_failed", "untyped_size"])(
    "reports a bounded %s reason without request or error content",
    async (failure) => {
      const reason = failure === "body_timeout" ? "timeout" : failure === "untyped_size" ? "fetch_failed" : failure;
      vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
      const envelopes: string[] = [];
      fetchMock.mockImplementation(async (url, init) => {
        if (String(url).startsWith("https://example.ingest.sentry.io/")) {
          envelopes.push(String(init?.body));
          return new Response("{}");
        }
        if (failure === "body_timeout") {
          return new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener("abort", () =>
                  controller.error(new DOMException("private_error", "AbortError")),
                );
              },
            }),
          );
        }
        if (failure === "untyped_size") throw new Error("Response too large");
        if (failure === "timeout") {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("private_error", "AbortError")));
          });
        }
        if (reason === "size") return new Response(new Uint8Array(8 * 1024 * 1024 + 1));
        throw new TypeError("private_error https://private.example/?token=private_token");
      });
      if (reason === "timeout") vi.useFakeTimers();
      const pending = searchEntities("private_search").catch((error: unknown) => error);
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(8000);
      const error = await pending;
      vi.useRealTimers();
      expect(error).toMatchObject({ data: { code: "wikidata_error", reason } });
      await reportBackendError(error, "exhibitionRefresh.names");
      expect(envelopes).toHaveLength(1);
      const event = JSON.parse(envelopes[0].split("\n")[2]);
      expect(event.tags).toMatchObject({ error_code: "wikidata_error", reason, operation: "exhibitionRefresh.names" });
      for (const marker of ["private_search", "private_error", "private.example", "private_token"]) {
        expect(envelopes[0]).not.toContain(marker);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("surfaces HTTP and parse failures as wikidata_error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    await expect(searchEntities("x")).rejects.toMatchObject({
      data: { code: "wikidata_error", reason: "http_429" },
    });
    fetchMock.mockResolvedValueOnce(new Response("<html>"));
    await expect(getEntities(["Q1"])).rejects.toMatchObject({
      data: { code: "wikidata_error", reason: "bad_json" },
    });
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    await expect(searchEntities("x")).rejects.toMatchObject({
      data: { code: "wikidata_error", reason: "fetch_failed" },
    });
  });
});

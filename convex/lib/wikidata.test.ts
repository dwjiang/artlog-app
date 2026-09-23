import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonResponse,
  wikidataEntities,
  wikidataEntitiesResponse,
  wikidataSearchWaterLilies,
} from "./labelFixtures";
import {
  collections,
  countries,
  creators,
  entityLabel,
  getEntities,
  getEntity,
  isArtist,
  isPainting,
  lifespan,
  searchEntities,
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
});

const entity = (id: string) => wikidataEntities[id] as WikidataEntity;

describe("Wikidata client", () => {
  it.each([
    { error: { code: "ratelimited", info: "Rate limit exceeded" } },
    { errors: [{ code: "ratelimited", text: "Rate limit exceeded" }] },
  ])("surfaces HTTP 200 API errors for searches and entity lookups", async (response) => {
    fetchMock.mockImplementation(async () => jsonResponse(response));
    await expect(searchEntities("Claude Monet")).rejects.toMatchObject({
      data: { code: "wikidata_error" },
    });
    await expect(getEntities(["Q296"])).rejects.toMatchObject({ data: { code: "wikidata_error" } });
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
    expect(lifespan(entity("Q160236"))).toEqual({ birth: undefined, death: undefined });
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
                  datavalue: { type: "time", value: { time: "-0500-01-01T00:00:00Z" } },
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
      return jsonResponse({ entities: Object.fromEntries(requested.map((id) => [id, { id }])) });
    });
    expect(Object.keys(await getEntities([...ids, ids[0]]))).toEqual(ids);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(jsonResponse({ entities: { Q1000: { id: "Q1000" } } }));
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(getEntities(ids)).rejects.toMatchObject({ data: { code: "wikidata_error" } });
  });

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

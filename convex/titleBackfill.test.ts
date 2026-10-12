import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { patchArtworkContent, readArtworkContent } from "./lib/artworkContent";
import { jsonResponse } from "./lib/labelFixtures";
import { harness, type Harness } from "./test.helpers";

type Entity = { labels?: Record<string, string>; titles?: [string, string, string?][] };

// Items as wbgetentities describes them; an id without one answers as missing, like a deleted item.
let items: Record<string, Entity> = {};
const fetchMock = vi.fn<typeof fetch>();

function answer(input: RequestInfo | URL): Response {
  const ids = new URL(String(input)).searchParams.get("ids")?.split("|") ?? [];
  return jsonResponse({
    entities: Object.fromEntries(
      ids.map((id) => {
        const item = items[id];
        if (!item) return [id, { id, missing: "" }];
        const labels = Object.fromEntries(
          Object.entries(item.labels ?? {}).map(([language, value]) => [language, { language, value }]),
        );
        const claims = {
          P1476: (item.titles ?? []).map(([text, language, rank = "normal"]) => ({
            rank,
            mainsnak: { snaktype: "value", datavalue: { type: "monolingualtext", value: { text, language } } },
          })),
        };
        return [id, { id, labels, claims }];
      }),
    ),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  items = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => answer(input));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A null Wikidata id seeds a work without one.
function seed(t: Harness, title: string, wikidataId: string | null = title) {
  return t.run((ctx) =>
    ctx.db.insert("artworks", {
      identityStatus: "established",
      key: `wikidata:${wikidataId ?? title}`,
      wikidataId: wikidataId ?? undefined,
      title,
      artist: "Thomas Fearnley",
      rightsStatus: "public_domain",
      multiplicity: "unique",
      enrichGeneration: 0,
    }),
  );
}

async function backfill(t: Harness, args: { dryRun?: boolean } = {}) {
  const first = await t.action(internal.titleBackfill.run, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return first;
}

async function titles(t: Harness, ids: Id<"artworks">[]) {
  return t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.get("artworks", id))?.title)));
}

function requestedIds() {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("ids"));
}

it("titles each work named by its item ID from Wikidata, in the corpus pipeline's order", async () => {
  items = {
    Q103036181: {
      titles: [
        ["Kronborg (wrong)", "en", "deprecated"],
        ["Helsingør mod Kronborg, vinter", "da"],
      ],
    },
    Q2: { labels: { da: "Vinter", en: "Winter at Kronborg" }, titles: [["Vinter ved Kronborg", "da"]] },
    Q3: { labels: { nb: "Vinter", fr: "Hiver" } },
    Q4: { labels: { mul: "Kronborg", de: "Winter" }, titles: [["Vinter", "da"]] },
    Q5: { labels: { da: "Q5" } },
    Q8: {},
  };
  const t = harness();
  const ids = [
    await seed(t, "Q103036181"),
    await seed(t, "Q2"),
    await seed(t, "Q3"),
    await seed(t, "Q4"),
    await seed(t, "Q5"),
    await seed(t, "Q6"),
    await seed(t, "Water Lilies", "Q7"),
    await seed(t, "Q8", null),
  ];

  expect(await backfill(t)).toEqual({
    scanned: 8,
    unlabeled: 7,
    retitled: 4,
    untitled: 2,
    unresolved: 1,
    isDone: true,
  });

  expect(await titles(t, ids)).toEqual([
    "Helsingør mod Kronborg, vinter",
    "Winter at Kronborg",
    "Hiver",
    "Kronborg",
    "Untitled",
    // Wikidata no longer has the item, so nothing says what the work is called.
    "Q6",
    "Water Lilies",
    "Untitled",
  ]);
  expect(requestedIds()).toEqual(["Q103036181|Q2|Q3|Q4|Q5|Q6|Q8"]);
  const [url, init] = fetchMock.mock.calls[0];
  const query = new URL(String(url)).searchParams;
  expect(query.get("props")).toBe("labels|claims");
  expect(query.get("languages")).toBeNull();
  expect(new Headers(init?.headers).get("User-Agent")).toMatch(/^artlog-bot\//);
});

it("refreshes the search text and lets research run again under the new title", async () => {
  items = { Q103036181: { titles: [["Helsingør mod Kronborg, vinter", "da"]] } };
  const t = harness();
  const [retitled, missing] = [await seed(t, "Q103036181"), await seed(t, "Q6")];
  // Research under the item ID searched the web for it and found nothing.
  await t.run(async (ctx) => {
    for (const id of [retitled, missing]) {
      await ctx.db.patch("artworks", id, { docentNoSources: true, docentFailedAt: Date.now() });
    }
  });
  await backfill(t);
  const [work, unchanged] = await t.run(async (ctx) =>
    Promise.all([ctx.db.get("artworks", retitled), ctx.db.get("artworks", missing)]),
  );
  expect(work?.searchText).toContain("kronborg");
  expect(work?.searchText).not.toContain("q103036181");
  expect(work).not.toHaveProperty("docentNoSources");
  expect(work).not.toHaveProperty("docentFailedAt");
  expect(unchanged).toMatchObject({ docentNoSources: true, docentFailedAt: expect.any(Number) });
});

it("reports a dry run without writing, and later runs look up only the works still unlabeled", async () => {
  items = { Q103036181: { titles: [["Helsingør mod Kronborg, vinter", "da"]] } };
  const t = harness();
  const ids = [await seed(t, "Q103036181"), await seed(t, "Q6")];

  expect(await backfill(t, { dryRun: true })).toMatchObject({ unlabeled: 2, retitled: 1, unresolved: 1 });
  expect(await titles(t, ids)).toEqual(["Q103036181", "Q6"]);

  await backfill(t);
  expect(await titles(t, ids)).toEqual(["Helsingør mod Kronborg, vinter", "Q6"]);

  fetchMock.mockClear();
  expect(await backfill(t)).toMatchObject({ unlabeled: 1, retitled: 0, untitled: 0, unresolved: 1 });
  expect(requestedIds()).toEqual(["Q6"]);
  expect(await titles(t, ids)).toEqual(["Helsingør mod Kronborg, vinter", "Q6"]);
});

it("discards unsuccessful research and rejects an old run after a title correction", async () => {
  const t = harness();
  const artworkId = await seed(t, "Q1");
  const generation = (await t.mutation(internal.docent.claim, { artworkId }))!;
  const factSheet = [
    {
      id: "f1",
      text: "Creator: Thomas Fearnley",
      sourceUrl: "https://www.wikidata.org/wiki/Q1",
      sourceLabel: "Wikidata",
      sourceScore: 0.8,
    },
  ];
  await t.mutation(internal.docent.saveResearch, { artworkId, generation, factSheet });
  await t.mutation(internal.docent.fail, { artworkId, generation, noSources: true });
  await t.mutation(internal.titleBackfill.applyTitles, {
    changes: [{ artworkId, unlabeled: "Q1", title: "Winter at Kronborg" }],
  });
  const context = await t.query(internal.docent.load, { artworkId });
  expect(context?.artwork.enrichGeneration).toBeGreaterThan(generation);
  expect(context?.artwork.factSheetUpdatedAt).toBeUndefined();
  expect(context?.content?.factSheet).toBeUndefined();
  expect(await t.mutation(internal.docent.saveResearch, { artworkId, generation, factSheet })).toBe(false);
  expect(await t.mutation(internal.docent.writeEnrichment, { artworkId, generation, docentEn: [] })).toBe(false);
  expect(await t.mutation(internal.docent.claim, { artworkId })).not.toBeNull();
});

it.each(["written", "held for review"])("preserves research that is %s when correcting a title", async (state) => {
  const t = harness();
  const artworkId = await seed(t, "Q1");
  const factSheet = [
    {
      id: "f1",
      text: "The artist painted the harbor during the winter.",
      sourceUrl: "https://www.wikidata.org/wiki/Q1",
      sourceLabel: "Wikidata",
      sourceScore: 0.8,
    },
  ];
  const content = {
    factSheet,
    ...(state === "written" ? { docent: { en: [{ sentence: factSheet[0].text, factIds: ["f1"] }] } } : {}),
  };
  await t.run(async (ctx) => {
    await patchArtworkContent(ctx, { _id: artworkId }, content);
    await ctx.db.patch("artworks", artworkId, {
      factSheetUpdatedAt: 5,
      factSheetNeedsReview: state === "held for review" || undefined,
    });
  });
  await t.mutation(internal.titleBackfill.applyTitles, {
    changes: [{ artworkId, unlabeled: "Q1", title: "Winter at Kronborg" }],
  });
  await t.run(async (ctx) => {
    const work = (await ctx.db.get("artworks", artworkId))!;
    expect(work.factSheetUpdatedAt).toBe(5);
    expect(work.factSheetNeedsReview).toBe(state === "held for review" || undefined);
    expect(await readArtworkContent(ctx, work)).toMatchObject(content);
  });
});

it("never replaces a title that is no longer the item ID it was read as", async () => {
  const t = harness();
  const [renamed, named] = [await seed(t, "Q2"), await seed(t, "Water Lilies", "Q7")];
  const applied = await t.mutation(internal.titleBackfill.applyTitles, {
    changes: [
      { artworkId: renamed, unlabeled: "Q1", title: "Winter" },
      { artworkId: named, unlabeled: "Water Lilies", title: "Winter" },
    ],
  });
  expect(applied).toEqual([]);
  expect(await titles(t, [renamed, named])).toEqual(["Q2", "Water Lilies"]);
});

it("walks every page of artworks", async () => {
  items = { Q103036181: { titles: [["Helsingør mod Kronborg, vinter", "da"]] } };
  const t = harness();
  await t.run(async (ctx) => {
    for (let index = 0; index < 1000; index++) {
      await ctx.db.insert("artworks", {
        identityStatus: "established",
        key: `met:${index}`,
        title: `Study ${index}`,
        artist: "Thomas Fearnley",
        rightsStatus: "public_domain",
        multiplicity: "unique",
        enrichGeneration: 0,
      });
    }
  });
  const last = await seed(t, "Q103036181");

  expect(await backfill(t)).toMatchObject({ scanned: 1000, unlabeled: 0, isDone: false });
  expect(await titles(t, [last])).toEqual(["Helsingør mod Kronborg, vinter"]);
});

it("retries failed lookups, and after three failures leaves the page's works for a later run", async () => {
  items = { Q103036181: { titles: [["Helsingør mod Kronborg, vinter", "da"]] } };
  const t = harness();
  const id = await seed(t, "Q103036181");
  fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(new TypeError("fetch failed"));
  await backfill(t);
  expect(await titles(t, [id])).toEqual(["Helsingør mod Kronborg, vinter"]);

  const failing = harness();
  const unlucky = await seed(failing, "Q103036181");
  fetchMock.mockClear();
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  await backfill(failing);
  expect(await titles(failing, [unlucky])).toEqual(["Q103036181"]);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

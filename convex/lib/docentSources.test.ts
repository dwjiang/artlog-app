import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ActionCtx } from "../_generated/server";
import { articDescription } from "./artic";
import { gatherSources, trimSources } from "./docentSources";
import { reportBackendError } from "./observability";
import { applyReferenceReview, referenceReviewInput } from "./referenceReview";
import { sourceScore } from "./sourceScores";
import { extractWithCredit, searchWithCredit } from "./tavilySpend";
import { fetchVenuePage } from "./venueFetch";
import { commonsFileHtml, findEntityByStatement, getEntity, wikipediaArticle } from "./wikidata";

vi.mock("./artic", () => ({ articDescription: vi.fn<typeof articDescription>() }));
vi.mock("./observability", () => ({ reportBackendError: vi.fn<typeof reportBackendError>() }));
vi.mock("./tavilySpend", () => ({
  searchWithCredit: vi.fn<typeof searchWithCredit>(),
  extractWithCredit: vi.fn<typeof extractWithCredit>(),
}));
vi.mock("./venueFetch", async (original) => ({
  ...(await original<typeof import("./venueFetch")>()),
  fetchVenuePage: vi.fn<typeof fetchVenuePage>(),
}));
vi.mock("./wikidata", async (original) => ({
  ...(await original<typeof import("./wikidata")>()),
  commonsFileHtml: vi.fn<typeof commonsFileHtml>(),
  findEntityByStatement: vi.fn<typeof findEntityByStatement>(),
  getEntity: vi.fn<typeof getEntity>(),
  wikipediaArticle: vi.fn<typeof wikipediaArticle>(),
}));

const pageUrl = "https://www.metmuseum.org/art/collection/search/1";
const input = {
  artwork: { title: "Painting", artist: "Artist" },
  owner: { name: "Museum", website: "https://www.metmuseum.org" },
  pageUrl,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(findEntityByStatement).mockResolvedValue(null);
  vi.mocked(getEntity).mockResolvedValue(null);
  vi.mocked(wikipediaArticle).mockResolvedValue("");
  vi.mocked(articDescription).mockResolvedValue("");
  vi.mocked(searchWithCredit).mockResolvedValue({
    images: [],
    results: [{ url: pageUrl, title: "Painting", content: "Verified museum description", score: 1, images: [] }],
  });
});
afterEach(() => vi.restoreAllMocks());

it("uses search evidence when a museum blocks the optional owner page without reporting an app failure", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  const result = await gatherSources({} as ActionCtx, input);
  expect(result).toMatchObject({
    failures: 1,
    sources: [{ url: pageUrl, text: "Painting\nVerified museum description" }],
  });
  expect(reportBackendError).not.toHaveBeenCalled();
});

it("keeps a blocked source retryable if search provides no usable evidence", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  vi.mocked(searchWithCredit).mockResolvedValue({ results: [], images: [] });
  expect(await gatherSources({} as ActionCtx, input)).toEqual({ sources: [], failures: 1 });
});

it.each(["https://www.artic.edu/artworks/16568", "https://www.artic.edu/artworks/16568/water-lilies"])(
  "uses Chicago search evidence for the same artwork number when the owner URL is %s",
  async (ownerUrl) => {
    vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
    const matchingUrl = "https://www.artic.edu/artworks/16568/water-lilies?utm_source=search";
    const articleUrl = "https://www.artic.edu/articles/862/color-chemistry-and-creativity-in-monets-water-lilies";
    vi.mocked(searchWithCredit).mockResolvedValue({
      images: [],
      results: [
        { url: matchingUrl, title: "Water Lilies", content: "Description of this painting.", score: 1, images: [] },
        {
          url: "https://www.artic.edu/artworks/16569/water-lilies",
          title: "Water Lilies",
          content: "A different painting with the same title.",
          score: 1,
          images: [],
        },
        {
          url: articleUrl,
          title: "Conservation",
          content: "Research about [this painting](/artworks/16568/water-lilies).",
          score: 1,
          images: [],
        },
      ],
    });
    const result = await gatherSources({} as ActionCtx, {
      artwork: { title: "Water Lilies", artist: "Claude Monet" },
      owner: { name: "Art Institute of Chicago", website: "https://www.artic.edu" },
      pageUrl: ownerUrl,
    });
    expect(result.sources.map(({ url }) => url)).toEqual([matchingUrl, articleUrl]);
    expect(result.failures).toBe(1);
  },
);

const found = (url: string, content: string) => ({ url, title: "", content, score: 1, images: [] });

it("searches the verified owner's sites and accepts its artwork even outside the static domain list", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  const url = "https://collection.museum.example/work/1";
  vi.mocked(searchWithCredit).mockResolvedValue({
    images: [],
    results: [found(url, "Curatorial research. ".repeat(100))],
  });
  const result = await gatherSources({} as ActionCtx, {
    artwork: { title: "Harbor", artist: "Jane Painter" },
    owner: {
      name: "Museum",
      website: "https://museum.example",
      collectionSiteUrl: "https://collection.museum.example",
    },
    pageUrl: url,
  });
  expect(result.sources).toEqual([expect.objectContaining({ url, score: 1 })]);
  expect(searchWithCredit).toHaveBeenCalledTimes(1);
  expect(searchWithCredit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      includeDomains: expect.arrayContaining([
        "museum.example",
        "sfmoma.org",
        "famsf.org",
        "asianart.org",
        "bampfa.org",
      ]),
    }),
  );
  expect(sourceScore("https://shop.museum.example/work/1", ["museum.example"])).toBeNull();
  expect(sourceScore("https://museum.example.evil.test/work/1", ["museum.example"])).toBeNull();
});

it("makes one accession fallback for thin research and accepts an owner essay without a hyperlink", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  const url = "https://www.sfmoma.org/essay/harbor";
  vi.mocked(searchWithCredit)
    .mockResolvedValueOnce({ images: [], results: [] })
    .mockResolvedValueOnce({
      images: [],
      results: [found(url, "Harbor by Jane Painter. Accession 1987.1. The blue paint was applied in broad strokes.")],
    });
  const result = await gatherSources({} as ActionCtx, {
    artwork: { title: "Harbor", artist: "Jane Painter" },
    owner: { name: "SFMOMA", website: "https://www.sfmoma.org" },
    pageUrl: "https://www.sfmoma.org/artwork/1987.1",
    accession: "1987.1",
  });
  expect(result.sources.map((source) => source.url)).toEqual([url]);
  expect(searchWithCredit).toHaveBeenCalledTimes(2);
  expect(vi.mocked(searchWithCredit).mock.calls[1][1].query).toContain('"1987.1"');
});

it("rejects same-title essays with a different accession, artist, or museum", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  vi.mocked(searchWithCredit).mockResolvedValue({
    images: [],
    results: [
      found("https://www.sfmoma.org/essay/other-number", "Harbor by Jane Painter. Accession 1987.10."),
      found("https://www.sfmoma.org/essay/other-part", "Harbor by Jane Painter. Accession 1987.1.2."),
      found("https://www.sfmoma.org/artwork/other-work", "Related work: Harbor by Jane Painter. Accession 1987.1."),
      found("https://www.sfmoma.org/essay/other-artist", "Harbor by John Painter. Accession 1987.1."),
      found("https://www.metmuseum.org/essays/other-museum", "Harbor by Jane Painter. Accession 1987.1."),
    ],
  });
  const result = await gatherSources({} as ActionCtx, {
    artwork: { title: "Harbor", artist: "Jane Painter" },
    owner: { name: "SFMOMA", website: "https://www.sfmoma.org" },
    pageUrl: "https://www.sfmoma.org/artwork/1987.1",
    accession: "1987.1",
  });
  expect(result.sources).toEqual([]);
});

it("retains accepted evidence when the optional fallback is capped or unavailable", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  vi.mocked(searchWithCredit)
    .mockResolvedValueOnce({ images: [], results: [found(pageUrl, "The painting was made outdoors.")] })
    .mockResolvedValueOnce(null);
  const result = await gatherSources({} as ActionCtx, input);
  expect(result.sources).toEqual([expect.objectContaining({ url: pageUrl, text: "The painting was made outdoors." })]);
  expect(searchWithCredit).toHaveBeenCalledTimes(2);
});

it("does not retry a failed first search or accept unbound results from the fallback", async () => {
  vi.mocked(searchWithCredit).mockResolvedValue(null);
  const bare = { artwork: { title: "Harbor", artist: "Jane Painter" }, owner: null };
  expect((await gatherSources({} as ActionCtx, bare)).sources).toEqual([]);
  expect(searchWithCredit).toHaveBeenCalledTimes(1);
  vi.mocked(searchWithCredit)
    .mockClear()
    .mockResolvedValueOnce({ images: [], results: [] })
    .mockResolvedValueOnce({
      images: [],
      results: [found("https://www.metmuseum.org/essays/harbor", "An unrelated harbor painting.")],
    });
  expect((await gatherSources({} as ActionCtx, bare)).sources).toEqual([]);
});

it("uses a linked local-language article and alternate title when English research is missing", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "qr_host_not_allowed" }));
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q1",
    labels: { en: { value: "Harbor" }, fr: { value: "Le Port" } },
    sitelinks: { frwiki: { title: "Le Port (tableau)" } },
  });
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  vi.mocked(wikipediaArticle).mockResolvedValue("Le tableau représente un port.");
  const result = await gatherSources({} as ActionCtx, {
    ...wikidataWork("Q1"),
    artwork: { title: "Harbor", artist: "Jane Painter", wikidataId: "Q1" },
  });
  expect(wikipediaArticle).toHaveBeenCalledWith("Le Port (tableau)", "fr");
  expect(result.sources).toContainEqual(
    expect.objectContaining({
      url: "https://fr.wikipedia.org/wiki/Le_Port_(tableau)",
      text: "Le tableau représente un port.",
    }),
  );
  expect(searchWithCredit).toHaveBeenCalledTimes(2);
  expect(vi.mocked(searchWithCredit).mock.calls[1][1].query).toContain('"Le Port"');
});
// Wikidata-sourced objects link their Wikidata item, which the owner-page fetch refuses.
const wikidataWork = (wikidataId: string) => ({
  artwork: { title: "Painting", artist: "Artist", wikidataId },
  owner: { name: "Museum", website: "https://museum.example" },
  pageUrl: `https://www.wikidata.org/wiki/${wikidataId}`,
});

it("reads the English Wikipedia article Wikidata links to the work and keeps its own summary", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "qr_host_not_allowed" }));
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q185372",
    labels: { en: { value: "Girl with a Pearl Earring" } },
    sitelinks: { enwiki: { title: "Girl with a Pearl Earring" } },
  });
  vi.mocked(wikipediaArticle).mockResolvedValue("It is signed IVMeer but not dated.");
  const article = "https://en.wikipedia.org/wiki/Girl_with_a_Pearl_Earring";
  vi.mocked(searchWithCredit).mockResolvedValue({
    images: [],
    results: [
      found(
        article,
        `It is signed IVMeer[[1]](${article}#cite_note-1) but not dated.\n${"Jump to content. ".repeat(20)}`,
      ),
      found("https://www.wikidata.org/wiki/Q185372", "| depicts | girl |\n".repeat(50)),
      found("https://en.wikipedia.org/wiki/Girl_with_a_Pearl_Earring_(film)", "A 2003 film."),
      found("https://www.metmuseum.org/art/collection/search/437879", "Study of a Young Woman, another tronie."),
    ],
  });
  expect(await gatherSources({} as ActionCtx, wikidataWork("Q185372"))).toEqual({
    failures: 0,
    sources: [
      {
        url: "https://www.wikidata.org/wiki/Q185372",
        label: "Wikidata",
        score: 0.8,
        text: "Label: Girl with a Pearl Earring",
      },
      { url: article, label: "Wikipedia", score: 0.7, text: "It is signed IVMeer but not dated." },
    ],
  });
  expect(wikipediaArticle).toHaveBeenCalledWith("Girl with a Pearl Earring", "en");
});

it("keeps the sheet retryable when the linked Wikipedia article can't be read", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "qr_host_not_allowed" }));
  vi.mocked(getEntity).mockResolvedValue({ id: "Q1", sitelinks: { enwiki: { title: "Painting" } } });
  const error = new ConvexError({ code: "wikidata_error", reason: "http_503" });
  vi.mocked(wikipediaArticle).mockRejectedValue(error);
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  expect(await gatherSources({} as ActionCtx, wikidataWork("Q1"))).toEqual({ sources: [], failures: 1 });
  expect(reportBackendError).toHaveBeenCalledWith(error, "docent.wikipedia");
});

it("keeps search's copy of the linked Wikipedia article when the direct read has no text", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "qr_host_not_allowed" }));
  vi.mocked(getEntity).mockResolvedValue({ id: "Q1", sitelinks: { enwiki: { title: "Painting" } } });
  const article = "https://en.wikipedia.org/wiki/Painting";
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [found(article, "Painted in oil.")] });
  const result = await gatherSources({} as ActionCtx, wikidataWork("Q1"));
  expect(result.sources.map(({ url, text }) => [url, text])).toEqual([[article, "Painted in oil."]]);
});

it.each([
  [
    "P3634",
    "437881",
    "https://www.metmuseum.org/art/collection/search/437881?lang=en",
    "/art/collection/search/437880",
  ],
  ["P4610", "28560", "https://www.artic.edu/artworks/28560/the-bedroom", "/artworks/28561/the-bedroom"],
])("uses the collection page for the work's %s object id", async (property, objectId, page, otherPath) => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "qr_host_not_allowed" }));
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q1",
    claims: { [property]: [{ mainsnak: { snaktype: "value", datavalue: { value: objectId } } }] },
  });
  vi.mocked(searchWithCredit).mockResolvedValue({
    images: [],
    results: [
      found(page, "This painting."),
      found(new URL(otherPath, page).href, "Another painting with the same title."),
    ],
  });
  const result = await gatherSources({} as ActionCtx, wikidataWork("Q1"));
  expect(result.sources.map(({ url }) => url)).toEqual([page]);
});

const chicagoWork = {
  artwork: { title: "The Bedroom", artist: "Vincent van Gogh" },
  owner: { name: "Art Institute of Chicago", website: "https://www.artic.edu" },
  pageUrl: "https://www.artic.edu/artworks/28560",
};

it("finds the Wikidata item of a Chicago work by its object id and reads the museum's API text", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  vi.mocked(findEntityByStatement).mockResolvedValue("Q18713076");
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q18713076",
    labels: { en: { value: "The Bedroom" } },
    sitelinks: { enwiki: { title: "Bedroom in Arles" } },
  });
  vi.mocked(wikipediaArticle).mockResolvedValue("Van Gogh painted three versions.");
  vi.mocked(articDescription).mockResolvedValue("Perhaps the most famous depiction of a bedroom.");
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  const result = await gatherSources({} as ActionCtx, chicagoWork);
  expect(result.sources.map(({ url, label, text }) => [url, label, text])).toEqual([
    [
      "https://www.artic.edu/artworks/28560",
      "Art Institute of Chicago",
      "Perhaps the most famous depiction of a bedroom.",
    ],
    ["https://www.wikidata.org/wiki/Q18713076", "Wikidata", "Label: The Bedroom"],
    ["https://en.wikipedia.org/wiki/Bedroom_in_Arles", "Wikipedia", "Van Gogh painted three versions."],
  ]);
  expect(findEntityByStatement).toHaveBeenCalledWith("P4610", "28560");
  expect(articDescription).toHaveBeenCalledWith("28560");
});

it("finds the Wikidata item of a Met work by its object id", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_429" }));
  vi.mocked(findEntityByStatement).mockResolvedValue("Q18689458");
  vi.mocked(getEntity).mockResolvedValue({ id: "Q18689458", labels: { en: { value: "Wheat Field with Cypresses" } } });
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  const result = await gatherSources({} as ActionCtx, {
    artwork: { title: "Wheat Field with Cypresses", artist: "Vincent van Gogh" },
    owner: { name: "The Met", website: "https://www.metmuseum.org" },
    pageUrl: "https://www.metmuseum.org/art/collection/search/436535",
  });
  expect(result.sources.map(({ url }) => url)).toEqual(["https://www.wikidata.org/wiki/Q18689458"]);
  expect(findEntityByStatement).toHaveBeenCalledWith("P3634", "436535");
  expect(articDescription).not.toHaveBeenCalled();
});

it("keeps the sheet retryable when Chicago's API can't be read", async () => {
  vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
  vi.mocked(findEntityByStatement).mockResolvedValue(null);
  const error = new ConvexError({ code: "artic_error", reason: "http_503" });
  vi.mocked(articDescription).mockRejectedValue(error);
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  expect(await gatherSources({} as ActionCtx, chicagoWork)).toEqual({ sources: [], failures: 2 });
  expect(reportBackendError).toHaveBeenCalledWith(error, "docent.artic");
});

it.each([new ConvexError({ code: "page_unavailable", reason: "http_503" }), new TypeError("unexpected failure")])(
  "reports unexpected owner-page failures while still using search evidence: %s",
  async (error) => {
    vi.mocked(fetchVenuePage).mockRejectedValue(error);
    expect((await gatherSources({} as ActionCtx, input)).sources).toHaveLength(1);
    expect(reportBackendError).toHaveBeenCalledWith(error, "docent.ownerPage");
  },
);

const source = (url: string, score: number, text: string) => ({ url, label: url, score, text });
const quoted = "Van Gogh painted this wheat field with cypresses in late June 1889 while at the asylum in Saint-Rémy.";
const remark = "Critics admired it when it was first shown in Paris, and the museum bought it a century later.";

it("keeps a repeated passage only in the best-scored source and leaves short lines everywhere", () => {
  const owner = source("https://museum.example/work", 1, `Title\n${quoted}\nBought in 1993 with a gift.`);
  const article = source("https://en.wikipedia.org/wiki/Work", 0.7, `Title\n“${quoted}”\n${remark}`);
  expect(trimSources([owner, article])).toEqual([owner, { ...article, text: `Title\n${remark}` }]);
});

it("drops a source left with nothing of its own", () => {
  const owner = source("https://museum.example/work", 1, quoted);
  expect(trimSources([owner, source("https://mirror.example/work", 0.7, quoted)])).toEqual([owner]);
});

it("stops the text sent at the budget, best sources first", () => {
  const long = (letter: string) => letter.repeat(30_000);
  const trimmed = trimSources([source("a", 1, long("a")), source("b", 0.9, long("b")), source("c", 0.8, long("c"))]);
  expect(trimmed.map(({ url, text }) => [url, text.length])).toEqual([
    ["a", 30_000],
    ["b", 10_000],
  ]);
});

it("follows only known-item citations without expanding search domains or crawling extracted links", async () => {
  const cited = "https://auction.example/lot/1";
  const text = "A catalogue essay for the target painting. ".repeat(5);
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q1",
    claims: {
      P18: [{ mainsnak: { datavalue: { value: "Painting.jpg" } } }],
      P170: [{ references: [{ snaks: { P854: [{ datavalue: { value: cited } }] } }] }],
    },
  });
  vi.mocked(commonsFileHtml).mockResolvedValue(
    `<table><tr><td id="fileinfotpl_art_references">References</td><td><a href="${cited}">Lot</a></td></tr></table><a href="https://unrelated.example/2">Artist</a>`,
  );
  vi.mocked(searchWithCredit).mockResolvedValue({ images: [], results: [] });
  vi.mocked(extractWithCredit).mockResolvedValue({
    results: [
      { url: cited, text },
      { url: "https://unrequested.example/3", text },
    ],
    failures: 0,
  });
  const result = await gatherSources({} as ActionCtx, {
    artwork: { title: "Painting", artist: "Artist", wikidataId: "Q1" },
    owner: null,
  });
  expect(extractWithCredit).toHaveBeenCalledExactlyOnceWith({}, [cited]);
  expect(result.sources).toEqual([
    {
      url: cited,
      referenceUrl: "https://www.wikidata.org/wiki/Q1",
      label: "auction.example",
      score: 0.8,
      text: text.trim(),
    },
  ]);
  expect(
    vi.mocked(searchWithCredit).mock.calls.every(([, request]) => !request.includeDomains.includes("auction.example")),
  ).toBe(true);
});

it.each(["owner", "search"])(
  "reviews a citation already fetched through %s without extracting it again",
  async (via) => {
    const text =
      "Painting. Follower of Artist. Oil on panel, 26 cm. Provenance includes the original gallery collection.";
    vi.mocked(getEntity).mockResolvedValue({
      id: "Q1",
      claims: {
        P170: [{ references: [{ snaks: { P854: [{ datavalue: { value: `${pageUrl}?utm_source=wiki` } }] } }] }],
      },
    });
    if (via === "owner") {
      vi.mocked(fetchVenuePage).mockResolvedValue({ url: pageUrl, html: `<main>${text}</main>` });
      vi.mocked(searchWithCredit).mockResolvedValue({ results: [], images: [] });
    } else {
      vi.mocked(fetchVenuePage).mockRejectedValue(new ConvexError({ code: "page_unavailable", reason: "http_403" }));
      vi.mocked(searchWithCredit).mockResolvedValue({
        results: [{ url: pageUrl, title: "Painting", content: text, score: 1, images: [] }],
        images: [],
      });
    }
    const artwork = { ...input.artwork, wikidataId: "Q1" };
    const { sources } = await gatherSources({} as ActionCtx, { ...input, artwork });
    expect(referenceReviewInput(sources, artwork).references).toEqual([
      expect.objectContaining({ url: pageUrl, referenceUrl: "https://www.wikidata.org/wiki/Q1" }),
    ]);
    expect(extractWithCredit).not.toHaveBeenCalled();
  },
);

it("keeps every reference for review without displacing catalogue research", async () => {
  const citations = Array.from({ length: 5 }, (_, index) => `https://auction.example/lot/${index}`);
  const article = "The painting depicts the harbor where the artist spent the summer working outdoors.";
  vi.mocked(getEntity).mockResolvedValue({
    id: "Q1",
    sitelinks: { enwiki: { title: "Painting" } },
    claims: { P170: [{ references: [{ snaks: { P854: citations.map((value) => ({ datavalue: { value } })) } }] }] },
  });
  vi.mocked(wikipediaArticle).mockResolvedValue(article);
  vi.mocked(searchWithCredit).mockResolvedValue({ results: [], images: [] });
  vi.mocked(extractWithCredit).mockResolvedValue({
    results: citations.map((url, index) => ({ url, text: String(index).repeat(24_000) })),
    failures: 0,
  });
  const artwork = { title: "Painting", artist: "Artist", wikidataId: "Q1" };
  const { sources } = await gatherSources({} as ActionCtx, { artwork, owner: null });
  const input = referenceReviewInput(sources, artwork);
  expect(input.references).toHaveLength(5);
  expect(input.catalogue).toEqual([{ url: "https://en.wikipedia.org/wiki/Painting", text: article }]);
  const reviews = input.references.map(({ source }) => ({
    source,
    relation: "other",
    evidence: "",
    comparison: "The page describes a different painting.",
    conflicts: [],
  }));
  expect(trimSources(applyReferenceReview({ reviews }, sources).sources)).toEqual([
    expect.objectContaining({ text: article }),
  ]);
});

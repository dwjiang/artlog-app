import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ActionCtx } from "../_generated/server";
import { gatherSources, trimSources } from "./docentSources";
import { reportBackendError } from "./observability";
import { searchWithCredit } from "./tavilySpend";
import { fetchVenuePage } from "./venueFetch";

vi.mock("./observability", () => ({ reportBackendError: vi.fn<typeof reportBackendError>() }));
vi.mock("./tavilySpend", () => ({ searchWithCredit: vi.fn<typeof searchWithCredit>() }));
vi.mock("./venueFetch", async (original) => ({
  ...(await original<typeof import("./venueFetch")>()),
  fetchVenuePage: vi.fn<typeof fetchVenuePage>(),
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

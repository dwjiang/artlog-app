import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ActionCtx } from "../_generated/server";
import { gatherSources } from "./docentSources";
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

it.each([new ConvexError({ code: "page_unavailable", reason: "http_503" }), new TypeError("unexpected failure")])(
  "reports unexpected owner-page failures while still using search evidence: %s",
  async (error) => {
    vi.mocked(fetchVenuePage).mockRejectedValue(error);
    expect((await gatherSources({} as ActionCtx, input)).sources).toHaveLength(1);
    expect(reportBackendError).toHaveBeenCalledWith(error, "docent.ownerPage");
  },
);

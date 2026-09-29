import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { articDescription } from "./artic";
import { jsonResponse } from "./labelFixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("reads the curatorial text as plain paragraphs that keep inline punctuation", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      data: {
        description:
          "<p>This vibrant painting documents Van Gogh&#8217;s room in <em>Arles</em>, France.</p>\n<p>He made three versions.</p>",
        short_description: 'In 1888, Van Gogh moved into the <a href="/x">Yellow House</a>.',
      },
    }),
  );
  expect(await articDescription("28560")).toBe(
    "This vibrant painting documents Van Gogh’s room in Arles, France.\nHe made three versions.\nIn 1888, Van Gogh moved into the Yellow House.",
  );
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("https://api.artic.edu/api/v1/artworks/28560?fields=description,short_description");
  expect(new Headers(init?.headers).get("AIC-User-Agent")).toMatch(/^artlog-bot\//);
});

it("returns nothing for an artwork without text or an unknown id", async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ data: { description: null, short_description: null } }))
    .mockResolvedValueOnce(new Response("{}", { status: 404 }));
  expect(await articDescription("1")).toBe("");
  expect(await articDescription("2")).toBe("");
});

it("surfaces server failures so the fact sheet is retried", async () => {
  fetchMock.mockResolvedValue(new Response("", { status: 503 }));
  await expect(articDescription("28560")).rejects.toMatchObject({ data: { code: "artic_error", reason: "http_503" } });
});

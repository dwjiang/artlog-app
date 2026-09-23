import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowedVenueUrl, fetchVenuePage, hostAllowed, venueHosts } from "./venueFetch";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const venue = {
  website: "https://www.museum.example/",
  collectionSiteUrl: "https://collection.museum.example/objects/",
};

describe("venue-scoped fetching", () => {
  it("derives bare hosts from the venue sites, ignoring invalid ones", () => {
    expect(venueHosts(venue)).toEqual(["museum.example", "collection.museum.example"]);
    expect(
      venueHosts({ website: "http://127.0.0.1/", collectionSiteUrl: "ftp://x.example/" }),
    ).toEqual([]);
    expect(venueHosts({})).toEqual([]);
  });

  it.each([
    ["https://www.museum.example/objects/1", true],
    ["https://museum.example/objects/1", true],
    ["https://emuseum.museum.example/objects/1", true],
    ["https://lookup.example/art/1917.42", false],
    ["https://museum.example.evil.test/objects/1", false],
    ["https://notmuseum.example/objects/1", false],
    ["http://museum.example/objects/1", false],
    ["https://user:pw@museum.example/objects/1", false],
    ["https://museum.example:8443/objects/1", false],
    ["file:///etc/passwd", false],
  ])("allows %s → %s", (url, allowed) => {
    expect(allowedVenueUrl(url, venueHosts(venue)) !== null).toBe(allowed);
  });

  it("never fetches a host outside the venue", async () => {
    await expect(fetchVenuePage("https://evil.example/", venueHosts(venue))).rejects.toMatchObject({
      data: { code: "qr_host_not_allowed" },
    });
    expect(hostAllowed(new URL("https://evil.example/"), [])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows same-host redirects with manual redirect handling and returns the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "/objects/12" } }),
      )
      .mockResolvedValueOnce(new Response("<title>Work</title>"));
    await expect(fetchVenuePage("https://museum.example/q/12", venueHosts(venue))).resolves.toEqual(
      {
        url: "https://museum.example/objects/12",
        html: "<title>Work</title>",
      },
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://museum.example/q/12",
      "https://museum.example/objects/12",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { "User-Agent": expect.stringContaining("artlog-bot") },
    });
  });

  it("stops at off-host redirects, redirect loops and HTTP failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(
      fetchVenuePage("https://museum.example/q", ["museum.example"]),
    ).rejects.toMatchObject({ data: { code: "page_unavailable", reason: "redirect_off_host" } });
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    await expect(
      fetchVenuePage("https://museum.example/q", ["museum.example"]),
    ).rejects.toMatchObject({ data: { reason: "too_many_redirects" } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(
      fetchVenuePage("https://museum.example/q", ["museum.example"]),
    ).rejects.toMatchObject({ data: { reason: "http_404" } });
  });

  it("times out after eight seconds and caps the body at one megabyte", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = fetchVenuePage("https://museum.example/slow", ["museum.example"]).catch(
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({
      data: { code: "page_unavailable", reason: "fetch_failed" },
    });
    vi.useRealTimers();
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)));
    await expect(
      fetchVenuePage("https://museum.example/big", ["museum.example"]),
    ).rejects.toMatchObject({ data: { reason: "fetch_failed" } });
  });
});

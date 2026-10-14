import { afterEach, describe, expect, it, vi } from "vitest";

import { politeClient } from "../../shared/exhibitions/polite-client";
import { png } from "./showImageFixtures";
import { findShowImages, previewImage, type MuseumShows } from "./showImages";

type Reply = { status?: number; type?: string; body?: string | Uint8Array; location?: string } | "network error";

const HOME = "https://www.museum.example";
const LISTING = `${HOME}/exhibitions`;
const TIDES_PAGE = `${HOME}/exhibitions/tides`;
const PAPER_PAGE = `${HOME}/exhibitions/paper`;
const TIDES_IMAGE = "https://cdn.museum.example/tides.jpg";
const PAPER_IMAGE = "https://cdn.museum.example/paper.jpg";
const TIDES = { title: "Tides of Light", sourceUrl: LISTING };
const PAPER = { title: "Paper Worlds", sourceUrl: LISTING };
const PICTURE: Reply = { type: "image/jpeg", body: png(1200, 630) };

const page = (image?: string, main = "") =>
  `<html><head>${image ? `<meta property="og:image" content="${image}">` : ""}</head><body><main>${main}</main></body></html>`;
const listing = (image?: string) =>
  page(
    image,
    `<a href="/exhibitions/tides"><img src="/t.jpg"></a><h2><a href="/exhibitions/tides">Tides of Light</a></h2>
     <h2><a href="${PAPER_PAGE}">Paper Worlds</a></h2><a href="https://tickets.example/tides">Tides of Light tickets</a>`,
  );

/** Answers each URL from `site`, treating unknown URLs as missing, and records requests. */
function lookUp(site: Record<string, Reply>, museum: Partial<MuseumShows> & Pick<MuseumShows, "due">) {
  const requests: string[] = [];
  const fetchImpl = async (url: string) => {
    requests.push(url);
    const reply = site[url] ?? { status: 404 };
    if (reply === "network error") throw new TypeError("fetch failed");
    const { status = 200, type = "text/html", body = "", location } = reply;
    const headers = new Headers({ "content-type": type, ...(location ? { location } : {}) });
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers });
  };
  let clock = 0;
  const { follow } = politeClient({
    userAgent: "artlog-bot/test",
    fetchImpl,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  const images = findShowImages(follow, { website: HOME, listingUrls: [LISTING], checked: [], ...museum });
  return { images, requests };
}

const ownPages = {
  [LISTING]: { body: listing("https://cdn.museum.example/listing.jpg") },
  [TIDES_PAGE]: { body: page(TIDES_IMAGE) },
  [PAPER_PAGE]: { body: page(PAPER_IMAGE) },
  [TIDES_IMAGE]: PICTURE,
  [PAPER_IMAGE]: PICTURE,
};

afterEach(() => vi.restoreAllMocks());

describe("show pictures", () => {
  it("takes each show's picture from the page its listing links under the show's title", async () => {
    const { images, requests } = lookUp(ownPages, { due: [TIDES, PAPER] });

    expect(await images).toEqual([{ imageUrl: TIDES_IMAGE }, { imageUrl: PAPER_IMAGE }]);
    expect(requests.filter((url) => url === LISTING)).toHaveLength(1);
    expect(requests).not.toContain("https://tickets.example/tides");
  });

  it("reads a show's own page directly when only that show cites it", async () => {
    const { images } = lookUp(
      { [TIDES_PAGE]: { body: page("/media/tides.png") }, [`${HOME}/media/tides.png`]: PICTURE },
      { due: [{ title: "Tides of Light", sourceUrl: TIDES_PAGE }] },
    );

    expect(await images).toEqual([{ imageUrl: `${HOME}/media/tides.png` }]);
  });

  it.each([`${LISTING}/`, `${HOME}/whats-on`])(
    "follows a single show's detail link when extraction cites the redirected listing %s",
    async (sourceUrl) => {
      const { images, requests } = lookUp(
        {
          ...ownPages,
          [LISTING]: { status: 301, location: sourceUrl },
          [sourceUrl]: { body: listing("https://cdn.museum.example/listing.jpg") },
        },
        { due: [{ ...TIDES, sourceUrl }] },
      );

      expect(await images).toEqual([{ imageUrl: TIDES_IMAGE }]);
      expect(requests.filter((url) => url === sourceUrl)).toHaveLength(1);
      expect(requests).toContain(TIDES_PAGE);
    },
  );

  it("keeps a named detail page's image when it also links to another page under the same title", async () => {
    const { images, requests } = lookUp(
      {
        [TIDES_PAGE]: {
          body: `<title>Tides of Light | Museum</title>${page(TIDES_IMAGE, '<a href="/shop/tides">Tides of Light</a>')}`,
        },
        [TIDES_IMAGE]: PICTURE,
      },
      { due: [{ ...TIDES, sourceUrl: TIDES_PAGE }] },
    );

    expect(await images).toEqual([{ imageUrl: TIDES_IMAGE }]);
    expect(requests).not.toContain(`${HOME}/shop/tides`);
  });

  it("follows the one link in a show's card when no link names the show, if that page names the show", async () => {
    const card = (href: string, title: string) =>
      `<div class="card"><a href="${href}"><img src="/thumb.jpg"></a><div><h2>${title}</h2><p>Through March 1</p></div></div>`;
    const { images } = lookUp(
      {
        [LISTING]: { body: page(undefined, card(TIDES_PAGE, "Tides of Light") + card(PAPER_PAGE, "Paper Worlds")) },
        [TIDES_PAGE]: { body: `<title>Tides of Light | Museum</title>${page(TIDES_IMAGE)}` },
        [PAPER_PAGE]: { body: `<title>Design a Button | Museum</title>${page(PAPER_IMAGE)}` },
        [TIDES_IMAGE]: PICTURE,
        [PAPER_IMAGE]: PICTURE,
      },
      { due: [TIDES, PAPER] },
    );

    expect(await images).toEqual([{ imageUrl: TIDES_IMAGE }, "none"]);
  });

  it("falls back to the first picture in the content of a page without a link preview", async () => {
    const hero = `${HOME}/media/tides-hero.jpg`;
    const { images } = lookUp(
      {
        [TIDES_PAGE]: {
          body: page(
            undefined,
            `<img src="/logo.svg"><img src="/icon.png" width="64" height="64">
             <img src="data:image/gif;base64,R0lGOD" data-src="/media/tides-hero.jpg"><img src="/media/other.jpg">`,
          ),
        },
        [hero]: PICTURE,
      },
      { due: [{ title: "Tides of Light", sourceUrl: TIDES_PAGE }] },
    );

    expect(await images).toEqual([{ imageUrl: hero }]);
  });

  it("treats a page several shows cite as a listing even when discovery did not record it", async () => {
    const { images } = lookUp(ownPages, { listingUrls: [], due: [TIDES], checked: [{ sourceUrl: LISTING }] });

    expect(await images).toEqual([{ imageUrl: TIDES_IMAGE }]);
  });

  it("leaves out pictures the home page, the listing or several shows also offer", async () => {
    const logo = "https://cdn.museum.example/logo.jpg";
    const banner = "https://cdn.museum.example/listing.jpg";
    const cases: { site: Record<string, Reply>; checked?: MuseumShows["checked"] }[] = [
      { site: { [`${HOME}/`]: { body: page(logo) }, [TIDES_PAGE]: { body: page(logo) } } },
      { site: { [TIDES_PAGE]: { body: page(banner) } } },
      { site: { [TIDES_PAGE]: { body: page(PAPER_IMAGE) } } },
      { site: {}, checked: [{ sourceUrl: `${HOME}/exhibitions/fog`, imageUrl: TIDES_IMAGE }] },
      { site: { [TIDES_PAGE]: { body: page("https://cdn.museum.example/sponsor-logo-og.jpg") } } },
      {
        site: {
          [`${HOME}/`]: { body: page(undefined, `<img src="${logo}">`) },
          [TIDES_PAGE]: { body: page(undefined, `<img src="${logo}"><img src="${TIDES_IMAGE}">`) },
        },
      },
    ];
    for (const { site, checked = [] } of cases) {
      const { images, requests } = lookUp({ ...ownPages, ...site }, { due: [TIDES, PAPER], checked });
      const [tides] = await images;
      expect(tides).toBe("none");
      expect(requests).not.toContain(logo);
    }
  });

  it("finds no picture for a show without a page or preview of its own we may read", async () => {
    const cases: Record<string, Reply>[] = [
      { [LISTING]: { body: page(undefined, "<h2>Tides of Light</h2>") } },
      { [TIDES_PAGE]: { status: 403 } },
      { [TIDES_PAGE]: { status: 404 } },
      { [TIDES_PAGE]: { body: page() } },
      { [TIDES_PAGE]: { status: 301, location: "https://tickets.example/tides" } },
      { [`${HOME}/robots.txt`]: { type: "text/plain", body: "User-agent: artlog-bot\nDisallow: /exhibitions/" } },
    ];
    for (const site of cases) {
      const { images } = lookUp({ ...ownPages, ...site }, { due: [TIDES] });
      expect(await images).toEqual(["none"]);
    }
  });

  it("rejects pictures that are small, vector, missing or not images", async () => {
    const cases: Reply[] = [
      { type: "image/png", body: png(120, 120) },
      { type: "image/svg+xml", body: "<svg/>" },
      { status: 404 },
      { type: "text/html", body: "<html>Not found</html>" },
      { type: "image/jpeg", body: "not an image" },
    ];
    for (const reply of cases) {
      const { images } = lookUp({ ...ownPages, [TIDES_IMAGE]: reply }, { due: [TIDES] });
      expect(await images).toEqual(["none"]);
    }
  });

  it("leaves a show for a later lookup when a page or picture is briefly unavailable", async () => {
    const cases: Record<string, Reply>[] = [
      { [TIDES_PAGE]: { status: 429 } },
      { [TIDES_PAGE]: "network error" },
      { [TIDES_IMAGE]: { status: 502 } },
      { [TIDES_IMAGE]: "network error" },
    ];
    for (const site of cases) {
      const { images } = lookUp({ ...ownPages, ...site }, { due: [TIDES, PAPER] });
      expect(await images).toEqual(["unavailable", { imageUrl: PAPER_IMAGE }]);
    }
    const { images } = lookUp({ ...ownPages, [LISTING]: { status: 503 } }, { due: [TIDES, PAPER] });
    expect(await images).toEqual(["unavailable", "unavailable"]);
  });

  it.each([HOME, "https://cdn.museum.example"])("retries temporary robots.txt failures at %s", async (origin) => {
    const failures: Reply[] = [{ status: 429 }, { status: 503 }, "network error"];
    for (const failure of failures) {
      const { images, requests } = lookUp({ ...ownPages, [`${origin}/robots.txt`]: failure }, { due: [TIDES, PAPER] });
      expect(await images).toEqual(["unavailable", "unavailable"]);
      expect(requests).not.toContain(origin === HOME ? LISTING : TIDES_IMAGE);
    }
  });

  it("finishes a slow museum's images across runs with a limited budget", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const museum: MuseumShows = {
      website: HOME,
      listingUrls: [],
      checked: [],
      due: Array.from({ length: 35 }, (_, index) => ({
        title: `Show ${index}`,
        sourceUrl: `${HOME}/exhibitions/show-${index}`,
      })),
    };
    while (museum.due.length > 0) {
      const { follow } = politeClient({
        userAgent: "artlog-bot/test",
        maxCrawlDelayS: 10,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        fetchImpl: async (url) => {
          const { pathname } = new URL(url);
          if (pathname === "/robots.txt") {
            return new Response("User-agent: artlog-bot\nCrawl-delay: 10\nAllow: /", {
              headers: { "content-type": "text/plain" },
            });
          }
          if (pathname.endsWith(".png")) {
            return new Response(new Uint8Array(png(1200, 630)), { headers: { "content-type": "image/png" } });
          }
          return new Response(page(pathname === "/" ? undefined : `${url}.png`), {
            headers: { "content-type": "text/html" },
          });
        },
      });
      const images = await findShowImages(follow, museum, clock + 5 * 60_000);
      const completed = museum.due.filter((show, index) => {
        if (images[index] === "unavailable") return false;
        expect(images[index]).toEqual({ imageUrl: `${show.sourceUrl}.png` });
        return true;
      });
      expect(completed.length).toBeGreaterThan(0);
      museum.checked.push(
        ...completed.map((show) => ({ sourceUrl: show.sourceUrl, imageUrl: `${show.sourceUrl}.png` })),
      );
      museum.due = museum.due.filter((_, index) => images[index] === "unavailable");
    }
    expect(museum.checked).toHaveLength(35);
  });

  it("leaves shows it reaches after the deadline for a later lookup", async () => {
    const { follow } = politeClient({ userAgent: "artlog-bot/test", fetchImpl: async () => new Response("") });
    const museum = { website: HOME, listingUrls: [], checked: [], due: [TIDES, PAPER] };

    expect(await findShowImages(follow, museum, Date.now() - 1)).toEqual(["unavailable", "unavailable"]);
  });
});

describe("link-preview images", () => {
  it("prefers Open Graph, resolves the image against the page and asks for it over HTTPS", () => {
    const html = `<head>
      <meta name="twitter:image" content="https://cdn.example/twitter.jpg">
      <meta content='/media/hero.jpg?w=1200&amp;h=630' property='og:image' />
    </head>`;
    expect(previewImage(html, TIDES_PAGE)).toBe("https://www.museum.example/media/hero.jpg?w=1200&h=630");
    expect(previewImage(page("http://cdn.example/a.jpg"), TIDES_PAGE)).toBe("https://cdn.example/a.jpg");
    expect(previewImage(`<meta name="twitter:image" content="https://cdn.example/t.jpg">`, TIDES_PAGE)).toBe(
      "https://cdn.example/t.jpg",
    );
    expect(previewImage(page("data:image/png;base64,AAAA"), TIDES_PAGE)).toBeUndefined();
    expect(previewImage("<head><title>No preview</title></head>", TIDES_PAGE)).toBeUndefined();
  });
});

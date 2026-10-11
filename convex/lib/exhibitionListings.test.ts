import { describe, expect, it } from "vitest";

import type { ExhibitionCandidate } from "../../shared/exhibitions/acceptance";
import {
  capturePages,
  listingHash,
  listingLinks,
  listingText,
  nextDueAt,
  retryAt,
  showPage,
  showPages,
  siteName,
  verifiedShows,
} from "./exhibitionListings";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T19:00:00Z");
const PAGE = "https://museum.example/exhibitions";

describe("listing text", () => {
  it("leads with the document title and keeps card headers and footers inside main", () => {
    const html = `<html><head><title>Exhibitions | Verified Museum</title><script>var tracking = 1;</script></head>
      <body><nav>Visit Shop Join</nav><main><article><header><h2>Tides of Light</h2></header>
      <footer>October 1 &ndash; October 31, 2026</footer></article><svg><text>icon</text></svg></main></body></html>`;
    expect(listingText(html)).toBe("Exhibitions | Verified Museum\nTides of Light October 1 – October 31, 2026");
  });

  it("falls back to the body when a page has no main region", () => {
    expect(listingText("<body><h1>On view</h1><style>h1 {}</style><p>Paper Worlds</p></body>")).toBe(
      "On view Paper Worlds",
    );
  });

  it("names the site from og:site_name, else the last part of the title", () => {
    expect(siteName(`<meta property="og:site_name" content="SFMOMA"><title>Exhibitions | Ignored</title>`)).toBe(
      "SFMOMA",
    );
    expect(siteName("<title>Current Exhibitions – Asian Art Museum</title>")).toBe("Asian Art Museum");
    expect(siteName("<title>Exhibitions</title>")).toBe("Exhibitions");
    expect(siteName("<p>No title</p>")).toBeUndefined();
  });

  it("hashes what the model would read, whatever order the listings were read in", async () => {
    const first = await capturePages(
      [
        { url: PAGE, text: "Tides of Light" },
        { url: `${PAGE}/upcoming`, text: "Paper Worlds" },
      ],
      NOW,
    );
    const later = await capturePages([first[1], first[0]], NOW + DAY);
    expect(await listingHash(later)).toBe(await listingHash(first));
    const changed = await capturePages([{ ...first[0], text: "Tides of Light, extended" }, first[1]], NOW);
    expect(await listingHash(changed)).not.toBe(await listingHash(first));
  });
});

describe("show pages", () => {
  const html = `<html><body><nav><a href="/visit">Tides of Light tickets</a></nav><main>
    <a href="/exhibitions/tides#top"><img src="tides.jpg"></a>
    <article><a href="/exhibitions/tides"><h3>Tides of Light</h3></a><p>Opening soon</p></article>
    <a href="https://museum.example/exhibitions/paper-worlds">Paper Worlds: Folded Cities</a>
    <a href="mailto:info@museum.example">Contact</a></main></body></html>`;

  it.each([
    "<h2>Related exhibitions</h2><p>Paper Worlds closes January 3, 2027</p>",
    "<h2>Paper Worlds closes January 3, 2027</h2>",
    "<h2>Related exhibitions</h2><h3>Paper Worlds</h3><h4>closes January 3, 2027</h4>",
    "<article><p>Paper Worlds closes January 3, 2027</p></article>",
    "<section><p>Paper Worlds closes January 3, 2027</p></section>",
  ])("keeps a detail page's main exhibition section separate from %s", (related) => {
    const page = showPage(`<main><h1><span>Tides of Light</span></h1>
      <p>Until October 31, 2026</p>${related}</main>`);
    expect(page.singleShow).toEqual({
      heading: "Tides of Light",
      text: "Tides of Light Until October 31, 2026",
    });
    expect(page.text).toContain("Paper Worlds closes January 3, 2027");
  });

  it("ends the exhibition's section with its enclosing article and excludes navigation and sidebars", () => {
    const page = showPage(`<body><nav><h1>Visit</h1></nav><article><header><h1>Tides of Light</h1></header>
      <aside>Paper Worlds closes January 3, 2027</aside><p>Until October 31, 2026</p></article>
      <p>Another show closes February 1, 2027</p></body>`);
    expect(page.singleShow).toEqual({
      heading: "Tides of Light",
      text: "Tides of Light Until October 31, 2026",
    });
  });

  it.each([
    ["25.09.2027 – 09.01.2028", "2027-09-25", "2028-01-09"],
    ["September 25, 2027 – January 9, 2028", "2027-09-25", "2028-01-09"],
    ["Closes Sunday, 3 January 2027", null, "2027-01-03"],
  ] as const)("accepts the show's own dates inside a subheading: %s", async (dates, startDate, endDate) => {
    const page = showPage(`<title>verzuckert | Verified Museum</title><main>
      <h1><span>verzuckert</span><span>Die Kunst des königlichen Desserts</span></h1>
      <p>An exhibition about the art of desserts.</p><div class="accordion-item">
      <h2><button><span>${dates}</span><svg><use href="#calendar"></use></svg></button></h2></div>
      <h2>Related exhibitions</h2><h3>Paper Worlds</h3><p>Until October 31, 2028</p></main>`);
    const shows = verifiedShows({
      museum: { museumId: "m1", name: "Verified Museum", timeZone: "Europe/Berlin", country: "DE", sourceUrls: [PAGE] },
      pages: await capturePages([{ url: PAGE, ...page }], NOW),
      candidates: [
        {
          title: "verzuckert",
          url: PAGE,
          startDate,
          endDate,
          titleEvidence: "verzuckert",
          venueEvidence: "Verified Museum",
          dateText: dates,
          dateEvidence: dates,
          kind: "temporary_exhibition",
          datePrecision: "day",
          venueMatch: true,
        },
      ],
      asOfDate: "2026-10-09",
    });
    expect(shows).toEqual([expect.objectContaining({ title: "verzuckert", viewingPeriods: [{ startDate, endDate }] })]);
    expect(page.singleShow?.text).not.toContain("Paper Worlds");
  });

  it("does not infer a main exhibition section from an unstructured page or its document title", () => {
    const page = showPage("<title>Tides of Light | Museum</title><p>Paper Worlds Until January 3, 2027</p>");
    expect(page.singleShow).toEqual({ heading: "", text: "" });
  });

  it("keeps names encoded as HTML entities quotable in the main section and the captured page", async () => {
    const page = showPage(`<title>Exhibition | Verified Museum</title><main>
      <h1>Ren&eacute; &amp; friends</h1><p>Until October 31, 2026</p></main>`);
    const shows = verifiedShows({
      museum: { museumId: "m1", name: "Verified Museum", timeZone: "America/Los_Angeles", sourceUrls: [PAGE] },
      pages: await capturePages([{ url: PAGE, ...page }], NOW),
      candidates: [
        {
          title: "René & friends",
          url: PAGE,
          startDate: null,
          endDate: "2026-10-31",
          titleEvidence: "René & friends",
          venueEvidence: "Verified Museum",
          dateText: "Until October 31, 2026",
          dateEvidence: "Until October 31, 2026",
          kind: "temporary_exhibition",
          datePrecision: "day",
          venueMatch: true,
        },
      ],
      asOfDate: "2026-10-09",
    });
    expect(shows.map((show) => show.title)).toEqual(["René & friends"]);
  });

  it("collects the main region's web links with their text, resolved against the page", () => {
    expect(listingLinks(html, PAGE)).toEqual([
      { url: "https://museum.example/exhibitions/tides", text: "Tides of Light" },
      { url: "https://museum.example/exhibitions/paper-worlds", text: "Paper Worlds: Folded Cities" },
    ]);
  });

  it("invalidates the listing cache when its detail link changes without changing visible text", async () => {
    const changed = html.replaceAll("/exhibitions/tides", "/exhibitions/tides-updated");
    const pages = await capturePages([{ url: PAGE, text: listingText(html) }], NOW);
    expect(listingText(changed)).toBe(listingText(html));
    const original = await listingHash(pages, listingLinks(html, PAGE));
    expect(await listingHash(pages, listingLinks(changed, PAGE))).not.toBe(original);
    expect(await listingHash(pages)).not.toBe(original);
  });

  it("picks the link naming each show, at most the given number", () => {
    const links = listingLinks(html, PAGE);
    expect(showPages(["Paper Worlds", "Tides of Light", "Not Linked"], links, 5)).toEqual([
      "https://museum.example/exhibitions/paper-worlds",
      "https://museum.example/exhibitions/tides",
    ]);
    expect(showPages(["Paper Worlds", "Tides of Light"], links, 1)).toEqual([
      "https://museum.example/exhibitions/paper-worlds",
    ]);
  });

  it.each([
    ["An Artist’s World", "An Artist's World"],
    ["“Paper Worlds”", '"Paper Worlds"'],
    ["Light — Colour", "Light-Colour"],
  ])("matches detail links using the evidence typography rules: %s", (published, extracted) => {
    const links = listingLinks(`<main><a href="/exhibitions/show">${published}</a></main>`, PAGE);
    expect(showPages([extracted], links, 8)).toEqual([`${PAGE}/show`]);
  });
});

describe("verified shows", () => {
  const text =
    "Exhibitions | Verified Museum\nVerified Museum presents Tides of Light, October 1 – October 31, 2026. "
    + "Paper Worlds, January 10 – March 1, 2027 and April 5 – May 30, 2027. "
    + "Echo, May 1 – June 30, 2027 and June 1 – July 30, 2027.";

  function candidate(title: string, dates: string, startDate: string, endDate: string): ExhibitionCandidate {
    return {
      title,
      url: PAGE,
      startDate,
      endDate,
      dateText: dates,
      titleEvidence: title,
      venueEvidence: "Exhibitions | Verified Museum",
      dateEvidence: `${title}, ${dates}`,
      kind: "temporary_exhibition",
      venueMatch: true,
      datePrecision: "day",
    };
  }

  it("keeps one show per title with its runs in order, and drops unquoted or overlapping ones", async () => {
    const pages = await capturePages([{ url: PAGE, text }], NOW);
    const paperDates = "January 10 – March 1, 2027 and April 5 – May 30, 2027";
    const echoDates = "May 1 – June 30, 2027 and June 1 – July 30, 2027";
    const shows = verifiedShows({
      museum: { museumId: "m1", name: "Verified Museum", timeZone: "America/Los_Angeles", sourceUrls: [PAGE] },
      pages,
      candidates: [
        candidate("Paper Worlds", paperDates, "2027-04-05", "2027-05-30"),
        candidate("Tides of Light", "October 1 – October 31, 2026", "2026-10-01", "2026-10-31"),
        candidate("Paper Worlds", paperDates, "2027-01-10", "2027-03-01"),
        candidate("Ghost Show", "October 1 – October 31, 2026", "2026-10-01", "2026-10-31"),
        candidate("Echo", echoDates, "2027-05-01", "2027-06-30"),
        candidate("Echo", echoDates, "2027-06-01", "2027-07-30"),
      ],
      asOfDate: "2026-10-09",
    });
    expect(shows).toEqual([
      {
        title: "Paper Worlds",
        sourceUrl: PAGE,
        sourceSha256: pages[0].sha256,
        checkedAt: NOW,
        timeZone: "America/Los_Angeles",
        viewingPeriods: [
          { startDate: "2027-01-10", endDate: "2027-03-01" },
          { startDate: "2027-04-05", endDate: "2027-05-30" },
        ],
      },
      expect.objectContaining({
        title: "Tides of Light",
        viewingPeriods: [{ startDate: "2026-10-01", endDate: "2026-10-31" }],
      }),
    ]);
  });
});

describe("read schedule", () => {
  it("reads again a few days after the next show closes, within a week and a month", () => {
    expect(nextDueAt(NOW, [])).toBe(NOW + 30 * DAY);
    expect(nextDueAt(NOW, [NOW + 12 * DAY, NOW + 40 * DAY])).toBe(NOW + 15 * DAY);
    expect(nextDueAt(NOW, [NOW + 2 * DAY])).toBe(NOW + 7 * DAY);
    expect(nextDueAt(NOW, [NOW - DAY, NOW + 60 * DAY])).toBe(NOW + 30 * DAY);
  });

  it("backs off failed reads by doubling up to a month", () => {
    expect([1, 2, 3, 5, 6, 9].map((failures) => (retryAt(NOW, failures) - NOW) / DAY)).toEqual([1, 2, 4, 16, 30, 30]);
  });
});

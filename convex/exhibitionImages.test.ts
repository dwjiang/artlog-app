import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { png } from "./lib/showImageFixtures";
import { seedMuseum } from "./lib/testFactories";
import { harness, runScheduled, type Harness } from "./test.helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-14T12:23:00Z");
const HOME = "https://museum.example";
const LISTING = `${HOME}/exhibitions`;
const TIDES_PAGE = `${HOME}/exhibitions/tides`;
const PAPER_PAGE = `${HOME}/exhibitions/paper`;
const TIDES_IMAGE = "https://cdn.museum.example/tides.jpg";
const PAPER_IMAGE = "https://cdn.museum.example/paper.jpg";

type Reply = { status?: number; type?: string; body?: string | Uint8Array };
let web: Record<string, Reply>;
const fetchMock = vi.fn<typeof fetch>();

const page = (image?: string, main = "") =>
  `<html><head>${image ? `<meta property="og:image" content="${image}">` : ""}</head><body><main>${main}</main></body></html>`;
const picture = (): Reply => ({ type: "image/jpeg", body: png(1200, 630) });
const requested = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input) === url);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("FLAG_EXHIBITION_REFRESH", "on");
  web = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const { status = 200, type = "text/html", body = "" } = web[String(input)] ?? { status: 404 };
    return new Response(typeof body === "string" ? body : new Uint8Array(body), {
      status,
      headers: { "content-type": type },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type SeededShow = { title: string; sourceUrl: string } & Partial<
  Pick<Doc<"exhibitions">, "finalEndAt" | "imageUrl" | "imageCheckedAt">
>;

async function seedShows(t: Harness, shows: SeededShow[], museum: { website?: string; optOut?: boolean } = {}) {
  return t.run(async (ctx) => {
    const museumId = await seedMuseum(ctx, { website: HOME, region: "sf-bay-area", ...museum });
    const ids: Id<"exhibitions">[] = [];
    for (const show of shows) {
      ids.push(
        await ctx.db.insert("exhibitions", {
          museumId,
          region: "sf-bay-area",
          titleKey: show.title.toLowerCase(),
          finalEndAt: NOW + 30 * DAY,
          sourceSha256: "a".repeat(64),
          checkedAt: NOW - DAY,
          timeZone: "America/Los_Angeles",
          viewingPeriods: [{ startDate: null, endDate: "2026-11-13" }],
          ...show,
        }),
      );
    }
    return ids;
  });
}

const stored = (t: Harness, id: Id<"exhibitions">) => t.run((ctx) => ctx.db.get("exhibitions", id));

async function lookUpDue(t: Harness) {
  await t.mutation(internal.exhibitionImages.lookUpDue, {});
  await runScheduled(t);
}

describe("exhibition image lookups", () => {
  it("gives current shows the pictures on their own pages and does not look them up again", async () => {
    const t = harness();
    const [tides, paper, closed, checked] = await seedShows(t, [
      { title: "Tides of Light", sourceUrl: LISTING },
      { title: "Paper Worlds", sourceUrl: LISTING },
      { title: "Closed Show", sourceUrl: `${HOME}/exhibitions/closed`, finalEndAt: NOW - DAY },
      { title: "Fog", sourceUrl: `${HOME}/exhibitions/fog`, imageCheckedAt: NOW - DAY },
    ]);
    web[LISTING] = {
      body: page(
        undefined,
        `<h2><a href="/exhibitions/tides">Tides of Light</a></h2><h2><a href="/exhibitions/paper">Paper Worlds</a></h2>`,
      ),
    };
    web[TIDES_PAGE] = { body: page(TIDES_IMAGE) };
    web[PAPER_PAGE] = { body: page(PAPER_IMAGE) };
    web[TIDES_IMAGE] = picture();
    web[PAPER_IMAGE] = picture();

    await lookUpDue(t);

    expect(await stored(t, tides)).toMatchObject({ imageUrl: TIDES_IMAGE, imageCheckedAt: NOW });
    expect(await stored(t, paper)).toMatchObject({ imageUrl: PAPER_IMAGE, imageCheckedAt: NOW });
    expect(await stored(t, closed)).not.toHaveProperty("imageCheckedAt");
    expect(await stored(t, checked)).toMatchObject({ imageCheckedAt: NOW - DAY });
    expect(await stored(t, checked)).not.toHaveProperty("imageUrl");
    expect(requested(`${HOME}/exhibitions/closed`)).toHaveLength(0);
    expect(requested(`${HOME}/exhibitions/fog`)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.every(([, init]) => new Headers(init?.headers).get("User-Agent")?.startsWith("artlog-bot/")),
    ).toBe(true);

    const requests = fetchMock.mock.calls.length;
    vi.setSystemTime(NOW + DAY);
    await lookUpDue(t);
    expect(fetchMock.mock.calls).toHaveLength(requests);
  });

  it("keeps a show's earlier picture when its page offers none, and retries unavailable pages the next day", async () => {
    const t = harness();
    const earlier = "https://cdn.museum.example/earlier.jpg";
    const [tides, paper] = await seedShows(t, [
      { title: "Tides of Light", sourceUrl: TIDES_PAGE, imageUrl: earlier },
      { title: "Paper Worlds", sourceUrl: PAPER_PAGE },
    ]);
    web[TIDES_PAGE] = { body: page() };
    web[PAPER_PAGE] = { status: 503 };
    web[PAPER_IMAGE] = picture();

    await lookUpDue(t);

    expect(await stored(t, tides)).toMatchObject({ imageUrl: earlier, imageCheckedAt: NOW });
    expect(await stored(t, paper)).not.toHaveProperty("imageCheckedAt");

    vi.setSystemTime(NOW + DAY);
    web[PAPER_PAGE] = { body: page(PAPER_IMAGE) };
    await lookUpDue(t);

    expect(await stored(t, paper)).toMatchObject({ imageUrl: PAPER_IMAGE, imageCheckedAt: NOW + DAY });
    expect(requested(TIDES_PAGE)).toHaveLength(1);
  });

  it("keeps a show due after a robots.txt outage and saves its image once the site recovers", async () => {
    const t = harness();
    const [show] = await seedShows(t, [{ title: "Tides of Light", sourceUrl: TIDES_PAGE }]);
    web[`${HOME}/robots.txt`] = { status: 503 };
    web[TIDES_PAGE] = { body: page(TIDES_IMAGE) };
    web[TIDES_IMAGE] = picture();

    await lookUpDue(t);
    expect(await stored(t, show)).not.toHaveProperty("imageCheckedAt");
    expect(requested(TIDES_PAGE)).toHaveLength(0);

    vi.setSystemTime(NOW + DAY);
    web[`${HOME}/robots.txt`] = { type: "text/plain", body: "User-agent: *\nAllow: /" };
    await lookUpDue(t);
    expect(await stored(t, show)).toMatchObject({ imageUrl: TIDES_IMAGE, imageCheckedAt: NOW + DAY });
  });

  it("looks up every museum with due shows, past the first page of them", async () => {
    const t = harness();
    const ids: Id<"exhibitions">[] = [];
    for (let index = 0; index < 101; index++) {
      const site = `https://museum-${index}.example`;
      const image = `https://cdn.museum.example/${index}.jpg`;
      web[`${site}/show`] = { body: page(image) };
      web[image] = picture();
      ids.push(...(await seedShows(t, [{ title: `Show ${index}`, sourceUrl: `${site}/show` }], { website: site })));
    }

    await lookUpDue(t);

    const shows = await Promise.all(ids.map((id) => stored(t, id)));
    expect(shows.filter((show) => show?.imageUrl)).toHaveLength(101);
  });

  it("reads no museum site when the refresh is off or the museum opted out", async () => {
    const t = harness();
    const [optedOut] = await seedShows(t, [{ title: "Tides of Light", sourceUrl: TIDES_PAGE }], { optOut: true });
    web[TIDES_PAGE] = { body: page(TIDES_IMAGE) };
    web[TIDES_IMAGE] = picture();

    await lookUpDue(t);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await stored(t, optedOut)).not.toHaveProperty("imageCheckedAt");

    const [open] = await seedShows(t, [{ title: "Paper Worlds", sourceUrl: PAPER_PAGE }]);
    vi.stubEnv("FLAG_EXHIBITION_REFRESH", "off");
    await lookUpDue(t);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await stored(t, open)).not.toHaveProperty("imageCheckedAt");
  });

  it("records a lookup only for a show still citing the page it read and not checked since", async () => {
    const t = harness();
    const [moved, newer, current] = await seedShows(t, [
      { title: "Tides of Light", sourceUrl: `${HOME}/exhibitions/tides-of-light` },
      { title: "Paper Worlds", sourceUrl: PAPER_PAGE, imageCheckedAt: NOW + 1 },
      { title: "Fog", sourceUrl: `${HOME}/exhibitions/fog` },
    ]);

    await t.mutation(internal.exhibitionImages.recordImages, {
      checkedAt: NOW,
      results: [
        { exhibitionId: moved, sourceUrl: TIDES_PAGE, imageUrl: TIDES_IMAGE },
        { exhibitionId: newer, sourceUrl: PAPER_PAGE, imageUrl: PAPER_IMAGE },
        { exhibitionId: current, sourceUrl: `${HOME}/exhibitions/fog` },
      ],
    });

    expect(await stored(t, moved)).not.toHaveProperty("imageCheckedAt");
    expect(await stored(t, newer)).toMatchObject({ imageCheckedAt: NOW + 1 });
    expect(await stored(t, newer)).not.toHaveProperty("imageUrl");
    expect(await stored(t, current)).toMatchObject({ imageCheckedAt: NOW });
  });
});

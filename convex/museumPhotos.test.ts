import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { jsonResponse } from "./lib/labelFixtures";
import { seedDevice, seedMuseum } from "./lib/testFactories";
import { harness, type Harness, type SignedIn } from "./test.helpers";

type CommonsFile = { mime?: string; width?: number; artist?: string; license?: string; attribution?: boolean };
type Museum = { images?: string[]; sitelinks?: Record<string, string> };
// `images` and `sitelinks` describe the Art Institute (Q239303); `museums` any other item.
type World = Museum & {
  museums?: Record<string, Museum>;
  /** Wikipedia lead images by article title. */
  leadImages?: Record<string, string>;
  files?: Record<string, CommonsFile>;
  /** Commons file names that redirect to another. */
  redirects?: Record<string, string>;
};

const fetchMock = vi.fn<typeof fetch>();
let world: World;

beforeEach(() => {
  vi.useFakeTimers();
  world = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => answer(new URL(String(input))));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Answers batched requests with pages in reverse order, as nothing promises they come back in request order.
function answer(url: URL): Response {
  const params = url.searchParams;
  const titles = (params.get("titles") ?? "").split("|");
  if (url.host === "www.wikidata.org") {
    const ids = (params.get("ids") ?? "").split("|");
    const entities = Object.fromEntries(
      ids.map((id) => {
        const museum = id === "Q239303" ? world : world.museums?.[id];
        if (!museum) return [id, { id, missing: "" }];
        const claims = (museum.images ?? []).map((file) => ({
          rank: "normal",
          mainsnak: { datavalue: { value: file } },
        }));
        const sitelinks = Object.fromEntries(
          Object.entries(museum.sitelinks ?? {}).map(([site, title]) => [site, { title }]),
        );
        return [id, { id, claims: { P18: claims }, sitelinks }];
      }),
    );
    return jsonResponse({ entities });
  }
  if (url.host === "commons.wikimedia.org") {
    const redirects = titles.flatMap((title) => {
      const to = world.redirects?.[title.replace(/^File:/, "")];
      return to ? [{ from: title, to: `File:${to}` }] : [];
    });
    const pages = titles.map((title) => {
      const name = redirects.find((redirect) => redirect.from === title)?.to ?? title;
      const file = world.files?.[name.replace(/^File:/, "")];
      if (!file) return { title: name, missing: true };
      const metadata = {
        Artist: file.artist === undefined ? undefined : { value: file.artist },
        LicenseShortName: { value: file.license ?? "CC BY-SA 4.0" },
        AttributionRequired: { value: String(file.attribution ?? true) },
      };
      return {
        title: name,
        imageinfo: [{ mime: file.mime ?? "image/jpeg", width: file.width ?? 4000, extmetadata: metadata }],
      };
    });
    return jsonResponse({ query: { redirects, pages: pages.toReversed() } });
  }
  const pages = titles.map((title) => ({ title, pageimage: world.leadImages?.[title] }));
  return jsonResponse({ query: { pages: pages.toReversed() } });
}

async function setUp(museum: Partial<Doc<"museums">> = { wikidataId: "Q239303" }) {
  const t = harness();
  const { as } = await seedDevice(t);
  const venueId = await t.run((ctx) => seedMuseum(ctx, museum));
  return { t, as, venueId };
}

async function view(t: Harness, as: SignedIn["as"], venueId: string) {
  await as.mutation(api.museumPhotos.request, { venueId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return as.query(api.museumPhotos.forVenue, { venueId });
}

it("shows the museum's Wikidata photo with its author and license, looked up once for every viewer", async () => {
  world = {
    images: ["Art Institute of Chicago (51575570710).jpg"],
    files: {
      "Art Institute of Chicago (51575570710).jpg": {
        artist: '<a href="https://www.flickr.com/people/83136374@N05">ajay_suresh</a>',
        license: "CC BY 2.0",
      },
    },
  };
  const { t, as, venueId } = await setUp();
  expect(await as.query(api.museumPhotos.forVenue, { venueId })).toEqual({ photo: null, checked: false });

  expect(await view(t, as, venueId)).toEqual({
    photo: {
      imageUrl:
        "https://commons.wikimedia.org/wiki/Special:FilePath/Art_Institute_of_Chicago_(51575570710).jpg?width=1280",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Art_Institute_of_Chicago_(51575570710).jpg",
      author: "ajay_suresh",
      license: "CC BY 2.0",
    },
    checked: true,
  });
  const lookups = fetchMock.mock.calls.length;
  const other = await seedDevice(t);
  await view(t, other.as, venueId);
  expect(fetchMock).toHaveBeenCalledTimes(lookups);
});

it("leaves the credit off a photo whose license asks for none and fits the author to one line", async () => {
  world = { images: ["MALBA.jpg"], files: { "MALBA.jpg": { license: "Public domain", attribution: false } } };
  const { t, as, venueId } = await setUp();
  expect((await view(t, as, venueId)).photo).toEqual({
    imageUrl: expect.stringContaining("MALBA.jpg"),
    pageUrl: expect.stringContaining("MALBA.jpg"),
  });

  world = {
    images: ["Nairobi National Museum.jpg"],
    files: {
      "Nairobi National Museum.jpg": { artist: `Karl Ragnar Gjertsen. ${"Please credit me nearby. ".repeat(6)}` },
    },
  };
  const nairobi = await setUp();
  const author = (await view(nairobi.t, nairobi.as, nairobi.venueId)).photo?.author ?? "";
  expect(author).toMatch(/^Karl Ragnar Gjertsen\. Please credit me nearby\..*…$/);
  expect(author.length).toBeLessThanOrEqual(80);

  world = {
    images: ["Palace Legion Honor SF (cropped).jpg"],
    files: {
      "Palace Legion Honor SF (cropped).jpg": {
        artist:
          'No machine-readable author provided. <a href="//commons.wikimedia.org/wiki/User:Urban~commonswiki">Urban~commonswiki</a> assumed (based on copyright claims).',
      },
    },
  };
  const legion = await setUp();
  expect((await view(legion.t, legion.as, legion.venueId)).photo?.author).toBe("Urban");

  world = {
    images: ["Maison de Balzac.jpg"],
    files: {
      "Maison de Balzac.jpg": {
        artist:
          "<p>Thank you to indicate this credit line next to the image in case of reuse:</p><p>Credit: Polymagou - CC BY-SA</p><p>I'd appreciate a message on my talk page.</p>",
      },
    },
  };
  const balzac = await setUp();
  expect((await view(balzac.t, balzac.as, balzac.venueId)).photo?.author).toBe("Polymagou");
});

it("falls back to the free lead photo of the museum's Wikipedia article when its Wikidata image is not a photo", async () => {
  world = {
    images: ["Museum plan.svg", "Tiny.jpg"],
    sitelinks: { commonswiki: "Category:Museum", dewiki: "Heimatmuseum" },
    leadImages: { Heimatmuseum: "Heimatmuseum_Außenansicht.jpg" },
    files: {
      "Museum plan.svg": { mime: "image/svg+xml" },
      "Tiny.jpg": { width: 300 },
      "Heimatmuseum Außenansicht.jpg": {},
    },
  };
  const { t, as, venueId } = await setUp();
  expect((await view(t, as, venueId)).photo?.imageUrl).toBe(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Heimatmuseum_Au%C3%9Fenansicht.jpg?width=1280",
  );
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("https://de.wikipedia.org/"))).toBe(true);
});

it("keeps the blue card when the only pictures are maps or placeholders", async () => {
  world = {
    sitelinks: { enwiki: "Natural History Museum, Varna" },
    leadImages: { "Natural History Museum, Varna": "Varna_location_map.png" },
    files: { "Varna location map.png": { mime: "image/png" } },
  };
  const { t, as, venueId } = await setUp();
  expect(await view(t, as, venueId)).toEqual({ photo: null, checked: true });
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("commons.wikimedia.org"))).toBe(false);
});

it.each([
  ["has no Wikidata item", {}],
  ["opted out", { wikidataId: "Q239303", optOut: true }],
])("looks nothing up for a museum that %s", async (_case, museum) => {
  world = { images: ["Museum.jpg"], files: { "Museum.jpg": {} } };
  const { t, as, venueId } = await setUp(museum);
  expect(await view(t, as, venueId)).toEqual({ photo: null, checked: true });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("asks again after a failed lookup once the first has had time to finish, not while it may be running", async () => {
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  const { t, as, venueId } = await setUp();
  expect(await view(t, as, venueId)).toEqual({ photo: null, checked: false });
  const attempts = fetchMock.mock.calls.length;
  expect(attempts).toBeGreaterThan(0);

  await view(t, as, venueId);
  expect(fetchMock).toHaveBeenCalledTimes(attempts);

  world = { images: ["Museum.jpg"], files: { "Museum.jpg": {} } };
  fetchMock.mockImplementation(async (input) => answer(new URL(String(input))));
  vi.advanceTimersByTime(10 * 60 * 1000);
  expect((await view(t, as, venueId)).photo?.imageUrl).toContain("Museum.jpg");
});

async function backfill(t: Harness, args: { limit?: number } = {}) {
  await t.action(internal.museumPhotos.backfill, { cursor: null, ...args });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function rows(t: Harness) {
  const all = await t.run((ctx) => ctx.db.query("museumPhotos").collect());
  return new Map(all.map((row) => [row.venueId, row]));
}

it("backfills every museum not yet checked, following Commons redirects, and leaves checked ones alone", async () => {
  world = {
    museums: { Q1: { images: ["A.jpg"] }, Q2: { images: ["Old B.jpg"] }, Q4: { images: ["New.jpg"] }, Q5: {} },
    files: { "A.jpg": {}, "B.jpg": {}, "New.jpg": {} },
    redirects: { "Old B.jpg": "B.jpg" },
  };
  const t = harness();
  const [a, b, noItem, checked, none] = await t.run(async (ctx) => {
    const ids: Id<"museums">[] = [];
    for (const wikidataId of ["Q1", "Q2", undefined, "Q4", "Q5"]) ids.push(await seedMuseum(ctx, { wikidataId }));
    await ctx.db.insert("museumPhotos", { venueId: ids[3], requestedAt: 1, checkedAt: 1, file: "Kept.jpg" });
    return ids;
  });

  await backfill(t);
  const saved = await rows(t);
  const state = (venueId: Id<"museums">) => {
    const row = saved.get(venueId);
    return { file: row?.file, checked: row?.checkedAt !== undefined };
  };
  expect([a, b, noItem, none].map(state)).toEqual([
    { file: "A.jpg", checked: true },
    { file: "B.jpg", checked: true },
    { file: undefined, checked: true },
    { file: undefined, checked: true },
  ]);
  expect(saved.get(checked)).toMatchObject({ file: "Kept.jpg", checkedAt: 1 });
  const requested = fetchMock.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => url.host === "www.wikidata.org")
    .map((url) => url.searchParams.get("ids"));
  expect(requested).toEqual(["Q1|Q2|Q5"]);
});

it("walks every page of museums, and a pilot run stops at its limit", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    for (let index = 0; index < 52; index++) await seedMuseum(ctx, { wikidataId: `Q${1000 + index}` });
  });
  await backfill(t, { limit: 2 });
  expect([...(await rows(t)).values()].filter((row) => row.checkedAt !== undefined)).toHaveLength(2);

  await backfill(t);
  expect([...(await rows(t)).values()].filter((row) => row.checkedAt !== undefined)).toHaveLength(52);
});

it("retries a page whose lookups fail, and after three failures leaves its museums to their first view", async () => {
  world = { museums: { Q1: { images: ["A.jpg"] } }, files: { "A.jpg": {} } };
  const t = harness();
  const museum = await t.run((ctx) => seedMuseum(ctx, { wikidataId: "Q1" }));
  fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(new TypeError("fetch failed"));
  await backfill(t);
  expect((await rows(t)).get(museum)?.file).toBe("A.jpg");

  const failing = harness();
  const [unlucky, noItem] = await failing.run(async (ctx) => [
    await seedMuseum(ctx, { wikidataId: "Q1" }),
    await seedMuseum(ctx, {}),
  ]);
  fetchMock.mockClear();
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  await backfill(failing);
  const saved = await rows(failing);
  expect(saved.get(unlucky)).toBeUndefined();
  expect(saved.get(noItem)?.checkedAt).toEqual(expect.any(Number));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

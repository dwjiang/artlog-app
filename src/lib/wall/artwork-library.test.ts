import type { SavedWork } from "@/db/schema";

import { canHangArtwork, libraryArtworks, sectionWorksByArtist } from "./artwork-library";

const work = (localId: string, title: string, artist: string, savedAt: number) =>
  ({
    localId,
    title,
    artist,
    savedAt,
    deletedAt: null,
    syncedBy: "device",
    visitLocalId: null,
  }) as SavedWork;
const works = [work("a", "Zinnias", "Émile", 2), work("b", "Apples", "Zoe", 1), work("c", "Clouds", "Ada", 3)];
const filter = { search: "", sort: "recent" as const, notOnWall: false, hungIds: new Set<string>() };

it("orders the whole library by recency, title, or artist without changing the collection", () => {
  expect(libraryArtworks(works, filter).map((item) => item.localId)).toEqual(["c", "a", "b"]);
  expect(libraryArtworks(works, { ...filter, sort: "title" }).map((item) => item.localId)).toEqual(["b", "c", "a"]);
  expect(libraryArtworks(works, { ...filter, sort: "artist" }).map((item) => item.localId)).toEqual(["c", "a", "b"]);
  expect(works.map((item) => item.localId)).toEqual(["a", "b", "c"]);
});

it("combines title and artist search with visit membership and excludes deleted or hung art", () => {
  const visit = { localId: "visit", venueName: "Museum", visitedOn: "2026-09-20", works: [works[0], works[1]] };
  expect(libraryArtworks(works, { ...filter, search: "émile zin", visit })).toEqual([works[0]]);
  expect(
    libraryArtworks([...works, { ...works[0], localId: "deleted", deletedAt: 1 }], {
      ...filter,
      visit,
      notOnWall: true,
      hungIds: new Set(["a"]),
    }),
  ).toEqual([works[1]]);
});

it("allows local guest art and previously synced edits, but waits for a new account save to sync", () => {
  expect(canHangArtwork({ ...works[0], syncedAt: null }, true)).toBe(true);
  expect(canHangArtwork({ ...works[0], syncedBy: null }, true)).toBe(false);
  expect(canHangArtwork({ ...works[0], syncedBy: null }, false)).toBe(true);
  expect(canHangArtwork({ ...works[0], deletedAt: 1 }, false)).toBe(false);
});

const filed = (artist: string, localId = artist, extra: Partial<SavedWork> = {}) =>
  ({ localId, artist, title: `${artist} work`, date: null, ...extra }) as Pick<
    SavedWork,
    "localId" | "artist" | "title" | "date"
  >;
const shelves = (works: ReturnType<typeof filed>[], columns: number) =>
  sectionWorksByArtist(works, columns).map((section) => [section.title, section.data.map((work) => work.localId)]);

it("files artists under their surname, past particles, suffixes, notes, and inverted names", () => {
  const works = [
    filed("Vincent van Gogh"),
    filed("Edward Hopper"),
    filed("Georges Seurat"),
    filed("Leonardo da Vinci"),
    filed("Pieter Bruegel the Elder"),
    filed("Henri de Toulouse-Lautrec"),
    filed("Georgia O’Keeffe"),
    filed("Rembrandt"),
    filed("Kahlo, Frida"),
    filed("Claude Monet (French, 1840–1926)"),
    filed("Édouard Manet"),
    filed("Unknown artist"),
    filed(""),
  ];
  expect(shelves(works, 1)).toEqual([
    ["B", ["Pieter Bruegel the Elder"]],
    ["G", ["Vincent van Gogh"]],
    ["H", ["Edward Hopper"]],
    ["K", ["Kahlo, Frida"]],
    ["M", ["Édouard Manet", "Claude Monet (French, 1840–1926)"]],
    ["O", ["Georgia O’Keeffe"]],
    ["R", ["Rembrandt"]],
    ["S", ["Georges Seurat"]],
    ["T", ["Henri de Toulouse-Lautrec"]],
    ["V", ["Leonardo da Vinci"]],
    ["#", ["Unknown artist", ""]],
  ]);
  expect(works[0].localId).toBe("Vincent van Gogh");
});

it("keeps one artist's works together in date order, then by title", () => {
  const works = [
    filed("Claude Monet", "late", { date: "1916", title: "Water Lilies" }),
    filed("Monet, Claude", "early", { date: "c. 1872", title: "Impression" }),
    filed("Claude Monet", "undated", { title: "Haystacks" }),
    filed("Claude Monet", "undated-b", { title: "Bridge" }),
  ];
  expect(shelves(works, 2)).toEqual([[undefined, ["early", "late", "undated-b", "undated"]]]);
});

it("leaves headings out until the letter sections would fill their grid rows on average", () => {
  const audit = [filed("Edward Hopper"), filed("Georges Seurat"), filed("Vincent van Gogh")];
  expect(shelves(audit, 2)).toEqual([[undefined, ["Vincent van Gogh", "Edward Hopper", "Georges Seurat"]]]);
  const oneLetter = [filed("Mary Cassatt"), filed("Paul Cézanne"), filed("Marc Chagall"), filed("John Constable")];
  expect(shelves(oneLetter, 1)).toEqual([
    [undefined, ["Mary Cassatt", "Paul Cézanne", "Marc Chagall", "John Constable"]],
  ]);
  const filled = [...oneLetter, filed("Edward Hopper"), filed("Winslow Homer")];
  expect(shelves(filled, 2)).toEqual([
    ["C", ["Mary Cassatt", "Paul Cézanne", "Marc Chagall", "John Constable"]],
    ["H", ["Winslow Homer", "Edward Hopper"]],
  ]);
});

it("sorts the wall picker's library by artist surname too", () => {
  const library = [
    work("a", "Apples", "Zoe Adams", 1),
    work("b", "Birds", "Ada Zimmer", 2),
    work("c", "Clouds", "", 3),
  ];
  expect(libraryArtworks(library, { ...filter, sort: "artist" }).map((item) => item.localId)).toEqual(["a", "b", "c"]);
});
